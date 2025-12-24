-- Create table for gift card runs (tracking webhook processing)
CREATE TABLE IF NOT EXISTS "giftcard_runs" (
  "id" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "square_event_id" TEXT,
  "square_event_type" TEXT,
  "trigger_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "stage" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "payload" JSONB,
  "context" JSONB,
  "resumed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "giftcard_runs_pkey" PRIMARY KEY ("id")
);

-- Create unique index on correlation_id
CREATE UNIQUE INDEX IF NOT EXISTS "giftcard_runs_correlation_id_key"
  ON "giftcard_runs" ("correlation_id");

-- Create index for querying by status
CREATE INDEX IF NOT EXISTS "giftcard_runs_status_idx"
  ON "giftcard_runs" ("status");

-- Create index for querying by square_event_id
CREATE INDEX IF NOT EXISTS "giftcard_runs_square_event_id_idx"
  ON "giftcard_runs" ("square_event_id");

