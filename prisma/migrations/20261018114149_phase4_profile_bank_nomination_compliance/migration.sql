-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "compliance";

-- CreateTable
CREATE TABLE "onboarding"."customer_profiles" (
    "application_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "occupation" TEXT NOT NULL,
    "annual_income_band" TEXT NOT NULL,
    "source_of_funds" JSONB NOT NULL,
    "source_of_funds_explanation" BYTEA,
    "evidence_required" BOOLEAN NOT NULL,
    "saved_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("application_id","version")
);

-- CreateTable
CREATE TABLE "onboarding"."declarations" (
    "application_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "tax_residencies" BYTEA NOT NULL,
    "pep_declaration" TEXT NOT NULL,
    "declaration_version" TEXT NOT NULL,
    "additional_information_required" BOOLEAN NOT NULL,
    "attested_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "declarations_pkey" PRIMARY KEY ("application_id","version")
);

-- CreateTable
CREATE TABLE "onboarding"."bank_accounts" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "account_ciphertext" BYTEA NOT NULL,
    "account_fingerprint" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."bank_verifications" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "required_actions" JSONB NOT NULL,
    "provider_reference" TEXT,
    "evidence_key" TEXT,
    "safe_error_category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."nominations" (
    "application_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "choice" TEXT NOT NULL,
    "allocation_mode" TEXT,
    "nominees_ciphertext" BYTEA NOT NULL,
    "nominee_count" INTEGER NOT NULL,
    "registration_status" TEXT NOT NULL,
    "saved_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "nominations_pkey" PRIMARY KEY ("application_id","version")
);

-- CreateTable
CREATE TABLE "compliance"."screening_runs" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "identity_version" INTEGER NOT NULL,
    "screening_policy_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "suggested_action" TEXT,
    "provider_request_id" TEXT,
    "evidence_key" TEXT,
    "safe_error_category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "screening_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance"."aml_assessments" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "identity_version" INTEGER NOT NULL,
    "profile_version" INTEGER NOT NULL,
    "declaration_version" INTEGER NOT NULL,
    "policy_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "risk_value" TEXT,
    "next_review_date" DATE,
    "provider_request_id" TEXT,
    "evidence_key" TEXT,
    "safe_error_category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "aml_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_application_id_account_fingerprint_idx" ON "onboarding"."bank_accounts"("application_id", "account_fingerprint");

-- CreateIndex
CREATE INDEX "bank_verifications_application_id_status_idx" ON "onboarding"."bank_verifications"("application_id", "status");

-- CreateIndex
CREATE INDEX "screening_runs_application_id_status_idx" ON "compliance"."screening_runs"("application_id", "status");

-- CreateIndex
CREATE INDEX "screening_runs_status_idx" ON "compliance"."screening_runs"("status");

-- CreateIndex
CREATE INDEX "aml_assessments_application_id_status_idx" ON "compliance"."aml_assessments"("application_id", "status");

-- CreateIndex
CREATE INDEX "aml_assessments_status_idx" ON "compliance"."aml_assessments"("status");
