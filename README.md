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
| webhook | `POST /v1/integrations/digio/webhooks` | `X-Digio-Checksum` HMAC |

All mutating routes require an `Idempotency-Key` header. Swagger documents request and response shapes at `/docs`.
`postman/wmc_pms.postman_collection.json` chains the journey; email OTPs are visible in Mailpit at
http://localhost:8025, phone OTPs are never logged (the SIT suite reads them through an in-memory spy).

Rulebooks live in `config/rulebooks/` (eligibility, KYC reliance, document requirements, IPV thresholds); all are
placeholder content pending Compliance. Digio API references used for the connectors are under `docs/partners/digio/`.

The worker (`npm run start:worker`) must be running for screens 06–11: KRA lookup, DigiStudio status polling,
document verification, IPV evaluation and webhook processing all run as queue jobs fed by the transactional outbox.

## Partner credentials

Secrets never go in the repo. Digio sandbox credentials come from your Digio account manager; TrackWizz and MF
Central UAT credentials are supplied by those vendors. Put them in `.env`.
