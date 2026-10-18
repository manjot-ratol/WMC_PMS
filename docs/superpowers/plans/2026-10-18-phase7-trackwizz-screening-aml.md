# Phase 7: TrackWizz Screening and AML Risk Rating (Jobs A/B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume the QUEUED screening and AML rows written since Phase 4: build AS501 requests from the verified identity, profile and declarations, send them through the TrackWizz encrypted envelope, validate and interpret the signed responses conservatively (Proceed only when every check passes), open restricted compliance cases for Review/Stop and High risk, and re-trigger activation when an outcome lands.

**Architecture:** Same layering. The crypto envelope is one adapter (`TrackWizzEnvelope`) with every ambiguous parameter in a `TrackWizzCryptoProfile` config; the gateway only speaks AS501 wire shapes; interpretation is a pure domain function over the parsed response. Jobs run on the `screening` and `aml-assessment` queues fed by outbox events emitted where the rows are created (declarations, profile re-save, and the `/internal/v1` re-run endpoints). SIT uses an in-process TrackWizz mock that performs the real crypto path with test keys because WireMock cannot encrypt.

**Tech Stack:** as before; Node `crypto` only.

**Spec:** design doc §6 (TrackWizz row), §10; product spec Jobs A/B and the AS501 appendix cards; `Partners Documentation/TrackWizz/AS501 API Document - Screening` (text export of v1.7: headers p.5, encryption §6, response fields §5, purposes §7, MRV codes).

## Global Constraints

- Endpoint: `POST {TRACKWIZZ_BASE_URL}/CustomerInfo/as501` with headers `ApiToken`, `Cluster` (`CL1_User`), `Domain`; body `{EncryptedData, EncryptionKey, Signature}`; response same envelope. Decrypted request `{requestId, sourceSystemName, purpose, customerList:[…]}`; purposes `01,04` (or `03,04`) for screening and `06` alone for risk rating. Never `01,03` together.
- Crypto (doc §6, parameters unresolved): session key 256-bit; AES encrypt JSON → base64; RSA-encrypt session key with TrackWizz public key → base64; sign `EncryptedData + EncryptionKey` with our private key → base64. Response: verify signature with TrackWizz public key **before** anything else; RSA-decrypt key with our private key; AES-decrypt. AES mode/IV, RSA padding and signature hash live in `TrackWizzCryptoProfile` (defaults `aes-256-cbc` zero IV, RSA PKCS#1 v1.5, `RSA-SHA256`), overridable through `TRACKWIZZ_CRYPTO_PROFILE` JSON until vendor test vectors are supplied. Keys, session keys, ciphertext and signatures never appear in logs, analytics or audit.
- Interpretation (never default to Proceed): the response is accepted only when the formal wrapper (`DecryptedData`) or the documented example wrapper (root) is present, `RequestId` equals ours, `OverallStatus` is `AcceptedByTW`, the customer entry has our `SourceSystemCustomerCode` with `ValidationOutcome: Success`, and every expected `PurposeCode` is present with `ValidationFailureCount: 0`. Screening outcome from purpose 01/03 `SuggestedAction` read from `PurposeResponse[].Data` or the customer level; if both are present and disagree, or neither is present → ERROR (integration exception). `Proceed` → PROCEED, `Review` → REVIEW, `Stop` → STOP. Purpose 04 `Data: null` is allowed and is not clearance. Risk rating from purpose 06 `Data.RiskValue` ∈ High/Medium/Low (+ `NextRiskReviewDate`); High → REVIEW with an EDD case, Medium/Low → PROCEED. Anything else → ERROR.
- Request mapping uses tenant codebooks in `config/rulebooks/trackwizz-codebook.v1.json` (occupation, income band, PEP, three-letter country, segment, screening/risk profile, date format `DD-MMM-YYYY`), all `PLACEHOLDER_PENDING_COMPLIANCE`. `sourceSystemCustomerCode` = customer id, `applicationRefNumber` = application id, `requestId` = run/assessment id, `constitutionType` individual.
- Jobs: `screening` queue consumes `ScreeningRequested {screeningRunId}`; `aml-assessment` consumes `AmlAssessmentRequested {assessmentId}`. A run is processed only while QUEUED (RUNNING while in flight). Transport failures retry through BullMQ (5 attempts) and end as ERROR `provider_unavailable`; vendor rejections (MRV codes) are ERROR `provider_rejected`; signature/decrypt failures are ERROR `envelope_invalid`. ERROR never clears. Decrypted responses and envelopes are stored as restricted evidence under `compliance/{applicationId}/…`.
- Cases: REVIEW/STOP screening and High risk open `compliance.compliance_cases` (kind `SCREENING_HIT` / `AML_HIGH_RISK`, status OPEN, provider case id/URL and hit summary restricted). `compliance.review_decisions` is created now for Phase 8. Any outcome emits `ComplianceOutcomeRecorded {applicationId}` (routed to activation, which re-evaluates its gates) and the analytics event `Application Processing Updated` with a generic outcome only.
- Internal re-runs: `POST /internal/v1/applications/{id}/screening-runs` `{identity_version, screening_policy_version}` → 202 `{screening_run_id, status:'QUEUED'}`; `POST …/aml-assessments` `{identity_version, profile_version, declaration_version, policy_version}` → 202 `{assessment_id, status:'QUEUED'}`; both supersede open rows of the same kind only.
- Branch `feat/phase7-trackwizz-screening-aml`; commit per task.

## Review Focus

1. A response whose signature does not verify: ERROR `envelope_invalid`, no decryption attempted, run never PROCEED (Task 3 test).
2. `RequestId` mismatch or a different `SourceSystemCustomerCode`: ERROR, even if the payload says Proceed (Task 1 test).
3. Purpose-level `SuggestedAction: Proceed` with customer-level `SuggestedAction: Review` in the same response: ERROR, not Proceed (Task 1 test).
4. Purpose 04 present with `Data: null` and purpose 01 missing: ERROR (Task 1 test).
5. The same `ScreeningRequested` job delivered twice: one TrackWizz call, one case (Task 4 test).

---

### Task 1: Domain (AS501 response parsing/evaluation, codebook rulebook, request mapping), specs
### Task 2: Persistence (compliance_cases, review_decisions; port extensions find/update/supersede-by-kind/cases), DB spec
### Task 3: Crypto envelope + profile config, TrackWizz gateway, in-process mock server (real crypto, scenario control), nock/unit specs, test keys
### Task 4: Screening and AML processors, outbox events from declarations/profile, internal re-run endpoints, activation re-trigger
### Task 5: Wiring, fakes, unit specs, Swagger, Postman, SIT (mock in worker helper; journey assertions), README, coverage gate

## Completion notes (2026-10-18)

All five tasks are built and verified. Notes and deviations:

- The crypto envelope follows AS501 §6 step by step, with every unresolved parameter (AES mode/IV, RSA padding,
  signature hash, concatenation order) in `TrackWizzCryptoProfile` and overridable through `TRACKWIZZ_CRYPTO_PROFILE`.
  Defaults are placeholders until TrackWizz supplies test vectors.
- WireMock cannot encrypt, so SIT boots an in-process AS501 mock (`tools/trackwizz-mock`) beside the worker; it
  decrypts with the test TrackWizz private key, signs its replies, and switches scenarios (no hits, probable,
  confirmed, risk High/Low, reject, bad signature). The same mock serves local runs (`npm run mock:trackwizz`).
- Both documented response wrappers are parsed; disagreement or absence of `SuggestedAction` is an ERROR. A
  `Proceed` that still reports hits is held for review rather than cleared.
- Screening runs and AML assessments are requested through outbox events from the declarations and profile services
  (Phase 4 rows now get consumed) and through the `/internal/v1` re-run endpoints; every outcome re-triggers the
  activation job through `ComplianceOutcomeRecorded`.
- The screens 21–25 SIT no longer forces compliance rows to PROCEED; the worker produces them through the mock.
