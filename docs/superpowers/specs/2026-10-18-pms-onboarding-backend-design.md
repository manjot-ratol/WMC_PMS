# PMS Onboarding Backend — Design

Date: 2026-10-18 · Status: owner decisions folded in, awaiting approval · Repo: `wmc_pms`

## 1. Intent

Build the backend for JioBlackRock's Portfolio Management Service (PMS) customer onboarding, as described in
`PMS_Onboarding_Screen_Specifications 1.html` (v3): 25 customer screens, 4 backend-only workflows, and the
partner integrations they depend on (Digio, TrackWizz, CleverTap), plus connectors for MF Central and Ignosis
from the partner documentation folder. The product spec is treated as the functional contract; this document
covers how it is engineered.

Why now: the frontend teams need a stable, documented `/v1` API to build against, and Compliance needs a
backend whose state transitions, evidence and audit trail match SEBI's PMS onboarding obligations.

## 2. Goals, non-goals, anti-goals

Goals
- Every `/v1` endpoint, status value and `next_screen` in the spec, with the spec's error envelope.
- Partner connectors behind one common outbound HTTP layer, each partner's wire format isolated in an adapter.
- Full observability per request: one correlation id across incoming request, logs, DB writes, outbound calls
  and async jobs it spawns.
- Runs entirely on a developer laptop with `docker compose up` (API, worker, Postgres, Redis, MinIO, mock partners).
- Unit coverage above 90% enforced in CI; system integration tests (SIT) run the real app against real
  Postgres/Redis and stubbed partners.
- Swagger (OpenAPI 3) generated from code and served at `/docs`, exported to `openapi/openapi.json`.
- Clean layering: controllers never touch the DB; business services never contain SQL or vendor payloads.

Non-goals (this phase)
- Frontend, mobile SDK wrappers, CleverTap dashboards.
- Portfolio management after activation (orders, holdings, reporting) except the MF Central / Ignosis connectors.
- Production infrastructure (Kubernetes, secrets manager, WAF). Docker Compose is for local only.
- Replacing the spec's open vendor decisions with guesses. Where the product spec marked a vendor contract
  "unresolved", the Digio docs site is the source of truth; anything still missing is requested from the owner.

Anti-goals (would make this a failure even if it "works")
- A frontend-trusted state transition (e.g. client sets `ACTIVE`, SDK callback completes KYC).
- OTP, PAN, Aadhaar, bank, PEP, AML or token values appearing in logs, analytics, or Redis key names.
- Vendor field names or codebooks leaking into domain models or API DTOs.
- Queries or vendor payload construction inside business services.

## 3. Constraints

- SEBI (Portfolio Managers) Regulations 2020 and related circulars. Section 10 maps each obligation to a gate.
- Node 21 on the dev machine; Nest 11 CommonJS build. Add-on packages must be CJS-compatible (see memory note).
- Partner contracts: all Digio APIs are taken from documentation.digio.in (OpenAPI JSON per page is
  retrievable); TrackWizz AS501 v1.7; MF Central UAT collection; Ignosis analytics JSON. Where the product
  spec marked a Digio contract as unresolved (bank verification, signing, DigiStudio status), the docs site
  has it and it is used directly. Anything genuinely missing is requested from the owner, not stubbed.
- Existing code: `src/connectors/digio` (KRA connector + HTTP client) from the first iteration is refactored onto
  the new common HTTP layer, not thrown away.

## 4. Architecture

Modular monolith, one NestJS codebase producing two processes from the same image:

- `api` — HTTP server, `/v1`, `/internal/v1`, webhooks, `/docs`, `/health`.
- `worker` — BullMQ consumers for async jobs and the outbox dispatcher. Same DI container, no controllers.

### 4.1 Layers (dependency rule: outer depends on inner, never the reverse)

```
src/
  app/                      composition roots: api.module.ts, worker.module.ts, main.ts, worker.ts
  common/                   cross-cutting, no business knowledge
    correlation/            CorrelationMiddleware, CorrelationStore (AsyncLocalStorage), decorators
    logging/                LoggerService (pino), redaction, request/response logging interceptor
    http/                   HttpClientService (the single outbound connector) + policies
    errors/                 AppError hierarchy, ErrorEnvelopeFilter (spec error shape), error codes
    config/                 typed config via registerAs + validation
    crypto/                 FieldCipher (AES-256-GCM), Fingerprint (HMAC-SHA256), constant-time compare
    idempotency/            IdempotencyInterceptor (Idempotency-Key), durable idempotency_records
    auth/                   SessionGuard, PreAuthGuard, InternalServiceGuard, Principal decorator
    validation/             global ValidationPipe config, custom validators (PAN, IFSC, ISO date)
    swagger/                OpenAPI setup, shared schema decorators
  domain/                   pure TypeScript, no Nest decorators, no I/O
    onboarding/             Application aggregate, step state machine, versioning rules, gates
    identity/, kyc/, bank/, nomination/, suitability/, documents/, funding/, compliance/
    shared/                 value objects (Pan, Ifsc, IsoDate, Money), DomainError, Result
  application/              use-case services, orchestrate domain + ports; transaction boundaries live here
    ports/                  interfaces: repositories, partner gateways, messaging, clock, id generator
    onboarding/, auth/, kyc/, bank/, ... one service per screen group
    jobs/                   job handlers (screening, aml, account-opening, webhook-processing, outbox)
  infrastructure/           adapters implementing ports
    persistence/            Prisma schema, migrations, repositories, UnitOfWork, outbox/inbox tables
    cache/                  Redis client, OtpStore, RateLimiter, SessionStore, LockService
    queue/                  BullMQ producers/consumers
    storage/                S3-compatible object storage (MinIO locally)
    partners/
      digio/                KRA, DigiStudio, CKYC, webhook verifier; mappers to/from domain
      trackwizz/            AS501 envelope crypto, screening + risk-rating gateways, codebooks
      mfcentral/            OAuth token, encrypt/sign/decrypt, CAS request, QR validation
      ignosis/              analytics response parser + typed model
      clevertap/            event upload gateway
      messaging/            SmsSender / EmailSender ports with LogSender (local) implementation
  api/                      Nest controllers + request/response DTOs (class-validator + swagger decorators)
    v1/auth, v1/onboarding, v1/integrations, internal/v1, health
```

Rules that make SOLID concrete here
- Controllers: parse, validate, authorise, call one application service, map to DTO. Nothing else.
- Application services depend on **ports** (interfaces) only; infrastructure is bound in modules. Swapping
  Digio for another KYC vendor touches `infrastructure/partners` and one module binding.
- Repositories expose intent-named methods (`findActiveByCustomer`, `saveWithVersionCheck`) and return domain
  objects. Prisma types never cross the port boundary.
- Each partner adapter has three files per operation: `*.gateway.ts` (calls `HttpClientService`),
  `*.mapper.ts` (domain ⇄ vendor DTO, codebooks live here), `*.types.ts` (vendor wire types).
- State changes go through the domain state machine (`ApplicationStep.transition(...)`) which returns the
  events to emit; the service persists the aggregate, audit, and outbox rows in one transaction.

### 4.2 Correlation id

- `CorrelationMiddleware` runs first. Reads `X-Correlation-ID` (preferred) or `X-Request-ID`; if neither is a
  valid id (1–128 printable chars) it generates a UUID v4. Stores `{correlationId, requestId, principalId?}`
  in `AsyncLocalStorage`. Echoes `X-Correlation-ID` on every response, and uses it as `request_id` in the
  spec's error envelope.
- `LoggerService` reads the store on every log call, so every line in the request carries the same id without
  callers passing it.
- `HttpClientService` injects `X-Correlation-ID` on every outbound call, and the partner's own reference header
  where the vendor defines one (Digio `X_REFERENCE_ID`, TrackWizz `requestId`, MF Central `clientRefNo`).
- Jobs: producers copy the current correlation id into the job payload; consumers restore it into the store
  before running, so worker logs join the originating request. Webhooks get their own id plus the stored
  correlation id of the originating request once the payload is matched.

### 4.3 Logging service

- `pino` under a Nest `LoggerService` implementation with structured JSON, levels per environment, pretty
  printing in local. Fields: `ts, level, msg, correlationId, requestId, principalId, module, event, durationMs`.
- Redaction is default-on: configured key list (`otp, pan, pan_no, aadhaar, uid_no, account_number, tin,
  password, authorization, access_token, token, secret`) replaced with `[REDACTED]` at serialisation. A unit
  test asserts the list against the domain's sensitive-field catalogue.
- Request logging interceptor logs method, route template (not raw URL with ids), status, duration. Bodies are
  never logged at info level; at debug they pass through redaction.
- Outbound call logging in `HttpClientService`: partner, operation name, status, duration, vendor reference id.
  Never bodies.

### 4.4 Common outbound HTTP connector

`HttpClientService` (common/http) is the only place that imports axios.

```ts
request<TRes>(spec: {
  partner: 'digio' | 'trackwizz' | 'mfcentral' | 'ignosis' | 'clevertap' | 'messaging';
  operation: string;                 // e.g. 'kra.fetchDetails' — used for logs/metrics
  method, url, headers?, query?, body?, responseType?: 'json' | 'arraybuffer';
  auth?: BasicAuth | BearerAuth | ApiKeyAuth | None;
  timeoutMs?, retry?: { attempts, backoffMs, retryOn: (err) => boolean };
  idempotencyKey?: string;
}): Promise<HttpResult<TRes>>       // { status, headers, data, durationMs }
```

- Adds correlation header, per-partner default timeout, retry policy (only on network errors and 5xx, never on
  4xx, never on non-idempotent calls unless the vendor contract says so), circuit breaker per partner (opossum).
- Maps failures to `PartnerHttpError { partner, operation, status?, code?, body?, retryable }`. Partner
  gateways translate that to domain-level outcomes (`PartnerUnavailable`, `PartnerRejected`, …). Business
  services never see axios.
- Partner gateways are the only callers. The existing `DigioHttpClient` is replaced by a thin
  `DigioGateway` base over `HttpClientService`.

### 4.5 Database layer

- PostgreSQL 16. Prisma 6 for schema, migrations and the typed client (**my call**; alternatives considered:
  TypeORM, Knex. Prisma gives migration discipline and generated types with the least ceremony; its client is
  confined to `infrastructure/persistence`).
- One repository per aggregate; `UnitOfWork.run(async (tx) => …)` wraps a Prisma interactive transaction and
  hands repositories a transaction scope. Business services call `uow.run` and repositories; no raw queries.
- Optimistic concurrency: aggregates carry `version`; `saveWithVersionCheck` throws `StaleVersionError` → 409.
- Sensitive columns stored as `bytea` ciphertext via `FieldCipher` (AES-256-GCM, key from env, key id stored
  alongside for rotation) plus a separate HMAC fingerprint column for lookups (`pan_fingerprint`,
  `phone_fingerprint`, `account_fingerprint`). Encryption/decryption happens in repository mappers.
- Tables (from the spec's data model, grouped by schema):
  - `identity`: customers, customer_contacts, auth_challenges, sessions, permissions
  - `onboarding`: onboarding_applications, application_steps, eligibility_decisions, identity_versions,
    kyc_records, kyc_sessions, additional_verifications, documents, document_uploads, customer_profiles,
    declarations, bank_verifications, nominations, suitability_assessments, investment_approaches,
    fee_illustrations, acknowledgements
  - `execution`: document_packs, document_snapshots, signing_sessions, underlying_accounts,
    registry_submissions, tasks
  - `compliance` (restricted role): screening_runs, aml_assessments, compliance_cases, review_decisions
  - `funding`: funding_instructions, funding_notifications, funding_receipts, reconciliations, activations
  - `reliability`: idempotency_records, integration_inbox, business_outbox, audit_events, analytics_outbox
- Redis (ioredis): OTP challenges, rate limits, sessions, locks, short-lived caches. Keys use fingerprints,
  never raw identifiers. Redis is never the only copy of anything durable.

### 4.6 Async work

- BullMQ queues: `identity-verification`, `kyc-status`, `document-processing`, `bank-verification`,
  `screening`, `aml-assessment`, `account-opening`, `webhook-processing`, `outbox-dispatch`,
  `analytics-dispatch`, `activation`.
- Transactional outbox: services write `business_outbox` rows in the same transaction as the state change; the
  dispatcher publishes to queues/CleverTap and marks rows sent. Consumers are idempotent (job key = outbox id).
- Inbox: webhooks are persisted to `integration_inbox` (unique on provider + event id) before `200 {received:true}`;
  processing happens in the worker with version-aware state rules.

### 4.7 Auth model

- Pre-auth: phone challenge returns a short-lived opaque token bound to `challenge_id`; only valid for
  verify/resend of that challenge.
- Session: after OTP verification an opaque session token (random 256-bit, stored hashed in Redis with TTL and
  in `sessions` for audit/revocation) is returned in the body for mobile and as an HttpOnly cookie for web.
  `SessionGuard` resolves the principal; every `/v1/onboarding/applications/{id}` route also checks the
  application belongs to the principal (`OwnershipGuard`).
- Internal endpoints (`/internal/v1`) require a service credential header (`X-Internal-Token`, constant-time
  compare against configured secret) and are not reachable through the public API gateway.
- Webhooks: Digio callback authenticated per Digio's webhook guide (shared secret / signature as configured);
  verifier is an adapter so the exact mechanism can be swapped when pinned.

### 4.8 Idempotency, versions, errors

- `Idempotency-Key` required on all mutating `/v1` routes (spec rule). Stored in `idempotency_records`
  keyed by (principal, route, key) with the response hash; replay returns the stored response; mismatched
  body returns 422 `IDEMPOTENCY_MISMATCH`.
- Error envelope exactly as the spec: `{ "error": { "code", "message", "retryable" }, "request_id" }`.
  Mapping: validation 422 `ACTION_REQUIRED`/`VALIDATION_FAILED`, auth 401/403, stale 409 `STALE_VERSION`,
  rate limit 429 `RATE_LIMITED`, partner down 503 `VERIFICATION_UNAVAILABLE`. Messages are customer-safe;
  partner details go to logs only.

### 4.9 Analytics (CleverTap)

Backend events are written to `analytics_outbox` in the committing transaction with the allowlisted
properties only (event_id, application_id, screen_id, journey_version, event_schema_version, event_source,
attempt_number, outcome, safe_error_category). The dispatcher posts to CleverTap's upload API. A unit test
asserts no event schema contains a denylisted property. Local runs use a logging sink.

## 5. API surface

All `/v1` endpoints from the spec, same paths, methods, bodies and `next_screen` values:

| Group | Endpoints |
| --- | --- |
| Auth | `POST /v1/auth/phone/challenges`, `…/{id}/verify`, `…/{id}/resend` |
| Contact | `POST …/email/challenges`, `…/{id}/verify`, `…/{id}/resend` |
| Eligibility | `PUT …/eligibility` |
| Identity/KYC | `POST …/identity-verifications`, `GET …/kyc`, `PUT …/kyc/confirmation`, `POST …/kyc/sessions`, `POST …/kyc/additional-verifications` |
| Documents | `POST …/document-uploads`, `POST …/documents` |
| Profile | `PUT …/profile`, `PUT …/declarations` |
| Bank | `POST …/bank-verifications`, `GET …/bank-verifications/{id}` |
| Nomination | `PUT …/nomination` |
| Suitability | `POST …/suitability-assessments`, `PUT …/investment-approach` |
| Fees | `POST …/fee-illustrations`, `POST …/acknowledgements` |
| Review/sign | `POST …/review-confirmations`, `POST …/signing-sessions`, `GET …/signing-sessions/{id}` |
| Processing | `GET …/status`, `POST …/tasks/{id}/responses` |
| Funding | `GET …/funding-instructions`, `POST …/funding-notifications`, `GET …/funding-status`, `GET …/completion` |
| Internal | `POST /internal/v1/applications/{id}/screening-runs`, `…/aml-assessments`, `…/account-opening-runs`, `POST …/funding-receipts`, `POST …/underlying-accounts`" |
| Webhooks | `POST /v1/integrations/digio/webhooks` |
| Platform | `GET /health`, `GET /health/ready`, `GET /docs`, `GET /docs-json` |

(`…` = `/v1/onboarding/applications/{application_id}`.) Additional application-level reads the frontend needs
to resume (`GET /v1/onboarding/applications/{id}` returning current step, versions and `next_screen`) are
included; they are side-effect free.

## 6. Partner connectors

| Partner | Operations | Status |
| --- | --- | --- |
| Digio KRA | check PAN status, fetch details, upload/update, download documents (ZIP), status webhook | Documented; built |
| Digio DigiStudio | create workflow request with template, regenerate access token, re-attempt actions, approve/reject request | Documented at documentation.digio.in/digistudio; request status read via the additional APIs and DigiSign webhooks |
| Digio CKYC | register (multipart) | Documented from spec appendix; built |
| Digio bank account verification | penny drop, pennyless, reverse penny drop, IFSC verification | Documented at documentation.digio.in/digikyc/bank_account_verification; built |
| Digio eSign (DigiSign) | create sign request, invoke SDK, get document details, download document, cancel, webhooks | Documented at documentation.digio.in/digisign; built |
| Digio face authentication / video KYC | face match, liveness check | Documented; built where the IPV route needs it |
| Digio standalone PAN verification | — | Not on the docs site under DigiKYC; KRA check-PAN-status covers the identity step. Owner supplies any extra Digio contract on request |
| TrackWizz AS501 | envelope encrypt/sign/decrypt/verify; screening (purpose 01/03 + 04); risk rating (purpose 06) | Built; crypto parameters behind a `TrackWizzCryptoProfile` config because the doc is ambiguous (AES mode, RSA padding); both documented response shapes parsed, with mismatch → integration exception, never default to Proceed |
| MF Central | token, encrypt, sign, newCasRequest, decrypt, redirect URL, validateQRCode | Built as a gateway; no business wiring this phase (§13) |
| Ignosis | parse analytics JSON into typed model (overall, account-wise, salary, EMI, mutual funds) | Parser + types only; no API contract supplied |
| CleverTap | upload events | Built, logging sink locally |
| SMS / Email | send OTP | Port + `LogSender` locally; real provider is an open decision in the spec |

Mock partner server: WireMock (`wiremock/wiremock` container) with JSON stub mappings under
`tools/wiremock/mappings` for every partner operation above, scenario-driven via WireMock scenarios and
response templating. Used by docker compose and SIT; TrackWizz encrypted responses are produced by a small
SIT helper that encrypts canned payloads with the test key pair so the real crypto path is exercised.

## 7. Local infrastructure (Docker)

`docker-compose.yml`: `api`, `worker`, `postgres:16`, `redis:7`, `minio`, `wiremock`, plus `mailpit`
for email OTP visibility. One `Dockerfile` (multi-stage, distroless runtime). `make up / down / migrate /
seed / test / sit`. `.env.example` lists every variable; secrets never committed (the MF Central UAT JSON in
the parent folder contains live credentials and must be moved to `.env`, not copied into the repo).

## 8. Testing

- Unit (Jest): domain, application services (ports mocked), mappers, guards, middleware, crypto, HTTP client
  (nock). Coverage thresholds 90% lines/branches/functions in `jest.config`, CI fails below.
- SIT (`test/sit`): boots the full Nest app against docker Postgres/Redis/MinIO and WireMock; drives
  the 25-screen journey end to end via supertest, plus webhook delivery, duplicate callback, stale version,
  idempotent replay, rate limiting and Redis-outage fail-closed scenarios. Runs in CI via docker compose.
- Contract tests for partner mappers against the sample payloads captured from the vendor docs
  (`test/fixtures/partners/*`).

## 9. Security baseline

HTTPS termination assumed upstream; helmet; strict CORS; body size limits; rate limiting per phone/IP/device
(Redis); constant-time OTP HMAC compare; OTP never persisted in plaintext (HMAC with challenge-bound key);
field-level encryption; least-privilege DB roles (`app_rw`, `compliance_ro`); audit_events append-only;
dependency audit in CI.

## 10. SEBI PMS obligations mapped to gates

Compliance must confirm the effective rule set; the backend enforces them as configuration-driven gates.

| Obligation (source) | Where enforced |
| --- | --- |
| Minimum investment per client (SEBI PM Regulations 2020, Reg. 23(2) states ₹50 lakh; owner states ₹25 lakh applies to this product) | Eligibility rule `MIN_INVESTMENT_INR` in the rulebook, default 2,500,000 per owner, effective-dated so Compliance can change it without a release; funding gate counts only reconciled qualifying funds |
| KYC via SEBI-registered KRA; KYC records uploaded to KRA within regulatory timeline | KYC gate (reuse/fresh), KRA register job with tracked deadline in `registry_submissions` |
| CKYC registration where applicable (PMLA / CERSAI) | Account-opening job, feature-flagged |
| PMLA client due diligence, screening and risk categorisation; PEP handling via EDD | TrackWizz screening + AML jobs; `compliance_cases`; High risk → EDD queue, not auto-reject |
| Disclosure Document provided before agreement (Reg. 22(6), Schedule V) | Acknowledgement of `DISCLOSURE` required before review/sign |
| Most Important Terms and Conditions (SEBI circular, 2023) | `MITC` acknowledgement required |
| Fee illustration / calculator and separately signed fee annexure with client's own statement (SEBI circular Feb 2020) | `fee-illustrations` endpoint; `fee_understanding_note` mandatory and not prefilled; fee annexure as separate document in pack |
| Written agreement per Schedule IV signed before accepting funds (Reg. 22) | Signing gate must be `EXECUTED` before funding instructions are released |
| Direct onboarding option without distributor (Reg. 22(7)) | `distribution_route` DIRECT supported, no distributor attribution required |
| Nomination with explicit opt-out (SEBI PMS nomination circular) | Nomination step cannot be skipped; opt-out is explicit, never preselected |
| Suitability / risk profiling before advising approach | Suitability must be COMPLETE before approach confirmation |
| Record keeping (5 years post relationship, PMLA / Reg. 27) | Append-only audit, evidence in object storage with retention tags |

## 11. Phasing (each phase is shippable and tested)

1. Platform: correlation, logging, errors, config, HTTP connector, Prisma + migrations, Redis, queues,
   swagger, docker compose, test harness, coverage gate. Migrate existing Digio KRA connector.
2. Screens 01–05: phone/email challenges, sessions, application lifecycle, eligibility rules.
3. Screens 06–11: identity, KRA lookup job, KYC routing, DigiStudio sessions, documents (MinIO), IPV.
4. Screens 12–16: profile, declarations (enqueue screening/AML), bank verification, nomination.
5. Screens 17–20: suitability engine, approach, fees/acknowledgements, review snapshot.
6. Screens 21–25 + jobs C/D: signing, account opening (KRA register, CKYC), webhooks/inbox, funding,
   activation worker.
7. Jobs A/B: TrackWizz crypto envelope, screening and AML gateways, compliance cases.
8. MF Central and Ignosis connectors; CleverTap dispatcher.
9. SIT suite completion, coverage to >90%, docs.

## 12. Builder decisions recorded after review

An independent builder review raised seven questions; these were settled by the author (my call) and are now
part of the design. The remaining ones are in the approval message.

- **Funding receipts and custodian results.** No bank/custodian contract is supplied, so ingestion is an
  internal, service-authenticated feed: `POST /internal/v1/applications/{id}/funding-receipts` and
  `…/underlying-accounts`, each with a provider receipt key for uniqueness. A `ReconciliationGateway` port
  with a stub sits behind a feature flag for the day a real contract arrives. SIT drives the feed, so
  "end to end" includes activation.
- **Rulebooks.** Eligibility, KYC reliance, IPV requirement, suitability questionnaire/scoring/approach map,
  fee schedule/illustration, and the document execution matrix are versioned JSON config under
  `config/rulebooks/*.v1.json` with placeholder content marked `PLACEHOLDER_PENDING_COMPLIANCE`. Engines are
  complete; content is a handoff task per rulebook. Phases ship with placeholder rules.
- **DigiStudio completion signal.** Each DigiStudio-backed session (KYC, bank, IPV, signing) is tracked by a
  status-poll job with backoff plus the single Digio webhook ingress, which dispatches by payload entity
  (`kra_register` today, DigiStudio request events when pinned). Sandbox template names and TrackWizz UAT
  access are recorded as external dependencies in the plan, not assumed.
- **Existing `/kyc/kra/*` routes.** Removed (owner decision). The connector itself is reused by the identity
  and account-opening services; the Postman "PMS API (local)" folder is replaced by the `/v1` journey.

## 13. Owner decisions (2026-10-18)

- **Customer scope:** resident individual, single holder. NRI, joint holders, non-individuals and the
  distributor route return `ASSISTED_REQUIRED` from eligibility with recorded basis. Domain models keep a
  holder list of length one so joint holders are an extension, not a rewrite.
- **Back-office API:** a minimal reviewer surface under `/internal/v1`: list open compliance cases and
  tasks, record a review decision (`PROCEED` / `HOLD` / `REJECT` with reason), accept bank evidence, resolve a
  clarification task. Authenticated by the service token plus a mandatory `X-Reviewer-Id` header recorded in
  `review_decisions` and `audit_events`.
- **Document pack:** generated server-side. A `DocumentRenderer` port with a PDF implementation
  (`pdf-lib`/`pdfmake`, CJS-compatible, builder's pick) renders from versioned templates in
  `config/document-templates/`, computes SHA-256 per document, stores files in MinIO, and the signing session
  pushes the files to Digio. Snapshot hashes are of our rendered PDFs.
- **MF Central and Ignosis:** connectors only. Tested gateways and typed models with no business wiring;
  a later phase decides the use case.

Builder decides (already chosen above): Prisma, BullMQ, pino, MinIO, opossum, mock-partner approach, directory
layout, table naming, PDF library.
