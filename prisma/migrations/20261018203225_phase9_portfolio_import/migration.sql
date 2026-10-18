-- CreateTable
CREATE TABLE "onboarding"."portfolio_imports" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "client_ref_no" TEXT NOT NULL,
    "provider_request_id" TEXT,
    "authorisation_url" TEXT,
    "failure_category" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "portfolio_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding"."portfolio_snapshots" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "as_of" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "evidence_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_imports_client_ref_no_key" ON "onboarding"."portfolio_imports"("client_ref_no");

-- CreateIndex
CREATE INDEX "portfolio_imports_application_id_created_at_idx" ON "onboarding"."portfolio_imports"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "portfolio_imports_provider_request_id_idx" ON "onboarding"."portfolio_imports"("provider_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_snapshots_import_id_key" ON "onboarding"."portfolio_snapshots"("import_id");

-- CreateIndex
CREATE INDEX "portfolio_snapshots_application_id_created_at_idx" ON "onboarding"."portfolio_snapshots"("application_id", "created_at");
