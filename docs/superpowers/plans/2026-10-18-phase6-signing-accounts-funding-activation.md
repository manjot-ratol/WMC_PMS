# Phase 6: Signing, Processing, Account Opening, Funding and Activation (Screens 21–25, Jobs C/D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the document pack against the review snapshot through Digio eSign, run registry filing and account opening as a worker job fed by an internal custodian feed, release approved funding instructions only after execution and account readiness, reconcile provider receipts against the verified bank account, and activate the PMS account exactly once when every gate passes.

**Architecture:** Same layering. The document pack is rendered server-side (pdf-lib) from the review snapshot and versioned templates, hashed per document, merged into one pack PDF and sent to Digio eSign as one sign request. Completion is decided only by the worker from Digio's document status (webhooks trigger an immediate poll; the payload is never trusted). Registry filing, account opening, reconciliation and activation are worker jobs fed by the outbox and by `/internal/v1` feeds; activation is one version-checked transaction with a unique `activations` row.

**Tech Stack:** as before, plus `pdf-lib` (CJS) for rendering.

**Spec:** design doc §4.6–4.8, §6, §10, §12 (funding receipts), §13 (document pack); product spec screens 21–25 and Jobs C/D; Digio eSign OpenAPI extracts under `docs/partners/digio/esign/`, KRA register/webhook and CKYC register from the spec appendix.

## Global Constraints

- Endpoints exactly as the spec: `POST …/signing-sessions` (201 `{signing_session_id,status:'REQUESTED',provider_request_id,sdk_launch:{access_token}}`), `GET …/signing-sessions/{id}` (200 `{status,document_pack_version,evidence_available,next_screen}`), `GET …/status` (200 `{application_status,tasks:[{task_id,category,status}],customer_action_required,next_screen}`), `POST …/tasks/{task_id}/responses` (200 `{status:'SUBMITTED',task_status:'UNDER_REVIEW'}`), `GET …/funding-instructions` (200 `{status:'READY',instructions_version,beneficiary_details,payment_reference,required_amount_inr}`), `POST …/funding-notifications` (202 `{status:'AWAITING_RECONCILIATION',notification_id,next_screen:'FUNDING_STATUS'}`), `GET …/funding-status` (200 `{funding_status,activation_status,customer_action_required,next_screen}`), `GET …/completion` (200 `{application_status:'ACTIVE',pms_account_id,onboarding_complete,first_investment_status,next_screen:'PORTFOLIO'}`). Internal (service token): `POST /internal/v1/applications/{id}/account-opening-runs` (202 `{run_id,status:'QUEUED'}`), `POST …/underlying-accounts` (202 `{account_id,status}`), `POST …/funding-receipts` (202 `{receipt_id,status:'RECORDED'|'DUPLICATE',match_status}`).
- Screens added: `APPLICATION_PROCESSING, FUNDING_INSTRUCTIONS, FUNDING_STATUS, ACTIVATION_PROGRESS, PORTFOLIO`. Steps added: `SIGNING, ACCOUNT_OPENING, FUNDING, ACTIVATION`. Application statuses added: `SUBMITTED` (pack executed) and `ACTIVE`.
- Signing: requires step REVIEW, a CURRENT snapshot whose `applicationVersion` equals the application version and `document_pack_version` current (else 409). One sign request per snapshot: an existing REQUESTED/IN_PROGRESS session for the same snapshot is returned, never duplicated. Digio `POST /v2/client/document/uploadpdf` with `signers[0].sign_type` from config (`aadhaar`), `generate_access_token:true`, `reference_id` = application id, `custom_reference` = session id. Status from `GET /v2/client/document/{docId}`: EXECUTED only when `agreement_status==='completed'` and every signing party is `signed`; `expired`/`failed`/`cancelled` are terminal; `requested`/`draft` is never completion. The signed document is downloaded (`GET /v2/client/document/download?document_id=`) and stored as evidence before the session is EXECUTED. A superseded snapshot's session cannot execute (callback for an old session is ignored with audit).
- Execution completes step SIGNING, sets application status SUBMITTED, next screen APPLICATION_PROCESSING, and emits `DocumentPackExecuted` which queues the account-opening run.
- Account-opening job: pre-checks (snapshot current, session EXECUTED), KRA registry submission (NOT_REQUIRED with basis `EXISTING_KRA_RECORD` for route REUSE; `kra.register` for FRESH with deadline = now + `kraFilingDays`), CKYC (`DEFERRED` unless `ckycEnabled`), an `ACCOUNT_SETUP` task IN_PROGRESS, run status SUBMITTED. Underlying accounts arrive through the internal feed keyed by `provider_receipt_key` (duplicates acknowledged, never double-recorded); when every `requiredAccountTypes` is READY the run becomes ACCOUNTS_READY, the task resolves, step ACCOUNT_OPENING completes, next screen FUNDING_INSTRUCTIONS, analytics `Underlying Account Ready`.
- KRA webhook `KRA.PAN.STATUS.UPDATE` updates the matching registry submission by `request_id`/`client_reference_id`; status regression is rejected; KRA_VERIFIED and KRA_VALIDATED are distinct.
- Funding instructions are released only when signing is EXECUTED and accounts are READY (otherwise 422). Beneficiary details come from configuration, never from the customer. `payment_reference` is deterministic per application. `required_amount_inr` = intended investment from eligibility. A funding notification is a hint (AWAITING_RECONCILIATION), never proof.
- Receipts: unique `provider_receipt_key`; MATCHED only when currency INR, destination reference equals the payment reference and the source account fingerprint equals the verified bank account's; otherwise UNMATCHED with reasons and a `FUNDING_REVIEW` task. Qualifying funds = sum of MATCHED receipts; `RECONCILED` when ≥ required, `PARTIAL` when > 0. Reaching RECONCILED emits `FundingRequirementMet` (analytics `Funding Requirement Met`) which queues activation.
- Activation job (rulebook `activation.v1.json`): required steps, signing EXECUTED, accounts READY, funding RECONCILED, latest screening run PROCEED and latest AML assessment PROCEED when present or required, no open tasks in blocking categories, no REJECTED registry submission. All pass → one transaction with version check: `activations` row (unique application id, `pms_account_id` from the PMS underlying account), application ACTIVE, step ACTIVATION, next screen PORTFOLIO, analytics `PMS Account Activated` and `Onboarding Completed`. `READY_FOR_ACTIVATION` is reported, never set by the client. Duplicate triggers are no-ops.
- `GET …/status` shows only customer-visible task categories (`SOURCE_OF_FUNDS_EVIDENCE, FATCA_ADDITIONAL_INFO, BANK_PROOF, CLARIFICATION, ACCOUNT_SETUP`); restricted compliance work is never disclosed. Task responses must target an OPEN visible task owned by the application with documents owned by the application.
- Analytics: `Signing Request Created`, `Document Execution Updated`, `Document Pack Executed`, `Application Submitted`, `Application Action Required`, `Underlying Account Ready`, `Funding Requirement Met`, `PMS Account Activated`, `Onboarding Completed`. Screens 21–25. No references, amounts, account details or hashes in analytics.
- Branch `feat/phase6-signing-accounts-funding-activation`; commit per task.

## Review Focus

1. Digio returns `agreement_status:'requested'` with the signer `signed`: the session stays IN_PROGRESS; only `completed` + all signers `signed` executes (Task 4 test).
2. A webhook for a session whose snapshot was superseded: ignored with audit, application unchanged (Task 4 test).
3. The same `provider_receipt_key` posted twice: one receipt, funds counted once, second call answers DUPLICATE (Task 6 test).
4. A matched receipt from a source account that is not the verified one: UNMATCHED, not counted, `FUNDING_REVIEW` task (Task 6 test).
5. Funds reconciled but the latest screening run is REVIEW: activation reports BLOCKED and the application stays SUBMITTED; a later PROCEED activates exactly once even when the job runs twice (Task 6 test).

---

### Task 1: Domain, rulebooks, document templates, screens/steps/statuses
### Task 2: Persistence (signing_sessions, registry_submissions, account_opening_runs, underlying_accounts, funding_notifications, funding_receipts, activations, task_responses), ports, repositories, task repository extensions, DB spec
### Task 3: Digio eSign gateway, CKYC gateway, PDF renderer, WireMock stubs, config
### Task 4: Signing service, status processor, webhook dispatch (DigiSign + KRA register), controller
### Task 5: Processing status, task responses, account-opening service/processor, internal feeds
### Task 6: Funding, reconciliation, activation processor, completion, controller
### Task 7: Wiring, fakes, unit specs, Swagger, Postman, SIT journey 21–25, README, coverage gate

## Completion notes (2026-10-18)

All seven tasks are built and verified: 440 unit tests, 37 SIT tests (screens 01–25 end to end: Digio eSign through
WireMock, custodian and bank feeds through `/internal/v1`, activation by the worker), coverage 98% lines / 85%
branches, lint and build clean. Notes and deviations:

- One Digio sign request per snapshot: the execution-required documents are rendered individually (hash per
  document kept in `signing_sessions.documents`) and merged into one pack PDF so the customer launches the SDK once.
- The account-opening run is created by the worker from `DocumentPackExecuted`; the internal
  `account-opening-runs` endpoint is the ops re-queue. Readiness only ever comes from the custodian feed.
- Phase 7 (TrackWizz) is not built, so the SIT journey sets the screening and AML rows to PROCEED directly before
  funding; the activation gates themselves are exercised in unit tests (REVIEW blocks, PROCEED activates once).
- KRA registration payload mapping is a placeholder flagged `PLACEHOLDER_PENDING_COMPLIANCE`; CKYC is built as a
  multipart gateway but disabled by the account-opening rulebook until Compliance confirms applicability.
- `insertIfNew` repositories use `createMany({ skipDuplicates })` so a replayed receipt inside a transaction does not
  abort it (a caught unique-violation would have).
- Found while testing: application ids contain `_`, so the payment reference strips non-alphanumerics and pads.
