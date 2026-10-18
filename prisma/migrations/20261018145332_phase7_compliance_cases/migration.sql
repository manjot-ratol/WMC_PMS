-- AlterTable
ALTER TABLE "compliance"."screening_runs" ADD COLUMN     "confirmed_hit" BOOLEAN,
ADD COLUMN     "hits_count" INTEGER;

-- CreateTable
CREATE TABLE "compliance"."compliance_cases" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source_run_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_case_id" TEXT,
    "provider_case_url" TEXT,
    "summary" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "compliance_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance"."review_decisions" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_cases_application_id_status_idx" ON "compliance"."compliance_cases"("application_id", "status");

-- CreateIndex
CREATE INDEX "compliance_cases_status_idx" ON "compliance"."compliance_cases"("status");

-- CreateIndex
CREATE INDEX "review_decisions_case_id_idx" ON "compliance"."review_decisions"("case_id");

-- CreateIndex
CREATE INDEX "review_decisions_application_id_idx" ON "compliance"."review_decisions"("application_id");
