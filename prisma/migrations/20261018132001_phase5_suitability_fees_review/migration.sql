-- CreateTable
CREATE TABLE "onboarding"."suitability_assessments" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "questionnaire_version" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER,
    "risk_profile" TEXT,
    "permitted_approach_codes" JSONB NOT NULL,
    "missing_question_ids" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "suitability_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."investment_approaches" (
    "application_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "assessment_version" INTEGER NOT NULL,
    "approach_code" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "investment_approaches_pkey" PRIMARY KEY ("application_id","version")
);

-- CreateTable
CREATE TABLE "onboarding"."fee_illustrations" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "approach_code" TEXT NOT NULL,
    "fee_schedule_version" TEXT NOT NULL,
    "scenario_code" TEXT NOT NULL,
    "disclaimer_version" TEXT NOT NULL,
    "assumptions" JSONB NOT NULL,
    "line_items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fee_illustrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."acknowledgements" (
    "application_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "document_pack_version" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "fee_understanding_note" BYTEA NOT NULL,
    "fee_annexure_execution_required" BOOLEAN NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "acknowledgements_pkey" PRIMARY KEY ("application_id","version")
);

-- CreateTable
CREATE TABLE "onboarding"."review_snapshots" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "confirmed_application_version" INTEGER NOT NULL,
    "application_version" INTEGER NOT NULL,
    "document_pack_version" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "review_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suitability_assessments_application_id_version_key" ON "onboarding"."suitability_assessments"("application_id", "version");

-- CreateIndex
CREATE INDEX "fee_illustrations_application_id_idx" ON "onboarding"."fee_illustrations"("application_id");

-- CreateIndex
CREATE INDEX "review_snapshots_application_id_status_idx" ON "onboarding"."review_snapshots"("application_id", "status");
