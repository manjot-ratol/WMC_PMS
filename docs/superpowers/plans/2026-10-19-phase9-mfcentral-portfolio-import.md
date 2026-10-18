# Phase 9: MF Central Portfolio Import and Assets Dashboard (Screens 06A–06B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the customer submits PAN identity (screen 06), send them through the MF Central CAS consent flow, import their mutual-fund holdings and show an assets dashboard before KYC continues; ship an MF Central stand-in so the whole flow runs on Docker without vendor credentials.

**Architecture:** Same layering. `PortfolioImportService` starts a CAS request through the existing `MfCentralGateway` (synchronous, like signing), stores a `portfolio_imports` row and returns the investor hand-off URL. MF Central brings the browser back to a public backend callback (`/v1/integrations/mfcentral/callback`), which lands the payload in `integration_inbox`, queues `portfolio-import/complete` and redirects the browser to the front end. The worker decrypts the payload with the gateway's crypto, parses it with a pure domain parser, stores an encrypted `portfolio_snapshots` row and completes step `PORTFOLIO_IMPORT`. The MF Central mock (`MfCentralMock`) is an in-process HTTP stand-in like the TrackWizz one: token, `/api/test/*` helpers, `newCasRequest`, `validateQRCode`, an investor consent page and a programmatic authorise endpoint.

**Tech Stack:** as before; Node `http` for the mock.

**Spec:** owner request 2026-10-19 ("after PAN verification, user should be sent into the MF Central flow and shown an assets dashboard; stitch into the flow; APIs for the FE"); `Partners Documentation/MF Central/Mf_central_postman_colections.json`; Phase 8 connector notes.

## Global Constraints

- Flow change: `POST …/identity-verifications` now answers `next_screen: 'PORTFOLIO_IMPORT'` (the KRA lookup still runs in the worker). The KYC lookup job does not overwrite `PORTFOLIO_IMPORT`/`ASSETS_DASHBOARD` as the application's next screen while step `PORTFOLIO_IMPORT` is incomplete. Import completion or skip sets the next screen from the latest KYC record (`kycNextScreen`) or `KYC_PROGRESS` when the lookup has not finished.
- Screens added: `PORTFOLIO_IMPORT` (06A), `ASSETS_DASHBOARD` (06B). Step added: `PORTFOLIO_IMPORT` (optional: no later step requires it).
- Customer endpoints (session, idempotent POSTs): `POST …/portfolio-imports {consent:true}` → 201 `{import_id,status:'AWAITING_AUTHORISATION',authorisation_url,expires_at,next_screen:'PORTFOLIO_IMPORT'}` (an open, unexpired import is returned again; requires step IDENTITY; a vendor rejection is stored as `FAILED` and returned with `failure_category`), `GET …/portfolio-imports/{import_id}` → 200 `{import_id,status,failure_category?,authorisation_url?,expires_at?,next_screen}`, `POST …/portfolio-imports/skip` → 200 `{status:'SKIPPED',next_screen}`, `GET …/portfolio` → 200 `{status:'AVAILABLE'|'NOT_AVAILABLE'|'SKIPPED',import_id?,as_of?,source,investor?,totals?,by_asset_class?,holdings?,next_screen}`. Statuses: `AWAITING_AUTHORISATION|IMPORTED|FAILED|DECLINED|EXPIRED|SKIPPED`; `next_screen` is `ASSETS_DASHBOARD` once IMPORTED, else `PORTFOLIO_IMPORT` until the step is complete.
- Callback (no session): `GET|POST /v1/integrations/mfcentral/callback` accepts `reqId`, `clientRefNo`, `status`, and the encrypted CAS payload under `response|data|casData`; it is stored in the inbox keyed by `clientRefNo`, queued, and the browser is redirected (302) to `MFCENTRAL_RETURN_URL?import_id=…&status=received`. Unknown `clientRefNo` → redirect with `status=unknown`. Repeated callbacks are idempotent.
- CAS request: PAN from the latest identity version, mobile from the customer (`+91…`), email from the verified customer email, `redirectUrl` = `MFCENTRAL_REDIRECT_URL`, `clientRefNo` = import id. The decrypted vendor payload is kept as restricted evidence (`portfolio/{applicationId}/{importId}/cas.json`), holdings are stored encrypted, and PAN/folio numbers are masked in every API response. Nothing financial reaches analytics (`Portfolio Import Started|Completed|Skipped`, outcome only).
- Mock (`MfCentralMock`, port 4011): `POST /oauth/token`; `/api/test/encrypt` = base64url(plaintext), `/api/test/decrypt` = reverse, `/api/test/generateSignature` = `mock.<sha256>`; `newCasRequest` validates the PAN (digits `9999` → 422 `Invalid Input` like UAT; digits `0000` → empty CAS), stores the request, answers `{response: enc({reqId, clientRefNo, status:'Success'})}`; `GET /investor?reqId&clientRefNo` renders a consent page whose Approve/Decline buttons POST to `/investor/decide` which replies with an auto-submitting form to the client's `redirectUrl`; `POST /mock/requests/{reqId}/authorise {outcome}` returns the same fields for scripts (newman, SIT). The mock has no real crypto; the real envelope stays in `remote` mode against MF Central.
- Config: `MFCENTRAL_REDIRECT_URL` (browser-facing callback), `MFCENTRAL_RETURN_URL` (FE page), `PORTFOLIO_IMPORT_TTL_MINUTES` (15). Docker: service `mfcentral-mock` (`entrypoint mock-mfcentral`), `MFCENTRAL_BASE_URL=http://mfcentral-mock:4011`, `MFCENTRAL_APP_URL=http://localhost:4011/investor`.
- Branch `feat/phase9-mfcentral-portfolio-import`; commit per task.

## Review Focus

1. A callback whose `status` is not success: import `DECLINED`, nothing decrypted, step completes with next screen from KYC (Task 4 test).
2. The same callback delivered twice: one snapshot, one analytics event (Task 4 test).
3. A callback for a `clientRefNo` that is not ours: no inbox row, redirect with `status=unknown` (Task 5 test).
4. CAS payload that fails to decrypt/parse: `FAILED` with `invalid_payload`, raw cipher kept nowhere but the inbox (Task 4 test).
5. Starting a second import while one is `AWAITING_AUTHORISATION`: the same import is returned, one MF Central call (Task 3 test).

---

### Task 1: Domain (screens/step, portfolio import model, CAS parser), specs
### Task 2: Persistence (`portfolio_imports`, `portfolio_snapshots`), port, repository, DB spec
### Task 3: Gateway additions (decrypt, redirect URL), MF Central mock server + entrypoint, service (start/get/skip/portfolio), identity next-screen change
### Task 4: Callback ingress, processor, outbox route, KYC lookup next-screen guard
### Task 5: Controllers, DTOs, Swagger, wiring, fakes, unit specs, SIT, Postman, README, Docker, coverage gate
