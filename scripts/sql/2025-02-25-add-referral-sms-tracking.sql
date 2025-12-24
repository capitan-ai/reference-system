-- Adds SMS tracking columns to square_existing_clients
ALTER TABLE square_existing_clients
  ADD COLUMN IF NOT EXISTS referral_sms_sent BOOLEAN DEFAULT FALSE;

ALTER TABLE square_existing_clients
  ADD COLUMN IF NOT EXISTS referral_sms_sent_at TIMESTAMPTZ;

ALTER TABLE square_existing_clients
  ADD COLUMN IF NOT EXISTS referral_sms_sid TEXT;

-- Backfill newly added SMS flag for customers who previously received the SMS-only blast
UPDATE square_existing_clients
SET referral_sms_sent = TRUE,
    referral_sms_sent_at = COALESCE(referral_sms_sent_at, NOW())
WHERE (email_address IS NULL OR TRIM(email_address) = '')
  AND referral_email_sent = TRUE
  AND referral_sms_sent = FALSE;

