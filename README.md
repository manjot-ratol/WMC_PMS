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
| internal | `POST /internal/v1/applications/{id}/account-opening-runs`, `…/underlying-accounts`, `…/funding-receipts` (feeds keyed by `provider_receipt_key`; replays are acknowledged, never double-counted), `…/screening-runs`, `…/aml-assessments` (TrackWizz jobs A/B re-runs) | `X-Internal-Token` |
| reviewer | `GET /internal/v1/review/cases`, `GET …/tasks`, `POST …/cases/{id}/decisions` (PROCEED/HOLD/REJECT + reason), `POST …/applications/{id}/bank-evidence`, `POST …/tasks/{id}/resolution` | `X-Internal-Token` + mandatory `X-Reviewer-Id` (recorded on every decision and audit row) |
| webhook | `POST /v1/integrations/digio/webhooks` (KRA status, DigiStudio and DigiSign events) | `X-Digio-Checksum` HMAC |

All mutating routes require an `Idempotency-Key` header. Swagger documents request and response shapes at `/docs`.
`postman/wmc_pms.postman_collection.json` chains the journey; email OTPs are visible in Mailpit at
http://localhost:8025, phone OTPs are never logged (the SIT suite reads them through an in-memory spy).

Rulebooks live in `config/rulebooks/` (eligibility, KYC reliance, document requirements, IPV thresholds, profile vocabulary, tax, bank name-match thresholds, nomination, suitability questionnaire/scoring/approach map, fee schedule and illustration scenarios, document pack matrix, account-opening registries, funding, activation gates, TrackWizz codebooks); document templates in `config/document-templates/`.

TrackWizz AS501 runs through an encrypted envelope (`TrackWizzEnvelope`, parameters in `TRACKWIZZ_CRYPTO_PROFILE` until vendor test vectors are pinned). WireMock cannot encrypt, so local runs and SIT use the in-process mock: `npm run mock:trackwizz` (keys in `test/fixtures/trackwizz`, test-only).; all are
placeholder content pending Compliance. Digio API references used for the connectors are under `docs/partners/digio/`.

The worker (`npm run start:worker`) must be running for screens 06–11: KRA lookup, DigiStudio status polling,
document verification, IPV evaluation and webhook processing all run as queue jobs fed by the transactional outbox.

## Partner credentials

Secrets never go in the repo. Digio sandbox credentials come from your Digio account manager; TrackWizz and MF
Central UAT credentials are supplied by those vendors. Put them in `.env`.

## Analytics and other connectors

- Backend analytics events are written to `analytics_outbox` with allowlisted properties only and shipped by the worker's `analytics-dispatch` tick to CleverTap (`POST /1/upload`) when `CLEVERTAP_ENABLED=true`; otherwise a log sink records names and counts. The dispatcher re-applies the allowlist and logs a privacy incident for anything else.
- MF Central CAS (`MfCentralGateway`): token → encrypt → sign → `newCasRequest` / `validateQRCode` → decrypt, exactly as the UAT collection. `MFCENTRAL_CRYPTO_MODE=remote` uses MF Central's `/api/test/*` helpers; `local` signs with the private JWK (detached RS256, `b64:false`) and uses an AES placeholder marked unverified. Wired into screens 06A–06B (below); the hand-off URL and `validateQRCode` statement are verified against UAT.
- Ignosis bank analytics: `parseIgnosisAnalytics` types the documented JSON tags (overall, account-wise, salary/EMI, loans, ABB, score, MF/equity/FD summaries, nudges). No API contract was supplied, so there is no gateway.

## MF Central portfolio import (screens 06A–06B)

After screen 06 (`POST …/identity-verifications` answers `next_screen: PORTFOLIO_IMPORT`) the customer is offered a consent-driven pull of their mutual-fund holdings from MF Central (CAS) while the KRA lookup runs in the worker. The step is optional: skipping completes it and the journey follows the KYC outcome (`KYC_PROGRESS` / `CONFIRM_KYC` / `FRESH_KYC`). The flow below is the real one, verified end to end on MF Central UAT on 2026-10-19 (MFC-CAS Integration Document).

Front-end sequence (all under `/v1/onboarding/applications/{id}`, session token):

1. `POST portfolio-imports {consent: true}` → 201 `{import_id, status: AWAITING_AUTHORISATION, authorisation_url, expires_at, next_screen}`. Send the browser to `authorisation_url`: MF Central's `https://mfc-cas-uat.mfcentral.com/api/auth/start?data=…`, where `data` is `{reqId, otpRef, token:'', clientRefNo, pan, pekrn, email, mobile, redirectUrl}` encrypted with AES-256-CBC (32-byte `MFCENTRAL_URL_ENCRYPTION_KEY`, random IV, `<iv_hex>:<cipher_hex>`). Calling again while the import is open returns the same import; `expires_at` is `PORTFOLIO_IMPORT_TTL_MINUTES` after start.
2. On MF Central's page the investor enters the OTP (UAT: `00` + last four PAN digits), chooses Summary/Detailed and downloads a QR image. MF Central then sends the browser to our callback `GET|POST /v1/integrations/mfcentral/callback?status=success&reqId=…&type=…` (`MFCENTRAL_REDIRECT_URL`, no session; must be whitelisted by MF Central) which marks the import `AWAITING_QR` and 302s to `MFCENTRAL_RETURN_URL?import_id=…&status=awaiting_qr`. `status=error&code=…&message=…` marks it `DECLINED` (`status=declined`); an unknown `reqId` answers `status=unknown`. Point `MFCENTRAL_RETURN_URL` at the FE route for this screen. In an iframe/popup MF Central posts `{type:'mfc-cas-complete', data}` instead.
3. The investor uploads the downloaded QR: `POST portfolio-imports/{import_id}/qr-validations {qr_code: <base64 PNG, data: URI allowed>}` (Idempotency-Key). The backend calls MF Central `validateQRCode {reqId, clientRefNo, qrCode}` and answers 200 `{import_id, status: IMPORTED, next_screen: ASSETS_DASHBOARD}`. MF Central rejecting the image → 422 with its message (`"Failed to Validate QR code"`), the import stays open and `last_error` carries the message; an unreadable statement → `FAILED / invalid_payload`. The upload is accepted while `AWAITING_AUTHORISATION` or `AWAITING_QR` (the return leg may be lost) and is idempotent once `IMPORTED`.
4. `GET portfolio-imports/{import_id}` → `status` `AWAITING_AUTHORISATION | AWAITING_QR | IMPORTED | DECLINED | FAILED (failure_category) | EXPIRED | SKIPPED`, `last_error`, `authorisation_url` while open, `expires_at`, `next_screen`.
5. `GET portfolio` → `status AVAILABLE | NOT_AVAILABLE | SKIPPED`; when available: `as_of`, `investor {name, pan_masked}`, `totals`, `by_asset_class`, `by_amc`, `holdings` (`folio_masked`, `scheme_name`, `scheme_type`, `plan`, `units`, `nav`, `nav_date`, `market_value_inr`, `cost_value_inr`, `gain_inr`, `gain_pct`, `rta`, `demat`), `partial` + `notice` when MF Central could not fetch every RTA, and `next_screen` for the Continue button.
6. `POST portfolio-imports/skip` → `{status: SKIPPED, next_screen}` at any point before an import succeeds.

The statement (`{reqId, pan, data:[{summary[], schemes[]}], errorMessage, portfolio[], investorDetails}`; CAMS rows as strings, KFIN rows as numbers, `assetType` EQUITY/DEBT/CASH or blank) is parsed by `domain/portfolio/cas-parser.ts` (pinned to the real UAT response in `test/fixtures/mfcentral/cas-summary.sample.json`; closed folios are dropped, unknown asset types are classified from the scheme name), kept as restricted evidence under `portfolio/{applicationId}/{importId}/cas.json`, stored encrypted in `onboarding.portfolio_snapshots`, and step `PORTFOLIO_IMPORT` completes. PAN, folio, account and bank numbers never reach analytics or logs; the dashboard masks PAN and folios.

MF Central UAT rules (verified): the `signature` sent is the bare detached JWS (the `/api/test/generateSignature` helper wraps it as `{"x-jws-signature": "…"}` and the gateway unwraps it); exactly one of `mobile` / `email` is sent (the gateway sends the mobile); `clientRefNo` is unique per request (the import id). Every other mistake, including a bad signature or ciphertext, is the generic 422 "Invalid Input"; a PAN with a mobile other than its registered one answers "Invalid PAN/PEKRN, Mobile/Email combination" (the MF Central UAT test PANs are bound to mobile 9239874560, so UAT runs set `MFCENTRAL_TEST_MOBILE_OVERRIDE=+919239874560`, which production boot refuses). Configuration: `MFCENTRAL_BASE_URL=https://uatservices.mfcentral.com`, `MFCENTRAL_APP_URL=https://mfc-cas-uat.mfcentral.com`, the tenant client id/secret, username/password, encryption key, private JWK and the URL encryption key, all from `.env` only.

Local stack without vendor secrets: the UAT API is stubbed in WireMock (`tools/wiremock/mappings/mfcentral.json`, `MFCENTRAL_BASE_URL=http://localhost:8080/mfcentral`): token, helper, `newCasRequest` (answers `reqId = clientRefNo`, PAN digits `9999` → 422 like an unwhitelisted PAN) and `validateQRCode` (the real UAT statement; a `qr_code` starting with the base64 of `BADQR` → "Failed to Validate QR code"). There is no hand-off page locally: call the callback yourself with `?status=success&reqId=<import_id>` (Postman "Simulate MF Central return"), then upload any base64 ≥ 100 chars as the QR. SIT runs this path.

## Local manual testing (Postman)

1. Infra: `docker compose up -d` (postgres 5432, redis 6380, minio 9000/9001, wiremock 8080, mailpit 8025).
2. Processes: `npm run build`, then `npm run start:api`, `npm run start:worker`, `npm run mock:trackwizz` (TrackWizz stand-in on 8099). `.env` points Digio and MF Central at WireMock (`http://localhost:8080/digio`, `http://localhost:8080/mfcentral`) and TrackWizz at the mock; switch the `DIGIO_*` / `TRACKWIZZ_*` values back to the sandbox once real credentials arrive.
3. Import `postman/wmc_pms.postman_collection.json`. `internal_token` defaults to `dev-internal-token`, the value in `.env.docker` used by the compose stack; when running the API from source with `npm run start:api`, set it to `INTERNAL_SERVICE_TOKEN` from `.env` instead. Folders follow the screens (01–25, with 06A–06B for the MF Central import), then internal feeds, reviewer and simulated webhooks; test scripts capture ids and tokens into collection variables as you go.
4. OTPs are never logged. Use `GET /internal/v1/dev/otps?to=<phone or email>` (service token, non-production only; wired in the collection as "Dev: read last … OTP"), or Mailpit for email.
5. Mock data: PAN `ABJP?####J` → existing KRA record (REUSE route), `NORP?####X` → no record (FRESH route), use a fresh PAN per application; bank account `9999…` → VERIFIED, `5555…` → REVIEW_REQUIRED, `1111…` → ACTION_REQUIRED; the eSign stub reports completion on the first poll, so signing executes within ~30 s; accounts and receipts come from the internal feeds folder.

## Docker (everything in containers)

`docker compose up -d` builds the image and starts the whole stack on mocked partners: postgres, redis, minio, wiremock, mailpit, a one-shot `migrate` job (`prisma migrate deploy`), `api` (3000), `worker` and `trackwizz-mock` (8099); MF Central is stubbed in WireMock. Configuration comes from `.env.docker` (no real credentials); to use MF Central UAT instead, set the `MFCENTRAL_*` values described above. One image, four entry points via `docker/entrypoint.sh`: `api`, `worker`, `mock`, `migrate`.

To hand the stack to someone without the repo: `docker build -t wmc-pms:0.1.0 . && docker save wmc-pms:0.1.0 | gzip > wmc-pms-0.1.0.tar.gz`, and ship it with `docker-compose.yml` (build lines removed), `.env.docker`, `tools/wiremock/mappings`, `tools/postgres/init` and the Postman collection. They run `docker load -i wmc-pms-0.1.0.tar.gz && docker compose up -d`.
