# Phase 2: Contact Verification, Sessions and Eligibility (Screens 01–05) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first five screens of the onboarding journey end to end: phone OTP challenge/verify/resend with a provisional customer and pre-auth token, customer session issuance, application create/resume, email OTP challenge/verify/resend bound to the application, the eligibility decision with a versioned rulebook, and the application resume read.

**Architecture:** Domain objects (Customer, OnboardingApplication, Challenge, EligibilityRulebook) are pure TypeScript. Application services orchestrate ports (repositories, kv store, rate limiter, messaging, outbox, audit, analytics) inside `UnitOfWork.run`. Controllers validate DTOs and delegate. OTP digests live only in Redis as HMACs; identifiers are encrypted at rest with fingerprints for lookup. Every committed transition writes audit, business-outbox and analytics-outbox rows in the same transaction.

**Tech Stack:** as Phase 1, plus `nodemailer` (CJS) for SMTP delivery to Mailpit locally.

**Spec:** `docs/superpowers/specs/2026-10-18-pms-onboarding-backend-design.md`; functional contract: screens 01–05 of the product spec (endpoints, bodies, status values, `next_screen`).

## Global Constraints

- Endpoints and bodies exactly as the product spec: `POST /v1/auth/phone/challenges` (202), `POST /v1/auth/phone/challenges/{challenge_id}/verify` (200), `…/resend` (200), `POST /v1/onboarding/applications/{application_id}/email/challenges` (202), `…/email/challenges/{challenge_id}/verify` (200), `…/resend` (200), `PUT /v1/onboarding/applications/{application_id}/eligibility` (200), plus `GET /v1/onboarding/applications/{application_id}` (200, side-effect free).
- OTP: 6 digits, cryptographically random; TTL 300 s; resend cooldown 30 s; max 5 attempts; digest = HMAC-SHA256(OTP_HMAC_KEY, `${challengeId}:${purpose}:${otp}`); never in responses, DB, logs, outbox or analytics.
- Redis keys: `otp:phone:{fingerprint}:{challengeId}`, `otp:email:{fingerprint}:{challengeId}`, `preauth:{tokenHash}`, `session:{tokenHash}`, `rl:{scope}:{fingerprint}`. Never raw phone, email or token.
- Rate limits (configurable, defaults): phone challenges 5 per phone per 15 min, 20 per IP per 15 min; email challenges 5 per application per 15 min; verify attempts 5 per challenge.
- Same customer-safe response for new and existing phones; account existence never disclosed.
- Pre-auth token: 32 random bytes base64url, TTL 600 s, bound to `{purpose, phoneFingerprint}`; valid only for verify/resend of challenges with that fingerprint. Session token: 32 random bytes base64url, TTL 1800 s (sliding), stored as SHA-256 hash in Redis and `sessions` table.
- `next_screen` values: `EMAIL_ENTRY`, `ELIGIBILITY`, `PAN_IDENTITY`, `ASSISTED_ONBOARDING`, `NOT_ELIGIBLE`.
- Eligibility rulebook v1 (`config/rulebooks/eligibility.v1.json`): customer types `INDIVIDUAL` eligible, `NON_INDIVIDUAL` → ASSISTED_REQUIRED; residential status `RESIDENT` eligible, `NRI`/`OCI`/`FOREIGN` → ASSISTED_REQUIRED; `MIN_INVESTMENT_INR` 2,500,000 (below → NOT_ELIGIBLE); distribution route `DIRECT` eligible, `DISTRIBUTOR` → ASSISTED_REQUIRED; `journey_route` `RESIDENT_SINGLE_HOLDER`. Content marked `PLACEHOLDER_PENDING_COMPLIANCE`.
- Analytics events (backend): `Phone Challenge Created`, `OTP Dispatch Updated`, `Phone Verification Completed`, `Application Created`, `Application Resumed`, `Email Challenge Created`, `Email Dispatch Updated`, `Email Verification Completed`, `Eligibility Evaluation Completed`, each with only `event_id, application_id, screen_id, journey_version ('pms_v3'), event_schema_version ('1'), event_source ('backend'), outcome, safe_error_category`.
- Commit after each task on branch `feat/phase2-contact-eligibility`.

## Review Focus

1. Two concurrent successful verifies of the same OTP: exactly one session and one application are created; the second returns `OTP_INVALID_OR_EXPIRED` (Task 6 test with a parallel `Promise.all`).
2. A phone OTP presented to the email verify endpoint, or an email challenge id under another application: 422/403, never verification (Task 8 test).
3. Redis down during verify: the request fails with 503 and the challenge is not consumed (Task 6 test with the dead client).
4. Resend inside the cooldown window: 429 with `retryable: true` and the old code still valid; resend after cooldown invalidates the old code (Task 7 test).
5. Eligibility amount sent as a string or negative number: 422 `ACTION_REQUIRED`, no decision row written (Task 9 test).

---

### Task 1: Domain model (customer, application, challenge, eligibility)

**Files:**
- Create: `src/domain/shared/phone-number.ts`, `email-address.ts`, `masking.ts`, `public-id.ts`
- Create: `src/domain/identity/customer.ts`, `src/domain/identity/challenge.ts`
- Create: `src/domain/onboarding/application.ts`, `application-step.ts`, `screens.ts`
- Create: `src/domain/eligibility/eligibility-rulebook.ts`, `eligibility-engine.ts`, `config/rulebooks/eligibility.v1.json`
- Test: one spec per file above.

**Interfaces:**
- `normalisePhone(raw: string): PhoneNumber` → E.164 (`+91XXXXXXXXXX`); accepts `9000000001`, `09000000001`, `+91 90000 00001`; throws `ValidationError` for non-Indian or malformed numbers. `maskPhone(e164): '+91 ******0001'`.
- `normaliseEmail(raw): EmailAddress` (trim, lowercase domain, keep local part; RFC-ish check); `maskEmail('customer@example.com') === 'c***@example.com'`.
- `Customer { id, phone: PhoneNumber, phoneVerifiedAt?: Date, email?: EmailAddress, emailVerifiedAt?: Date, state: 'UNVERIFIED'|'VERIFIED', version }` with `verifyPhone(now)`, `proposeEmail(email)`, `verifyEmail(now)` returning new state (immutable updates).
- `Challenge { id, channel: 'PHONE'|'EMAIL', purpose: 'PMS_ONBOARDING'|'EMAIL_VERIFICATION', targetFingerprint, customerId?, applicationId?, status: 'DISPATCH_PENDING'|'DISPATCHED'|'DISPATCH_FAILED'|'VERIFIED'|'SUPERSEDED'|'EXPIRED', expiresAt, resendAfter, attempts, maxAttempts }`; `OtpPolicy { ttlSeconds: 300, resendAfterSeconds: 30, maxAttempts: 5 }`; `generateOtp(): string` (6 digits, `crypto.randomInt`); `otpDigest(key: Buffer, challengeId, purpose, otp): string`.
- `Screen` enum/union: `PHONE_ENTRY, EMAIL_ENTRY, ELIGIBILITY, PAN_IDENTITY, ASSISTED_ONBOARDING, NOT_ELIGIBLE` (later screens appended in later phases). `StepId`: `PHONE_VERIFIED, EMAIL_VERIFIED, ELIGIBILITY`.
- `OnboardingApplication { id, customerId, status: 'IN_PROGRESS'|'ASSISTED'|'NOT_ELIGIBLE'|'WITHDRAWN', journeyVersion: 'pms_v3', nextScreen: Screen, version, steps: ApplicationStep[] }` with `completeStep(stepId, nextScreen, now)` (idempotent, bumps version) and `applyEligibility(decision)`.
- `EligibilityInput { customerType, residentialStatus, intendedInvestmentInr, distributionRoute }`; `EligibilityDecision { status: 'ELIGIBLE'|'ASSISTED_REQUIRED'|'NOT_ELIGIBLE', rulesetVersion, journeyRoute?, reasons: string[], nextScreen }`; `evaluateEligibility(input, rulebook): EligibilityDecision` where NOT_ELIGIBLE (amount below minimum) wins over ASSISTED.

- [x] Write failing tests (phone normalisation table, masking, email normalisation, customer transitions, challenge expiry/attempts, otp length and digest determinism, application step idempotency and version bump, eligibility matrix incl. precedence and unknown values → ValidationError).
- [x] Run → FAIL. Implement. Run → PASS. Commit `feat(domain): customer, application, challenge and eligibility model`.

---

### Task 2: Persistence for identity and onboarding

**Files:**
- Modify: `prisma/schema.prisma` (schemas `identity`, `onboarding`), new migration `phase2_identity_onboarding`
- Create ports: `src/application/ports/customer.repository.port.ts`, `application.repository.port.ts`, `challenge.repository.port.ts`, `session.repository.port.ts`, `eligibility.repository.port.ts`, `analytics.port.ts`
- Create: `src/infrastructure/persistence/repositories/customer.repository.ts`, `application.repository.ts`, `challenge.repository.ts`, `session.repository.ts`, `eligibility.repository.ts`, `analytics-outbox.repository.ts`
- Test: DB-backed specs per repository (scoped ids, as in Phase 1).

**Interfaces:**
- Tables: `identity.customers(id text pk, phone_ciphertext bytea, phone_fingerprint text unique, phone_verified_at, email_ciphertext bytea null, email_fingerprint text null, email_verified_at null, state, version int, created_at, updated_at)`; `identity.auth_challenges(id pk, channel, purpose, target_fingerprint, customer_id null, application_id null, status, expires_at, resend_after, created_at, verified_at null, correlation_id)`; `identity.sessions(id pk, token_hash unique, customer_id, created_at, expires_at, revoked_at null, last_seen_at)`; `onboarding.onboarding_applications(id pk, customer_id, status, journey_version, next_screen, version int, created_at, updated_at)` with partial unique index on `(customer_id) where status='IN_PROGRESS'`; `onboarding.application_steps(application_id, step_id, status, version, completed_at; pk (application_id, step_id))`; `onboarding.eligibility_decisions(id, application_id, version int, customer_type, residential_status, intended_investment_inr bigint, distribution_route, status, ruleset_version, journey_route null, reasons jsonb, decided_at; unique (application_id, version))`.
- `CustomerRepositoryPort { findByPhoneFingerprint(fp, tx?); findById(id, tx?); create(c, tx?); saveWithVersionCheck(c, tx?) /* throws StaleVersionError */ }` (encrypts/decrypts via `FieldCipher`, fingerprints via `Fingerprint`).
- `ApplicationRepositoryPort { findById(id, tx?); findInProgressByCustomer(customerId, tx?); create(app, tx?); saveWithVersionCheck(app, tx?) }` (steps saved with the aggregate).
- `ChallengeRepositoryPort { create(ch, tx?); findById(id, tx?); update(ch, tx?) }`; `SessionRepositoryPort { create(s, tx?); revoke(tokenHash) }`; `EligibilityRepositoryPort { append(decision, tx?) ; latest(applicationId) }`; `AnalyticsPort { track(event: { name, applicationId?, screenId, outcome?, safeErrorCategory?, identity? }, tx?) }` writing `analytics_outbox` with the allowlist only.

- [x] Write failing DB specs; migrate; implement; PASS; commit `feat(persistence): identity and onboarding tables and repositories`.

---

### Task 3: Messaging adapters

**Files:**
- Create ports: `src/application/ports/sms-sender.port.ts` (`send(to: PhoneNumber, template: 'OTP', vars: { otp, expiresInMinutes }): Promise<{ accepted: boolean; providerRef?: string }>`), `email-sender.port.ts` (same shape with `to: EmailAddress`).
- Create: `src/infrastructure/messaging/log-sms.sender.ts` (logs masked destination and NEVER the otp; in `local`/`test` also exposes `lastSent` for SIT via an in-memory `MessageSpy`), `smtp-email.sender.ts` (nodemailer to `SMTP_HOST:SMTP_PORT`, plain text OTP mail), `messaging.module.ts`.
- Test: `log-sms.sender.spec.ts` (asserts otp absent from log fields), `smtp-email.sender.spec.ts` (nodemailer transport mocked).

- [x] Commit `feat(messaging): sms/email sender ports with log and smtp adapters`.

---

### Task 4: Session and pre-auth infrastructure and guards

**Files:**
- Create: `src/application/ports/token-store.port.ts` → `PreAuthTokenStore { issue(binding: { purpose; phoneFingerprint }): Promise<string>; resolve(token): Promise<binding|null>; revoke(token) }`, `SessionStore { issue(customerId, applicationIds): Promise<string>; resolve(token): Promise<{ customerId; applicationIds }|null>; touch(token); revoke(token) }`.
- Create: `src/infrastructure/cache/preauth-token.store.ts`, `session.store.ts` (Redis via `KvStorePort`, hashes tokens, TTLs from `authConfig`).
- Create: `src/common/auth/preauth.guard.ts` (Bearer → PREAUTH principal `{ kind:'PREAUTH', id: phoneFingerprint, challengeId? }`), `session.guard.ts` (Bearer → CUSTOMER principal, touches TTL), `application-ownership.guard.ts` (path `application_id` ∈ `principal.applicationIds` else 403), decorators `@UsePreAuth()`, `@UseSession()`.
- Test: store specs (docker redis), guard specs (mocked stores).

- [x] Commit `feat(auth): pre-auth and session token stores and guards`.

---

### Task 5: Phone challenge service and endpoint (Screen 01)

**Files:**
- Create: `src/application/auth/phone-challenge.service.ts`, `src/application/auth/otp.service.ts` (shared OTP create/verify/resend mechanics over `KvStorePort`, `Fingerprint`, `cryptoConfig.otpHmacKeyBase64`, `OtpPolicy`), `src/api/v1/auth/phone-challenge.controller.ts`, DTOs `create-phone-challenge.dto.ts` (`phone`, `purpose` = `PMS_ONBOARDING`, `privacy_notice_version`), response DTOs.
- Test: `otp.service.spec.ts` (docker redis), `phone-challenge.service.spec.ts` (ports mocked), controller spec (supertest with mocked service).

**Interfaces:**
- `OtpService.create({ channel, targetFingerprint, purpose, customerId?, applicationId?, policy }) → { challenge: Challenge, otp: string }` (stores digest+attempts in Redis, TTL); `verify({ challenge, otp }) → 'OK' | 'INVALID' | 'LOCKED' | 'EXPIRED'` (atomic attempt increment; on OK `getAndDel`); `supersede(challenge)`.
- `PhoneChallengeService.create(cmd: { phone, purpose, privacyNoticeVersion, clientIp }) → { challengeId, status, expiresInSeconds, resendAfterSeconds, phoneMasked, preauthToken }`: rate-limit (phone fp, ip) → uow { find or create UNVERIFIED customer; challenge row; audit; analytics `Phone Challenge Created` } → OTP to Redis → dispatch via `SmsSenderPort` → challenge status DISPATCHED/DISPATCH_FAILED + analytics `OTP Dispatch Updated` → issue pre-auth token.
- Response `202` body exactly `{ challenge_id, status, expires_in_seconds, resend_after_seconds, phone_masked, preauth_token }`.

- [x] Commit `feat(auth): phone challenge creation (screen 01)`.

---

### Task 6: Phone verify and session issuance (Screen 02, verify)

**Files:**
- Modify: `phone-challenge.service.ts` (`verify`), controller; create `src/application/onboarding/application-lifecycle.service.ts` (`createOrResume(customerId, now, tx) → { application, created: boolean }`).
- Test: service spec incl. Review Focus 1 and 3; DB-backed concurrency spec using two parallel verifies.

**Interfaces:**
- `verify(cmd: { challengeId, otp, principal: PREAUTH }) → { status:'VERIFIED', customerId, applicationId, nextScreen:'EMAIL_ENTRY', sessionToken }`; errors: challenge not found / fingerprint mismatch → `OtpInvalidError`; LOCKED/EXPIRED/INVALID → `OtpInvalidError`; Redis failure → `DependencyUnavailableError`.
- Transaction: customer `verifyPhone`; application create (status IN_PROGRESS, nextScreen EMAIL_ENTRY, step PHONE_VERIFIED) or resume; challenge VERIFIED; session row; audit; outbox `ApplicationCreated`/`ApplicationResumed`; analytics `Phone Verification Completed` + `Application Created|Resumed`. Pre-auth token revoked after commit.

- [x] Commit `feat(auth): phone OTP verification, application create/resume, session issuance (screen 02)`.

---

### Task 7: Resend (phone) and cooldown

- `resend(cmd: { challengeId, principal }) → { challengeId (new), status, expiresInSeconds, resendAfterSeconds }`; 429 `RateLimitedError(retryAfter)` inside cooldown; old challenge SUPERSEDED and Redis key deleted; abuse counters (per phone) still apply.
- [x] Tests incl. Review Focus 4. Commit `feat(auth): phone challenge resend with cooldown`.

---

### Task 8: Email challenge, verify, resend (Screens 03–04)

**Files:**
- Create: `src/application/onboarding/email-verification.service.ts`, `src/api/v1/onboarding/email-challenge.controller.ts`, DTOs.
- Guards: `SessionGuard` + `ApplicationOwnershipGuard`.
- Behaviour: create → validate/normalise email, rate limit per application, store proposed email on customer (unverified, encrypted), challenge bound to customer+application, OTP via `EmailSenderPort`, 202 `{ challenge_id, status, email_masked, expires_in_seconds }`; verify → OTP check (channel EMAIL, purpose EMAIL_VERIFICATION, application match), customer `verifyEmail`, step EMAIL_VERIFIED, nextScreen ELIGIBILITY, 200 `{ status:'VERIFIED', next_screen:'ELIGIBILITY' }`; resend → `{ challenge_id, status }`. Changing the email supersedes the pending challenge.
- [x] Tests incl. Review Focus 2. Commit `feat(onboarding): email verification (screens 03-04)`.

---

### Task 9: Eligibility (Screen 05) and application read

**Files:**
- Create: `src/application/onboarding/eligibility.service.ts`, `src/api/v1/onboarding/eligibility.controller.ts`, `application.controller.ts` (GET), DTOs with class-validator (`customer_type` enum, `residential_status` enum, `intended_investment_inr` positive integer, `distribution_route` enum).
- `EligibilityService.evaluate(applicationId, input, principal) → { status, rulesetVersion, journeyRoute, nextScreen }`: load app (must have EMAIL_VERIFIED, else 422 ACTION_REQUIRED), evaluate rulebook, append decision (version = app.version+1), application nextScreen/status, audit, analytics `Eligibility Evaluation Completed`.
- `GET /v1/onboarding/applications/{id}` → `{ application_id, status, next_screen, version, journey_version, steps: [{ step_id, status, completed_at }] }`.
- [x] Tests incl. Review Focus 5. Commit `feat(onboarding): eligibility decision and application resume read (screen 05)`.

---

### Task 10: Module wiring, Swagger, Postman, SIT journey

**Files:**
- Create: `src/api/v1/auth/auth-api.module.ts`, `src/api/v1/onboarding/onboarding-api.module.ts`, `src/application/application.module.ts`; register in `ApiModule`. Swagger decorators on every DTO/endpoint; `@ApiBearerAuth('session')`.
- Create: `postman/wmc_pms.postman_collection.json` (journey folder with tests that chain `preauth_token`, `challenge_id`, `session_token`, `application_id`; OTP read from Mailpit API for email and from the local log-sender spy endpoint is **not** exposed — document that local SMS OTPs are printed by the log sender at debug level only in `APP_ENV=local`).
- Create: `test/sit/journey-01-05.sit.ts`: full flow with `SmsSenderPort` overridden by an in-memory spy; asserts each `next_screen`, idempotent replay of the challenge creation, rate limit 429 on the 6th challenge, 403 on another customer's application, 409 on a stale eligibility version, and that `analytics_outbox` rows contain no phone/email/otp.
- [x] `make sit` green; coverage gate green; commit `feat(api): phase 2 modules, swagger, postman and SIT journey`.
