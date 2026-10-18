# Phase 3: Identity, KYC Routing, Digital KYC, Documents and IPV (Screens 06–11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take an eligible application from PAN/name/DOB capture through KRA lookup, KYC routing (reuse / remediate / fresh / assisted), confirmation of an existing record, a DigiStudio fresh-KYC session with status polling, document upload to object storage with server-side validation, and selfie liveness/face-match IPV with an assisted alternative, plus the Digio webhook ingress.

**Architecture:** Same layering as Phases 1–2. Identity and KYC decisions are computed in worker jobs (BullMQ) fed by the transactional outbox; the customer-facing `GET` endpoints only read durable state. Vendor payloads stay in `infrastructure/partners/digio/*`; raw provider responses are kept as evidence objects in MinIO and referenced from Postgres. Routing uses versioned rulebooks (`kyc-reliance.v1.json`, `document-requirements.v1.json`, `ipv.v1.json`) with placeholder content.

**Tech Stack:** as before, plus `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (CJS) for MinIO.

**Spec:** design doc + product spec screens 06–11 and vendor appendix; Digio OpenAPI extracts saved under `docs/partners/digio/{kra,digistudio,face}`.

## Global Constraints

- Endpoints exactly as the product spec: `POST …/identity-verifications` (202 `{operation_id,status:'PROCESSING',next_screen:'KYC_PROGRESS'}`), `GET …/kyc` (200 `{status,route,operation_id,next_screen}`), `PUT …/kyc/confirmation` (200 `{status:'CONFIRMED',kyc_status:'COMPLETE',next_screen:'PROFILE'}`, 409 on stale), `POST …/kyc/sessions` (201 `{session_id,status:'REQUESTED',provider:'DIGIO',provider_request_id,sdk_launch:{access_token},next_screen:'PROVIDER_KYC'}`), `POST …/document-uploads` (200 `{upload_id,upload_url,expires_in_seconds}`), `POST …/documents` (202 `{document_id,status:'PROCESSING',operation_id}`), `POST …/kyc/additional-verifications` (201 `{verification_id,status:'REQUESTED',provider_session_id}`), `POST /v1/integrations/digio/webhooks` (200 `{received:true}`).
- Screens added: `KYC_PROGRESS, CONFIRM_KYC, FRESH_KYC, PROVIDER_KYC, DOCUMENT_UPLOAD, IPV, PROFILE`. Steps added: `IDENTITY, KYC, IPV`.
- KYC internal statuses: `PROCESSING, EXISTING_RECORD_AVAILABLE, NO_RECORD, REVIEW_REQUIRED, TECHNICAL_ERROR, COMPLETE`; routes: `REUSE, REMEDIATE, FRESH, ASSISTED`. Unknown KRA status codes route to `ASSISTED` (review), never to reuse.
- Digio DigiStudio: `POST /client/kyc/v2/request/with_template` (template name from config `DIGIO_KYC_TEMPLATE_NAME`, `notify_customer:false`, `generate_access_token:true`, `reference_id`=application id, `transaction_id`=session id); status via `POST /client/kyc/v2/{id}/response`; a session is complete only when request `status==='approved'` and every non-optional action has `status in (success, approved)` and `processing_done===true`. `requested` is never completion.
- Face: `POST /v3/client/kyc/analyze/file/liveness` and `POST /v3/client/kyc/facematch` (multipart). IPV passes only when liveness `result==='PASS'` with `score >= ipv.minLivenessScore` and face match `match_result==='matched'` with `confidence >= ipv.minFaceMatchConfidence` (rulebook, placeholder 70 / 80). KRA `ipv_flag==='Y'` on a reused record records an exemption with basis `KRA_IPV_FLAG`.
- Documents: upload via presigned PUT to MinIO bucket `pms-documents`, key `applications/{applicationId}/uploads/{uploadId}`; max 10 MB; allowed `image/jpeg,image/png,application/pdf`; server verifies real content type by magic bytes and SHA-256 after upload; executables and archives rejected.
- Webhooks: durably inserted into `integration_inbox` (event key = provider event id or SHA-256 of body) before `200`; processed by the worker; DigiStudio events trigger a status re-fetch rather than trusting the payload; KRA `kra_register` events are stored for Phase 6.
- Analytics events (backend): `Identity Verification Completed`, `KYC Route Assigned`, `Existing KYC Retrieval Completed`, `KYC Details Confirmed`, `KYC Completed`, `Digital KYC Request Created`, `Digital KYC Completed`, `Document Processing Completed`, `Additional Verification Completed`.
- Branch `feat/phase3-identity-kyc`; commit per task.

## Review Focus

1. The same PAN submitted by a second customer: the second identity is recorded as `DUPLICATE_REVIEW`, routed `ASSISTED`, and the response is identical to the normal 202 (Task 4 test).
2. A DigiStudio status fetch that returns `requested` with every action `success`: the session stays `IN_PROGRESS`; only `approved` completes it (Task 6 test).
3. Polling `GET …/kyc` 50 times creates no KRA calls (Task 4 test counts gateway invocations).
4. An upload registered with a PDF content type whose bytes are a PNG, or a 12 MB file: rejected with a safe error category, no document row marked VERIFIED (Task 7 test).
5. A webhook delivered twice with the same event id: one inbox row, one processing run (Task 8 test).

---

### Task 1: Digio DigiStudio, face and object-storage adapters
- Ports: `DigiStudioGatewayPort { createRequest(cmd): Promise<KycRequestCreated>; getStatus(providerRequestId): Promise<KycRequestStatus>; downloadMedia(fileId): Promise<Buffer> }`, `FaceGatewayPort { liveness(image: Buffer, uniqueRequestId): Promise<LivenessResult>; faceMatch(a: Buffer, b: Buffer, minimumMatch, uniqueRequestId): Promise<FaceMatchResult> }`, `ObjectStoragePort { presignPut(key, contentType, expiresSeconds): Promise<string>; head(key): Promise<{size,contentType}|null>; get(key): Promise<Buffer>; put(key, body, contentType): Promise<void> }`.
- Adapters under `infrastructure/partners/digio/digistudio`, `infrastructure/partners/digio/face`, `infrastructure/storage/s3-object.storage.ts`; mappers isolate vendor shapes; nock/MinIO tests.

### Task 2: Domain and persistence for identity, kyc, documents, ipv
- Domain: `IdentityVersion`, `KycRecord` (status/route/version/evidence ref/kra summary), `KycSession`, `DocumentUpload`, `Document`, `AdditionalVerification`; rulebook loaders for `kyc-reliance.v1.json`, `document-requirements.v1.json`, `ipv.v1.json`; `routeKyc(kraStatus, rulebook)`; `evaluateIpv(liveness, faceMatch, rulebook)`.
- Prisma schema `onboarding`: `identity_versions`, `kyc_records`, `kyc_sessions`, `document_uploads`, `documents`, `additional_verifications`, `tasks`; repositories + ports; DB specs.

### Task 3: Queue routing for Phase 3 jobs
- `EventRouter` registrations: `IdentityVerificationRequested → identity-verification/run`, `KycSessionCreated → kyc-status/poll`, `DocumentSubmitted → document-processing/verify`, `AdditionalVerificationRequested → identity-verification/ipv`, `DigioWebhookReceived → webhook-processing/digio`; worker module registers processors.

### Task 4: Screen 06–07 identity submission and KRA lookup job
- `IdentityService.submit` (validation, PAN dedupe by fingerprint, identity version row, KYC record PROCESSING, outbox, 202); `KycLookupProcessor` (KRA status → fetch → route → evidence object → kyc record update, application next screen, analytics); `KycQueryService.get` (read-only).

### Task 5: Screen 08 confirmation
- `KycConfirmationService.confirm` with version check, remediation path, step KYC complete, next PROFILE.

### Task 6: Screen 09 DigiStudio session and status polling
- `KycSessionService.create` → gateway → session row → outbox; `KycStatusPollProcessor` with exponential re-poll (max 24 h) and completion rules.

### Task 7: Screen 10 document uploads and processing
- `DocumentService.authoriseUpload`, `submit`; `DocumentProcessor` (head/get, magic bytes, checksum, size, status, analytics); requirement catalogue.

### Task 8: Screen 11 IPV and Digio webhook ingress
- `AdditionalVerificationService.request` (exemption, selfie liveness/face-match job, assisted task); `IpvProcessor`; `DigioWebhookController` + `DigioWebhookProcessor` (inbox dedupe, status re-fetch).

### Task 9: Controllers, Swagger, Postman, SIT journey 06–11 with WireMock stubs for KRA, DigiStudio, face APIs; coverage gate; docs.
