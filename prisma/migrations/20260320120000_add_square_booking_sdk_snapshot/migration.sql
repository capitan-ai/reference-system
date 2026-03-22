-- Standalone staging table for Square List Bookings (no FKs).
-- Run in Supabase SQL editor if `prisma db push` fails (permission / drift).

CREATE TABLE IF NOT EXISTS "public"."square_booking_sdk_snapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "square_booking_id" TEXT NOT NULL,
    "square_location_id" TEXT,
    "square_customer_id" TEXT,
    "start_at" TIMESTAMPTZ(6),
    "status" TEXT,
    "square_version" INTEGER,
    "square_updated_at" TIMESTAMPTZ(6),
    "raw_json" JSONB NOT NULL,
    "sync_batch_id" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6),
    "window_end" TIMESTAMPTZ(6),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "square_booking_sdk_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "square_booking_sdk_snapshot_square_booking_id_key"
    ON "public"."square_booking_sdk_snapshot"("square_booking_id");

CREATE INDEX IF NOT EXISTS "square_booking_sdk_snapshot_start_at_idx"
    ON "public"."square_booking_sdk_snapshot"("start_at");

CREATE INDEX IF NOT EXISTS "square_booking_sdk_snapshot_square_location_id_idx"
    ON "public"."square_booking_sdk_snapshot"("square_location_id");

CREATE INDEX IF NOT EXISTS "square_booking_sdk_snapshot_sync_batch_id_idx"
    ON "public"."square_booking_sdk_snapshot"("sync_batch_id");

CREATE INDEX IF NOT EXISTS "square_booking_sdk_snapshot_status_idx"
    ON "public"."square_booking_sdk_snapshot"("status");
