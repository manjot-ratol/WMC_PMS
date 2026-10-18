# Phase 5: Suitability, Investment Approach, Fees/Acknowledgements and Review Snapshot (Screens 17–20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After nomination, score the investment risk questionnaire server-side, let the customer confirm only an approach the assessment permits, serve a rulebook-driven fee illustration, record distinct acknowledgements of the versioned document pack with the customer's own fee-understanding note, and create the immutable review snapshot that Phase 6 signing executes against.

**Architecture:** Same layering. Everything in this phase is internal (no partner calls). Suitability scoring, approach permission, fee arithmetic and the document-pack matrix are pure domain functions over versioned rulebooks; the services only orchestrate persistence, step completion and analytics. Consistency between sections is version-linked (an approach records the assessment version it was confirmed against; a snapshot records the application version it froze) rather than by mutating completed steps.

**Tech Stack:** as before. No new dependencies.

**Spec:** design doc §5 (Suitability / Fees / Review groups), §12 rulebooks, §13 document pack; product spec screens 17–20.

## Global Constraints

- Endpoints exactly as the spec: `POST …/suitability-assessments` (200 `{assessment_id,status:'COMPLETE'|'INCOMPLETE',missing_question_ids,next_screen}`; 409 on a questionnaire version that is not current), `PUT …/investment-approach` (200 `{status:'CONFIRMED',approach_version,next_screen:'FEES_DISCLOSURES'}`; 409 on a stale `assessment_id`/`assessment_version`), `POST …/fee-illustrations` (200 `{status:'CALCULATED',illustration_id,line_items,disclaimer_version}`), `POST …/acknowledgements` (200 `{status:'RECORDED',fee_annexure_execution_required,next_screen:'APPLICATION_REVIEW'}`; 409 on a `document_pack_version` that is not current), `POST …/review-confirmations` (200 `{status:'CONFIRMED',snapshot_id,next_screen:'SIGN_DOCUMENTS'}`; 409 on a stale `application_version` or pack version). Builder addition for screen 20: `GET …/review` (side-effect free masked summary, versions and open gates) so the client can obtain the `application_version`/`document_pack_version` it must echo.
- Screens added: `INVESTMENT_APPROACH, FEES_DISCLOSURES, APPLICATION_REVIEW, SIGN_DOCUMENTS` (`INVESTMENT_PROFILE` already exists for screen 17). Steps added: `SUITABILITY, APPROACH, ACKNOWLEDGEMENTS, REVIEW`.
- Rulebooks (placeholder content, `PLACEHOLDER_PENDING_COMPLIANCE`): `suitability.v1.json` (questions `OBJECTIVE, HORIZON, LIQUIDITY, EXPERIENCE, RISK_CAPACITY`, answer scores, contradiction pairs, score bands → risk profile → permitted approach codes, approach catalogue), `fees.v1.json` (per-approach management/performance/hurdle/high-water-mark/operating-expense terms in bps, illustration scenarios, `disclaimerVersion: 'illustration_v1'`), `document-pack.v1.json` (`packVersion: 1`, documents with `type`, `version`, `acknowledgementRequired`, `executionRequired`; `feeUnderstandingNote.minLength/maxLength`).
- Client-supplied scores are ignored (no score field is accepted). An incomplete or contradictory questionnaire never yields an approach: INCOMPLETE is persisted and returned with `missing_question_ids`; contradictory answers are 422 `ACTION_REQUIRED` with the conflicting question ids and nothing persisted.
- An approach is confirmable only when `confirmed:true`, the referenced assessment is the latest, its version matches, its status is COMPLETE and the approach code is in the assessment's permitted list. No customer override: a mismatch is 422 with reason `approach_not_permitted`.
- A fee illustration takes only `approach_code` (must equal the confirmed approach), `fee_schedule_version` (must be current) and a scenario from the rulebook; arithmetic lives in `domain/fees/fee-engine.ts` (integer rupees, half-up), performance fee only on return above the hurdle; line items `GROSS_RETURN, MANAGEMENT_FEE, PERFORMANCE_FEE, OPERATING_EXPENSES, TOTAL_FEES, NET_RETURN`.
- Acknowledgements: every `acknowledgementRequired` document must appear with `acknowledged:true` and the current `document_version`; viewing is never acknowledgement; the note is required, trimmed, within the rulebook length bounds, stored encrypted and never in analytics/audit; `fee_annexure_execution_required` comes from the pack (`FEE_ANNEXURE.executionRequired`).
- Review confirmation gates: steps `NOMINATION, SUITABILITY, APPROACH, ACKNOWLEDGEMENTS` complete; latest approach confirmed against the latest assessment version (else 422 `approach_reconfirmation_required`); latest acknowledgement against the current pack version; no open tasks in `SOURCE_OF_FUNDS_EVIDENCE, FATCA_ADDITIONAL_INFO, BANK_NAME_REVIEW` (422 with the categories); `application_version` equals the current application version (409). The snapshot stores section versions, masked summaries (PAN `AB••••••4F`, account `••••9012`, TINs omitted), a SHA-256 over the canonical JSON, and the application version after confirmation; prior CURRENT snapshots become SUPERSEDED.
- Analytics events: `Suitability Assessment Completed`, `Investment Approach Saved`, `Required Acknowledgements Completed`, `Application Review Confirmed`. Screen ids 17–20. No answers, scores, approach codes, amounts or note text in analytics.
- Branch `feat/phase5-suitability-fees-review`; commit per task.

## Review Focus

1. Answers that are complete but contradictory (long-term growth with an under-one-year horizon): 422 with both question ids, no assessment row (Task 3 test).
2. Approach confirmed against assessment version 1, then a new complete assessment (version 2): review confirmation is 422 `approach_reconfirmation_required` until the approach is re-confirmed (Task 5 test).
3. Acknowledgement with `document_pack_version: 1` after the pack rulebook moves to 2: 409, nothing written (Task 4 test with a modified rulebook).
4. Review confirmed, then the profile is edited: the next review confirmation with the old `application_version` is 409 and the old snapshot is SUPERSEDED once a new one is created (Task 5 test).
5. Fee illustration for an approach other than the confirmed one, or for an unknown scenario: 422, no illustration row (Task 4 test).

---

### Task 1: Domain, rulebooks, screens/steps
- `config/rulebooks/suitability.v1.json`, `fees.v1.json`, `document-pack.v1.json`.
- `src/domain/suitability/suitability.ts`: `loadSuitabilityRulebook`, `SUITABILITY_RULEBOOK`, `assessSuitability(answers: {questionId, answerId}[], rulebook): SuitabilityResult {status, missingQuestionIds, score, riskProfile, permittedApproachCodes}`, `assertApproachPermitted(result, approachCode, rulebook)`.
- `src/domain/fees/fee-engine.ts`: `loadFeeRulebook`, `FEE_RULEBOOK`, `illustrateFees(approachCode, scenarioCode, rulebook): FeeIllustration {lineItems, disclaimerVersion, assumptions}`.
- `src/domain/documents/document-pack.ts`: `loadDocumentPackRulebook`, `DOCUMENT_PACK_RULEBOOK`, `validateAcknowledgements(input, rulebook): {feeAnnexureExecutionRequired, items}`.
- `src/domain/review/review-snapshot.ts`: `buildReviewSnapshot(sections): {sections, hash}`, `maskPan`.
- Screens/steps/id prefixes (`sa`, `ia`, `fi`, `ack`, `snap`). Specs for each.

### Task 2: Persistence
- Prisma (`onboarding`): `suitability_assessments`, `investment_approaches`, `fee_illustrations`, `acknowledgements` (note encrypted), `review_snapshots`. Ports `SUITABILITY_REPOSITORY`, `FEE_REPOSITORY`, `REVIEW_REPOSITORY`; repositories; DB spec.

### Task 3: Suitability and approach services + controller
### Task 4: Fee illustration and acknowledgement services + controller
### Task 5: Review query and confirmation services + controller
### Task 6: Wiring, fakes, unit specs, Swagger, Postman, SIT journey 17–20, README, coverage gate

## Completion notes (2026-10-18)

All six tasks are built and verified: 399 unit tests, 32 SIT tests (screens 01–20 end to end with the in-process
worker and WireMock partners), coverage 98% lines / 85% branches, lint and build clean. Notes and deviations:

- Consistency between sections is version-linked rather than by reopening steps: an approach records the
  assessment version it was confirmed against, an acknowledgement records the pack version, and a snapshot records
  the application version after confirmation. `GET …/review` reports the resulting gates as `blockers`, and the
  confirmation refuses on the same gates (422) or on a stale `application_version` (409).
- Contradictory questionnaire answers are rejected (422, both question ids) and not persisted; INCOMPLETE
  assessments are persisted so the customer can resume.
- Fee illustrations are one-year, integer-rupee, with the performance fee only on return above the hurdle after
  fixed costs; the arithmetic is a placeholder pending the approved fee schedule.
- The review snapshot is the data snapshot (sections, versions, SHA-256). The document pack PDFs are rendered in
  Phase 6 from this snapshot, per the owner's "server-side document pack" decision.
