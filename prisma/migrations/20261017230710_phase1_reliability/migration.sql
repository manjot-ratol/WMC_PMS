-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "reliability";

-- CreateEnum
CREATE TYPE "reliability"."InboxStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "reliability"."ActorType" AS ENUM ('CUSTOMER', 'SYSTEM', 'REVIEWER', 'PARTNER');

-- CreateTable
CREATE TABLE "reliability"."business_outbox" (
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "business_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reliability"."analytics_outbox" (
    "id" UUID NOT NULL,
    "event_name" TEXT NOT NULL,
    "identity" TEXT,
    "properties" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "analytics_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reliability"."integration_inbox" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "reliability"."InboxStatus" NOT NULL DEFAULT 'RECEIVED',
    "correlation_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "last_error" TEXT,

    CONSTRAINT "integration_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reliability"."idempotency_records" (
    "principal_id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("principal_id","route","key")
);

-- CreateTable
CREATE TABLE "reliability"."audit_events" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "reliability"."ActorType" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_outbox_dispatched_at_created_at_idx" ON "reliability"."business_outbox"("dispatched_at", "created_at");

-- CreateIndex
CREATE INDEX "analytics_outbox_dispatched_at_created_at_idx" ON "reliability"."analytics_outbox"("dispatched_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_inbox_provider_event_key_key" ON "reliability"."integration_inbox"("provider", "event_key");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "reliability"."idempotency_records"("expires_at");

-- CreateIndex
CREATE INDEX "audit_events_aggregate_type_aggregate_id_occurred_at_idx" ON "reliability"."audit_events"("aggregate_type", "aggregate_id", "occurred_at");
