-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "onboarding";

-- CreateEnum
CREATE TYPE "identity"."CustomerState" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateTable
CREATE TABLE "identity"."customers" (
    "id" TEXT NOT NULL,
    "phone_ciphertext" BYTEA NOT NULL,
    "phone_fingerprint" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMPTZ,
    "email_ciphertext" BYTEA,
    "email_fingerprint" TEXT,
    "email_verified_at" TIMESTAMPTZ,
    "state" "identity"."CustomerState" NOT NULL DEFAULT 'UNVERIFIED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."auth_challenges" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "target_fingerprint" TEXT NOT NULL,
    "customer_id" TEXT,
    "application_id" TEXT,
    "status" TEXT NOT NULL,
    "max_attempts" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "resend_after" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "correlation_id" TEXT NOT NULL,

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."onboarding_applications" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "journey_version" TEXT NOT NULL,
    "next_screen" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "onboarding_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."application_steps" (
    "application_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "application_steps_pkey" PRIMARY KEY ("application_id","step_id")
);

-- CreateTable
CREATE TABLE "onboarding"."eligibility_decisions" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "customer_type" TEXT NOT NULL,
    "residential_status" TEXT NOT NULL,
    "intended_investment_inr" BIGINT NOT NULL,
    "distribution_route" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ruleset_version" TEXT NOT NULL,
    "journey_route" TEXT,
    "reasons" JSONB NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "eligibility_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_fingerprint_key" ON "identity"."customers"("phone_fingerprint");

-- CreateIndex
CREATE INDEX "customers_email_fingerprint_idx" ON "identity"."customers"("email_fingerprint");

-- CreateIndex
CREATE INDEX "auth_challenges_target_fingerprint_created_at_idx" ON "identity"."auth_challenges"("target_fingerprint", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "identity"."sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_customer_id_idx" ON "identity"."sessions"("customer_id");

-- CreateIndex
CREATE INDEX "onboarding_applications_customer_id_status_idx" ON "onboarding"."onboarding_applications"("customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_decisions_application_id_version_key" ON "onboarding"."eligibility_decisions"("application_id", "version");

-- AddForeignKey
ALTER TABLE "onboarding"."application_steps" ADD CONSTRAINT "application_steps_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "onboarding"."onboarding_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- one in-progress application per customer
CREATE UNIQUE INDEX "onboarding_applications_one_in_progress_per_customer" ON "onboarding"."onboarding_applications" ("customer_id") WHERE status = 'IN_PROGRESS';
