# Phase 8: CleverTap Dispatcher, Reviewer API, MF Central and Ignosis Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the analytics outbox to CleverTap with the allowlist enforced at the boundary, give the back office the minimal reviewer surface the owner approved (cases, tasks, decisions, bank evidence, clarification resolution), and deliver the MF Central and Ignosis connectors as tested gateways/parsers with no business wiring (owner decision §13).

**Architecture:** Same layering. The dispatcher is a worker tick (like the outbox tick) over `analytics_outbox` with a `CleverTapGateway` behind `ANALYTICS_SINK`; locally the sink logs. The reviewer API lives under `/internal/v1/review`, guarded by the service token plus a mandatory `X-Reviewer-Id` that is written to `review_decisions` and `audit_events`. MF Central is a gateway with a `MfCentralCryptoPort` (documented UAT helper endpoints by default; a local JWS/AES implementation flagged unverified). Ignosis is a parser over the documented JSON tags.

**Tech Stack:** as before; Node `crypto` only.

**Spec:** design doc §4.9, §6, §13; product spec CleverTap contract (`d/identity/type/evtName/ts/evtData`); `Partners Documentation/MF Central/Mf_central_postman_colections.json`; `Partners Documentation/Ignosis/Analytics Json Docs`.

## Global Constraints

- CleverTap: `POST {CLEVERTAP_BASE_URL}/1/upload` with `X-CleverTap-Account-Id`, `X-CleverTap-Passcode`, body `{d:[{identity,type:'event',evtName,ts,evtData}]}` in batches of ≤ 100; `ts` = UNIX seconds of `created_at`; `evtData` = the stored allowlisted properties only. Rows without identity are uploaded with `objectId` = application id (anonymous). Response `unprocessed[]` entries are marked failed with the vendor message; transport failures retry up to `ANALYTICS_MAX_ATTEMPTS` (10) then dead-letter. `CLEVERTAP_ENABLED=false` → log sink (event name + count only) and rows are marked dispatched. A unit test asserts every stored property key is in the allowlist (`event_id, application_id, screen_id, step_id, journey_version, event_schema_version, event_source, attempt_number, outcome, safe_error_category`).
- Reviewer API (`/internal/v1/review`, `X-Internal-Token` + mandatory `X-Reviewer-Id`, 401 without either): `GET cases?status=` (OPEN default, limit ≤ 100), `GET tasks?status=` (OPEN|UNDER_REVIEW), `POST cases/{case_id}/decisions {decision: PROCEED|HOLD|REJECT, reason (≥ 10 chars)}`, `POST applications/{id}/bank-evidence {verification_id, reason}`, `POST tasks/{task_id}/resolution {resolution: RESOLVED|REOPENED, reason}`. Decisions: PROCEED closes the case and sets the source run/assessment to PROCEED with the decision recorded (documented override); HOLD → case UNDER_REVIEW; REJECT closes the case, sets the run to STOP, application status REJECTED (customer sees a neutral CLOSED status, next screen ASSISTED_ONBOARDING). Every reviewer action appends an audit event with `actorType: REVIEWER, actorId: <reviewer id>`, emits `ComplianceOutcomeRecorded` (activation re-evaluation) and a generic `Application Processing Updated` analytics outcome. Bank evidence acceptance moves a REVIEW_REQUIRED/ACTION_REQUIRED verification to VERIFIED, resolves `BANK_NAME_REVIEW` tasks, completes step BANK and emits `Bank Evidence Accepted`. Case ids, reasons, risk values and hit details never reach analytics.
- MF Central (collection "REVISED MFC CAS COLLECTION"): `POST /oauth/token` form `grant_type=password&username&password` (+ Basic client id/secret); `POST /api/client/V1/newCasRequest` and `POST /api/client/V1/validateQRCode` with headers `ClientId`, `Authorization: Bearer`, `Origin` and body `{signature, request}` where `request` is the encrypted payload and `signature` a detached RS256 JWS (`b64:false`) over it with the private JWK `kid`. Crypto through `MfCentralCryptoPort`: `remote` mode calls the documented `/api/test/encrypt`, `/api/test/generateSignature`, `/api/test/decrypt` helpers (header `key`); `local` mode signs with the JWK and uses AES-256-GCM over SHA-256(key), explicitly `UNVERIFIED_PENDING_MFCENTRAL_CONFIRMATION`. Secrets only from env (the UAT JSON in the parent folder is never copied). No business wiring.
- Ignosis: `parseIgnosisAnalytics(json)` into a typed model covering `overallAnalysis` (totals + monthly/weekly/daily), `accountWiseAnalysis[]`, `frequentCredits.salaryAnalysis/otherIncomeAnalysis`, `frequentDebits.emiAnalysis/nonEmiObligationAnalysis`, `loanCreditSummary`, `abbTables`, `score`, `mutualFundAnalysis.overallAnalysis`, `equityAnalysis.overallAnalysis`, `fixedDepositAnalysis.overallAnalysis`, `nudgeInfo`, `allTransactions` count; unknown sections are preserved under `raw`. Missing sections are `undefined`, never defaulted to zero. No API contract exists, so no gateway.
- Branch `feat/phase8-connectors-analytics-reviewer`; commit per task.

## Review Focus

1. An analytics row whose properties somehow contain a denylisted key (e.g. `pan`): the dispatcher strips it and logs a privacy incident rather than uploading it (Task 1 test).
2. CleverTap answers `unprocessed` for one of three events: only that row is marked failed; the other two are dispatched (Task 1 test).
3. A decision posted without `X-Reviewer-Id`: 401 and nothing written (Task 2 test).
4. PROCEED decision on a STOP screening run: the run becomes PROCEED, the case closes with the reason, activation is re-evaluated; analytics carry no reason (Task 2 test).
5. MF Central `local` crypto: the detached JWS header is `{alg:RS256,kid,b64:false,crit:[b64]}` and the signature verifies with the public JWK; it is still labelled unverified (Task 3 test).

---

### Task 1: Analytics outbox port, CleverTap gateway, log sink, dispatcher processor + scheduler, allowlist test
### Task 2: Reviewer service + controller + guard, port extensions (tasks by status, cases listing), application REJECTED, processing mapping, specs
### Task 3: MF Central gateway + crypto port (remote/local), WireMock stubs, nock specs
### Task 4: Ignosis parser + typed model + fixture spec
### Task 5: Wiring, Swagger, Postman, SIT (reviewer flow, analytics dispatched), README, coverage gate

## Completion notes (2026-10-18)

All five tasks are built and verified. Notes and deviations:

- The back-office service is `BackOfficeReviewService` (the Phase 5 `ReviewService` is the customer's screen-20
  review); the controller lives at `/internal/v1/review` behind `ReviewerGuard` (service token + `X-Reviewer-Id`).
- A REJECT decision closes the application (`REJECTED`); the customer-facing status shows `CLOSED` with
  `ASSISTED_ONBOARDING` as the next screen and never the reason. An ACTIVE application is not flipped.
- The analytics dispatcher runs as a worker tick every 5 s; rows the sink rejects are dead-lettered with the vendor
  message, transport failures retry up to 10 attempts. SIT runs with the log sink and asserts every row is dispatched.
- MF Central's symmetric cipher is not documented in the collection; `remote` mode (MF Central's own helpers) is the
  default and `local` mode is explicitly `UNVERIFIED_PENDING_MFCENTRAL_CONFIRMATION`. The live UAT credentials stay in
  `.env` only.
- Ignosis is a parser with a fixture; the "Json Tag" paths without a defined item schema are kept under `extra`/`raw`.
