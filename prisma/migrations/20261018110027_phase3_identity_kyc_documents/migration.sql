-- CreateTable
CREATE TABLE "onboarding"."identity_versions" (
    "application_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "pan_ciphertext" BYTEA NOT NULL,
    "pan_fingerprint" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "permission_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "identity_versions_pkey" PRIMARY KEY ("application_id","version")
);

-- CreateTable
CREATE TABLE "onboarding"."kyc_records" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "identity_version" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "route" TEXT,
    "operation_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "evidence_key" TEXT,
    "ipv_exemption_basis" TEXT,
    "safe_error_category" TEXT,
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kyc_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."kyc_sessions" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_request_id" TEXT,
    "template_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "last_provider_status" TEXT,
    "poll_count" INTEGER NOT NULL DEFAULT 0,
    "safe_error_category" TEXT,
    "evidence_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "kyc_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."document_uploads" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "requirement_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "declared_content_type" TEXT NOT NULL,
    "declared_size_bytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "document_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."documents" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "requirement_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "safe_error_category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."additional_verifications" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "selfie_document_id" TEXT,
    "reference_document_id" TEXT,
    "provider_session_id" TEXT,
    "exemption_basis" TEXT,
    "liveness_score" DOUBLE PRECISION,
    "face_match_confidence" DOUBLE PRECISION,
    "threshold_version" TEXT NOT NULL,
    "safe_error_category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "additional_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."tasks" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_versions_pan_fingerprint_idx" ON "onboarding"."identity_versions"("pan_fingerprint");

-- CreateIndex
CREATE INDEX "kyc_records_application_id_idx" ON "onboarding"."kyc_records"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_records_application_id_identity_version_key" ON "onboarding"."kyc_records"("application_id", "identity_version");

-- CreateIndex
CREATE INDEX "kyc_sessions_application_id_status_idx" ON "onboarding"."kyc_sessions"("application_id", "status");

-- CreateIndex
CREATE INDEX "kyc_sessions_provider_request_id_idx" ON "onboarding"."kyc_sessions"("provider_request_id");

-- CreateIndex
CREATE INDEX "document_uploads_application_id_idx" ON "onboarding"."document_uploads"("application_id");

-- CreateIndex
CREATE INDEX "documents_application_id_requirement_id_idx" ON "onboarding"."documents"("application_id", "requirement_id");

-- CreateIndex
CREATE INDEX "additional_verifications_application_id_idx" ON "onboarding"."additional_verifications"("application_id");

-- CreateIndex
CREATE INDEX "tasks_application_id_status_idx" ON "onboarding"."tasks"("application_id", "status");
