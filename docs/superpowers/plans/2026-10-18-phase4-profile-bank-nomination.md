# Phase 4: Profile, Declarations, Bank Verification and Nomination (Screens 12–16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After KYC, capture the personal/financial profile, tax residencies and PEP declaration (queuing the compliance work Phase 7 will execute), verify the bank account through Digio with name matching and remediation, and record the nomination instruction, taking the application to the investment-profile screen.

**Architecture:** Same layering. Profile, declarations and nomination are versioned rows with restricted/encrypted fields; the bank check is a worker job fed by the outbox and consumed from `bank-verification`; compliance work is recorded as `QUEUED` rows in a restricted `compliance` schema so Phase 7 can pick them up without relying on outbox routes that do not exist yet. All vocabularies and thresholds are versioned rulebooks with placeholder content.

**Tech Stack:** as before.

**Spec:** design doc; product spec screens 12–16; Digio bank verification OpenAPI extract (`docs/partners/digio/bank/verify_bank_account.min.json`).

## Global Constraints

- Endpoints exactly as the spec: `PUT …/profile` (200 `{status:'COMPLETE',profile_version,next_screen:'TAX_DECLARATIONS'}`), `PUT …/declarations` (200 `{status:'COMPLETE',additional_information_required,next_screen:'BANK_DETAILS'}`), `POST …/bank-verifications` (202 `{verification_id,status:'PROCESSING',next_screen:'BANK_PROGRESS'}`), `GET …/bank-verifications/{verification_id}` (200 `{status,account_masked,required_actions,next_screen}`), `PUT …/nomination` (200 `{status:'CAPTURED',registration_status:'NOT_SUBMITTED',nomination_version,next_screen:'INVESTMENT_PROFILE'}`).
- Screens added: `TAX_DECLARATIONS, BANK_DETAILS, BANK_PROGRESS, NOMINATION, INVESTMENT_PROFILE`; steps added: `PROFILE, DECLARATIONS, BANK, NOMINATION`.
- Bank statuses: `PROCESSING, VERIFIED, ACTION_REQUIRED, REVIEW_REQUIRED, TECHNICAL_ERROR`. Digio `POST /v4/client/verify/bank_account` with `validation_mode:'AUTO'`, `beneficiary_name` = the verified legal name from the identity version (never the customer-typed holder name); result rules from `bank.v1.json`: `verified && fuzzy_match_score >= 70` → VERIFIED; `verified && 40 <= score < 70` → REVIEW_REQUIRED (task `BANK_NAME_REVIEW`); `verified && score < 40` → ACTION_REQUIRED (`required_actions:['CORRECT_DETAILS','UPLOAD_BANK_PROOF']`); `verified === false` → ACTION_REQUIRED with safe category; provider 5xx/transport → TECHNICAL_ERROR after retries. Raw provider responses go to object storage; match scores never leave the backend.
- Repeated submissions of the same account while a verification is PROCESSING return the existing verification id (no second chargeable call); a changed account invalidates prior verifications.
- Account numbers and TINs are encrypted at rest with HMAC fingerprints; nominee details are encrypted as one JSON blob; none of them appear in analytics, logs or audit details.
- Declarations: at least one tax residency; `IN` mandatory for resident customers and its TIN must equal the verified PAN; other countries need an ISO-3166 alpha-2 code and a TIN or an allowed reason; any non-IN residency sets `additional_information_required:true` and opens a `FATCA_ADDITIONAL_INFO` task without blocking; `pep_declaration` ∈ `NOT_PEP, PEP, RELATED_TO_PEP`; PEP/RELATED opens a `PEP_EDD` task. Saving declarations creates `compliance.screening_runs` and `compliance.aml_assessments` rows with status `QUEUED` (consumed in Phase 7).
- Nomination: `choice` ∈ `NOMINATE, OPT_OUT` (explicit, never defaulted); up to 3 nominees; `allocation_mode` `EQUAL` or `CUSTOM` (custom percentages must be positive integers summing to 100); minors require `date_of_birth` and a guardian; relationship vocabulary from `nomination.v1.json`.
- Analytics events: `Customer Profile Completed`, `Declarations Completed`, `Bank Verification Completed`, `Bank Evidence Accepted` (Phase 8 reviewer), `Nomination Instruction Saved`.
- Branch `feat/phase4-profile-bank-nomination`; commit per task.

## Review Focus

1. Profile saved with a stale `profile_version`: 409, nothing written (Task 4 test).
2. Declarations with `country:'IN'` and a TIN that differs from the verified PAN: 422, no compliance rows created (Task 4 test).
3. Two quick taps on bank verification for the same account: one Digio call, same `verification_id` (Task 5 test with WireMock journal).
4. Digio returns `verified:true` with a 55 name-match score: status REVIEW_REQUIRED, a task exists, the score is absent from the API response and analytics (Task 5 test).
5. Custom allocation summing to 99 or a minor without a guardian: 422 and no nomination version written (Task 6 test).

---

### Task 1: Domain, rulebooks (`profile.v1`, `tax.v1`, `bank.v1`, `nomination.v1`), screens/steps
### Task 2: Persistence (customer_profiles, declarations, bank_accounts, bank_verifications, nominations, compliance.screening_runs, compliance.aml_assessments), ports, repositories, DB specs
### Task 3: Digio bank verification gateway + mapper + nock tests; WireMock stubs
### Task 4: Profile and declarations services and controllers
### Task 5: Bank verification service, processor, read endpoint, controller
### Task 6: Nomination service and controller
### Task 7: Module wiring, Swagger, Postman, SIT journey 12–16, docs, coverage gate

## Completion notes (2026-10-18)

All seven tasks are built and verified: 372 unit tests, 28 SIT tests (screens 01–16 end to end with the in-process
worker and WireMock partners), coverage 98% lines / 85% branches, lint and build clean. Notes and deviations:

- Profile re-saves after declarations supersede the open AML assessment and queue a new `QUEUED` row with the new
  profile version; the screening run is left alone because its inputs (identity) did not change.
- A profile with a policy-flagged source of funds opens a `SOURCE_OF_FUNDS_EVIDENCE` task instead of blocking.
- Bank verification attempts are capped by `bank.v1.json` (`maxAttempts`); the cap surfaces as 422 with
  `next_screen: ASSISTED_ONBOARDING` in the error details.
- Found while running SIT: jest never exited after the suite because the BullMQ ioredis clients were never quit
  (pre-existing since Phase 1). `QueueRegistry` now owns the shared client's shutdown and BullMQ workers get
  connection options instead of an instance, so BullMQ closes what it opens.
- The Postman collection was still at screens 01–05; it now covers 01–16.
