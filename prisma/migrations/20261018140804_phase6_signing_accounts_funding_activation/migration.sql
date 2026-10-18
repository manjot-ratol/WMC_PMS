-- CreateTable
CREATE TABLE "onboarding"."signing_sessions" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "document_pack_version" INTEGER NOT NULL,
    "signing_method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_request_id" TEXT,
    "pack_object_key" TEXT NOT NULL,
    "pack_sha256" TEXT NOT NULL,
    "documents" JSONB NOT NULL,
    "poll_count" INTEGER NOT NULL DEFAULT 0,
    "last_provider_status" TEXT,
    "safe_error_category" TEXT,
    "evidence_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "executed_at" TIMESTAMPTZ,

    CONSTRAINT "signing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."account_opening_runs" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "document_pack_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "blockers" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "account_opening_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."registry_submissions" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "registry" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "basis" TEXT,
    "provider_request_id" TEXT,
    "client_reference_id" TEXT,
    "last_provider_status" TEXT,
    "deadline_at" TIMESTAMPTZ,
    "evidence_key" TEXT,
    "safe_error_category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "registry_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."underlying_accounts" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "provider_receipt_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "account_reference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "underlying_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."funding_notifications" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "funding_method" TEXT NOT NULL,
    "customer_transfer_reference" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "funding_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."funding_receipts" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "provider_receipt_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_inr" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "source_account_fingerprint" TEXT,
    "destination_reference" TEXT NOT NULL,
    "value_date" TEXT NOT NULL,
    "match_status" TEXT NOT NULL,
    "mismatch_reasons" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "funding_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."activations" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "pms_account_id" TEXT NOT NULL,
    "gate_snapshot" JSONB NOT NULL,
    "activated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."task_responses" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "response_type" TEXT NOT NULL,
    "document_ids" JSONB NOT NULL,
    "text" BYTEA,
    "submitted_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "task_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signing_sessions_application_id_status_idx" ON "onboarding"."signing_sessions"("application_id", "status");

-- CreateIndex
CREATE INDEX "signing_sessions_provider_request_id_idx" ON "onboarding"."signing_sessions"("provider_request_id");

-- CreateIndex
CREATE INDEX "signing_sessions_snapshot_id_idx" ON "onboarding"."signing_sessions"("snapshot_id");

-- CreateIndex
CREATE INDEX "account_opening_runs_application_id_status_idx" ON "onboarding"."account_opening_runs"("application_id", "status");

-- CreateIndex
CREATE INDEX "registry_submissions_application_id_registry_idx" ON "onboarding"."registry_submissions"("application_id", "registry");

-- CreateIndex
CREATE INDEX "registry_submissions_provider_request_id_idx" ON "onboarding"."registry_submissions"("provider_request_id");

-- CreateIndex
CREATE INDEX "registry_submissions_client_reference_id_idx" ON "onboarding"."registry_submissions"("client_reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "underlying_accounts_provider_receipt_key_key" ON "onboarding"."underlying_accounts"("provider_receipt_key");

-- CreateIndex
CREATE INDEX "underlying_accounts_application_id_account_type_idx" ON "onboarding"."underlying_accounts"("application_id", "account_type");

-- CreateIndex
CREATE INDEX "funding_notifications_application_id_idx" ON "onboarding"."funding_notifications"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "funding_receipts_provider_receipt_key_key" ON "onboarding"."funding_receipts"("provider_receipt_key");

-- CreateIndex
CREATE INDEX "funding_receipts_application_id_match_status_idx" ON "onboarding"."funding_receipts"("application_id", "match_status");

-- CreateIndex
CREATE UNIQUE INDEX "activations_application_id_key" ON "onboarding"."activations"("application_id");

-- CreateIndex
CREATE INDEX "task_responses_task_id_idx" ON "onboarding"."task_responses"("task_id");
