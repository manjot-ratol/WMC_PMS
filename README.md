# WMC PMS backend

NestJS backend for JioBlackRock's PMS (Portfolio Management Service) customer onboarding.

- Design: `docs/superpowers/specs/2026-10-18-pms-onboarding-backend-design.md`
- Plans: `docs/superpowers/plans/`
- Platform guide (correlation, logging, errors, HTTP connector, persistence, queues): `docs/README-platform.md`
- Partner reference payloads: `docs/partners/`

## Quick start

```bash
npm install
make up                                   # docker infra: postgres, redis (host port 6380), minio, wiremock, mailpit
cp .env.example .env                      # then set FIELD_ENCRYPTION_KEY, FINGERPRINT_HMAC_KEY, OTP_HMAC_KEY (openssl rand -base64 32)
npx prisma migrate deploy
npm run start:api                         # API + Swagger at http://localhost:3000/docs
npm run start:worker                      # background jobs
```

## Testing

```bash
npm test          # unit tests with a 90% coverage gate (DB-backed specs use the docker infra; SKIP_DB_TESTS=1 to skip)
make sit          # system integration tests: real app, real postgres/redis, WireMock partners
npm run lint
```

## API surface so far (Phase 2)

| Screen | Endpoint | Auth |
| --- | --- | --- |
| 01 | `POST /v1/auth/phone/challenges` | none (rate limited per phone and IP) |
| 02 | `POST /v1/auth/phone/challenges/{id}/verify`, `…/resend` | pre-auth bearer from screen 01 |
| resume | `GET /v1/onboarding/applications/{id}` | session bearer |
| 03 | `POST /v1/onboarding/applications/{id}/email/challenges` | session bearer |
| 04 | `…/email/challenges/{cid}/verify`, `…/resend` | session bearer |
| 05 | `PUT /v1/onboarding/applications/{id}/eligibility` | session bearer |

| 06 | `POST …/identity-verifications` (202, starts the KRA lookup job) | session bearer |
| 07 | `GET …/kyc` (read-only status, route and next screen) | session bearer |
| 08 | `PUT …/kyc/confirmation` (409 on stale `kyc_record_version`) | session bearer |
| 09 | `POST …/kyc/sessions` (DigiStudio request + SDK token) | session bearer |
| 10 | `POST …/document-uploads` (presigned PUT), `POST …/documents` (202, verified by the worker) | session bearer |
| 11 | `POST …/kyc/additional-verifications` (selfie liveness/face match, exemption, or assisted) | session bearer |
| 12 | `PUT …/profile` (409 on stale `profile_version`) | session bearer |
| 13 | `PUT …/declarations` (queues screening and AML rows for the compliance jobs) | session bearer |
| 14 | `POST …/bank-verifications` (202; Digio bank verification runs in the worker) | session bearer |
| 15 | `GET …/bank-verifications/{id}` (read-only result and remediation) | session bearer |
| 16 | `PUT …/nomination` | session bearer |
| 17 | `POST …/suitability-assessments` (scored server-side; INCOMPLETE until every question is answered) | session bearer |
| 18 | `PUT …/investment-approach` (only an approach the assessment permits; 409 on a stale assessment) | session bearer |
| 19 | `POST …/fee-illustrations`, `POST …/acknowledgements` (409 on an outdated document pack) | session bearer |
| 20 | `GET …/review` (masked summary, versions, gates), `POST …/review-confirmations` (immutable snapshot; 409 on a stale `application_version`) | session bearer |
| 21 | `POST …/signing-sessions` (201; pack rendered server-side, one Digio eSign request per snapshot), `GET …/signing-sessions/{id}` | session bearer |
| 22 | `GET …/status` (customer-visible tasks only), `POST …/tasks/{id}/responses` | session bearer |
| 23 | `GET …/funding-instructions` (released only after execution and account readiness), `POST …/funding-notifications` (202, a hint) | session bearer |
| 24 | `GET …/funding-status` (reconciled funds and activation readiness) | session bearer |
| 25 | `GET …/completion` (backend-confirmed ACTIVE only) | session bearer |
| internal | `POST /internal/v1/applications/{id}/account-opening-runs`, `…/underlying-accounts`, `…/funding-receipts` (feeds keyed by `provider_receipt_key`; replays are acknowledged, never double-counted) | `X-Internal-Token` |
| webhook | `POST /v1/integrations/digio/webhooks` (KRA status, DigiStudio and DigiSign events) | `X-Digio-Checksum` HMAC |

All mutating routes require an `Idempotency-Key` header. Swagger documents request and response shapes at `/docs`.
`postman/wmc_pms.postman_collection.json` chains the journey; email OTPs are visible in Mailpit at
http://localhost:8025, phone OTPs are never logged (the SIT suite reads them through an in-memory spy).

Rulebooks live in `config/rulebooks/` (eligibility, KYC reliance, document requirements, IPV thresholds, profile vocabulary, tax, bank name-match thresholds, nomination, suitability questionnaire/scoring/approach map, fee schedule and illustration scenarios, document pack matrix, account-opening registries, funding, activation gates); document templates in `config/document-templates/`; all are
placeholder content pending Compliance. Digio API references used for the connectors are under `docs/partners/digio/`.

The worker (`npm run start:worker`) must be running for screens 06–11: KRA lookup, DigiStudio status polling,
document verification, IPV evaluation and webhook processing all run as queue jobs fed by the transactional outbox.

## Partner credentials

Secrets never go in the repo. Digio sandbox credentials come from your Digio account manager; TrackWizz and MF
Central UAT credentials are supplied by those vendors. Put them in `.env`.
