-- Add GIFT_CARD_DELIVERY to NotificationTemplateType enum
ALTER TYPE "public"."NotificationTemplateType" ADD VALUE IF NOT EXISTS 'GIFT_CARD_DELIVERY';

-- Add opened/clicked to NotificationStatus enum
ALTER TYPE "public"."NotificationStatus" ADD VALUE IF NOT EXISTS 'opened';
ALTER TYPE "public"."NotificationStatus" ADD VALUE IF NOT EXISTS 'clicked';

-- Add index on externalId for webhook status lookups
CREATE INDEX IF NOT EXISTS "notification_external_id_idx" ON "public"."notification_events"("externalId");
