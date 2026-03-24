-- Add POST_VISIT_REMINDER to NotificationTemplateType enum
ALTER TYPE "public"."NotificationTemplateType" ADD VALUE IF NOT EXISTS 'POST_VISIT_REMINDER';
