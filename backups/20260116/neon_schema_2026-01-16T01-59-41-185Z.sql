-- Schema backup from Neon Database
-- Generated: 2026-01-16T01:59:41.490Z

-- Note: This is a simplified schema export.
-- For full schema, use Prisma migrations instead.

-- Table: _prisma_migrations
CREATE TABLE IF NOT EXISTS _prisma_migrations (id VARCHAR(36) NOT NULL, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMP WITH TIME ZONE, migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMP WITH TIME ZONE, started_at TIMESTAMP WITH TIME ZONE NOT NULL, applied_steps_count INTEGER NOT NULL);

-- Table: analytics_dead_letter
CREATE TABLE IF NOT EXISTS analytics_dead_letter (id TEXT NOT NULL, "eventType" TEXT NOT NULL, payload JSONB NOT NULL, "errorMessage" TEXT, "retryCount" INTEGER NOT NULL, "lastTriedAt" TIMESTAMP WITHOUT TIME ZONE, "createdAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: booking_appointment_segments
CREATE TABLE IF NOT EXISTS booking_appointment_segments (id TEXT NOT NULL, booking_id TEXT NOT NULL, duration_minutes INTEGER NOT NULL, intermission_minutes INTEGER NOT NULL, service_variation_id TEXT NOT NULL, service_variation_client_id TEXT, service_variation_version BIGINT, team_member_id TEXT, any_team_member BOOLEAN NOT NULL);

-- Table: bookings
CREATE TABLE IF NOT EXISTS bookings (id TEXT NOT NULL, customer_id TEXT, location_id TEXT NOT NULL, location_type TEXT, start_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, status TEXT NOT NULL, all_day BOOLEAN NOT NULL, version INTEGER NOT NULL, source TEXT, address_line_1 TEXT, locality TEXT, administrative_district_level_1 TEXT, postal_code TEXT, creator_type TEXT, creator_customer_id TEXT, creator_team_member_id TEXT, transition_time_minutes INTEGER, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: customers
CREATE TABLE IF NOT EXISTS customers (id TEXT NOT NULL, "squareCustomerId" TEXT, "phoneE164" VARCHAR(32), email VARCHAR(255), "createdAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL, "firstPaidSeen" BOOLEAN NOT NULL, "firstName" VARCHAR(100), "lastName" VARCHAR(100), "fullName" VARCHAR(200));

-- Table: device_pass_registrations
CREATE TABLE IF NOT EXISTS device_pass_registrations ("deviceLibraryIdentifier" TEXT NOT NULL, "passTypeIdentifier" TEXT NOT NULL, "serialNumber" TEXT NOT NULL, "pushToken" TEXT, "createdAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL, "updatedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: giftcard_jobs
CREATE TABLE IF NOT EXISTS giftcard_jobs (id TEXT NOT NULL, correlation_id TEXT NOT NULL, trigger_type TEXT NOT NULL, stage TEXT NOT NULL, status USER-DEFINED NOT NULL, payload JSONB NOT NULL, context JSONB, attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL, scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL, locked_at TIMESTAMP WITH TIME ZONE, lock_owner TEXT, last_error TEXT, created_at TIMESTAMP WITH TIME ZONE NOT NULL, updated_at TIMESTAMP WITH TIME ZONE NOT NULL);

-- Table: giftcard_runs
CREATE TABLE IF NOT EXISTS giftcard_runs (id TEXT NOT NULL, correlation_id TEXT NOT NULL, square_event_id TEXT, square_event_type TEXT, trigger_type TEXT NOT NULL, resource_id TEXT, stage TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL, last_error TEXT, payload JSONB, context JSONB, resumed_at TIMESTAMP WITH TIME ZONE, created_at TIMESTAMP WITH TIME ZONE NOT NULL, updated_at TIMESTAMP WITH TIME ZONE NOT NULL);

-- Table: locations
CREATE TABLE IF NOT EXISTS locations (id TEXT NOT NULL, square_location_id TEXT NOT NULL, name TEXT NOT NULL, address_line_1 TEXT, locality TEXT, administrative_district_level_1 TEXT, postal_code TEXT, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: notification_events
CREATE TABLE IF NOT EXISTS notification_events (id TEXT NOT NULL, channel USER-DEFINED NOT NULL, "templateType" USER-DEFINED NOT NULL, status USER-DEFINED NOT NULL, "customerId" TEXT, "referrerCustomerId" TEXT, "referralEventId" TEXT, "externalId" VARCHAR(255), "templateId" VARCHAR(255), "sentAt" TIMESTAMP WITHOUT TIME ZONE, "statusAt" TIMESTAMP WITHOUT TIME ZONE, "errorCode" VARCHAR(255), "errorMessage" TEXT, metadata JSONB, "createdAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: orders
CREATE TABLE IF NOT EXISTS orders (id TEXT NOT NULL, location_id TEXT, customer_id TEXT, state TEXT, version INTEGER, reference_id TEXT, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: payment_tenders
CREATE TABLE IF NOT EXISTS payment_tenders (id TEXT NOT NULL, payment_id TEXT NOT NULL, tender_id TEXT, type TEXT NOT NULL, amount_money_amount INTEGER NOT NULL, amount_money_currency TEXT NOT NULL, note TEXT, card_status TEXT, card_application_cryptogram TEXT, card_application_identifier TEXT, card_application_name TEXT, card_auth_result_code TEXT, card_avs_status TEXT, card_bin TEXT, card_brand TEXT, card_type TEXT, card_exp_month INTEGER, card_exp_year INTEGER, card_fingerprint TEXT, card_last_4 TEXT, card_payment_account_reference TEXT, card_prepaid_type TEXT, card_entry_method TEXT, card_statement_description TEXT, card_verification_method TEXT, card_verification_results TEXT, card_cvv_status TEXT, card_payment_timeline_authorized_at TIMESTAMP WITHOUT TIME ZONE, card_payment_timeline_captured_at TIMESTAMP WITHOUT TIME ZONE, card_emv_authorization_response_code TEXT, card_device_id TEXT, card_device_installation_id TEXT, card_device_name TEXT, cash_buyer_tendered_amount INTEGER, cash_buyer_tendered_currency TEXT, cash_change_back_amount INTEGER, cash_change_back_currency TEXT, gift_card_id TEXT, gift_card_gan TEXT, bank_account_details_account_last_4 TEXT, bank_account_details_account_type TEXT, bank_account_details_routing_number TEXT, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: payments
CREATE TABLE IF NOT EXISTS payments (id TEXT NOT NULL, square_event_id TEXT, event_type TEXT NOT NULL, merchant_id TEXT, customer_id TEXT, location_id TEXT NOT NULL, order_id TEXT, booking_id TEXT, amount_money_amount INTEGER NOT NULL, amount_money_currency TEXT NOT NULL, tip_money_amount INTEGER, tip_money_currency TEXT, total_money_amount INTEGER NOT NULL, total_money_currency TEXT NOT NULL, approved_money_amount INTEGER, approved_money_currency TEXT, status TEXT NOT NULL, source_type TEXT, delay_action TEXT, delay_duration TEXT, delayed_until TIMESTAMP WITHOUT TIME ZONE, team_member_id TEXT, employee_id TEXT, application_details_square_product TEXT, capabilities ARRAY, card_application_cryptogram TEXT, card_application_identifier TEXT, card_application_name TEXT, card_auth_result_code TEXT, card_avs_status TEXT, card_bin TEXT, card_brand TEXT, card_type TEXT, card_exp_month INTEGER, card_exp_year INTEGER, card_fingerprint TEXT, card_last_4 TEXT, card_payment_account_reference TEXT, card_prepaid_type TEXT, card_entry_method TEXT, card_statement_description TEXT, card_status TEXT, card_verification_method TEXT, card_verification_results TEXT, card_cvv_status TEXT, card_payment_timeline_authorized_at TIMESTAMP WITHOUT TIME ZONE, card_payment_timeline_captured_at TIMESTAMP WITHOUT TIME ZONE, card_emv_authorization_response_code TEXT, device_id TEXT, device_installation_id TEXT, device_name TEXT, card_device_id TEXT, card_device_installation_id TEXT, card_device_name TEXT, receipt_number TEXT, receipt_url TEXT, processing_fee_amount INTEGER, processing_fee_currency TEXT, processing_fee_type TEXT, refund_ids ARRAY, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, square_created_at TIMESTAMP WITHOUT TIME ZONE, version INTEGER);

-- Table: processed_events
CREATE TABLE IF NOT EXISTS processed_events ("idempotencyKey" TEXT NOT NULL, "createdAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: ref_clicks
CREATE TABLE IF NOT EXISTS ref_clicks (id TEXT NOT NULL, "refCode" TEXT NOT NULL, "refSid" VARCHAR(255), "customerId" TEXT, "firstSeenAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL, "ipHash" VARCHAR(64), "userAgent" VARCHAR(500), "landingUrl" VARCHAR(500), "utmSource" VARCHAR(100), "utmMedium" VARCHAR(100), "utmCampaign" VARCHAR(100), matched BOOLEAN NOT NULL, "createdAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: ref_links
CREATE TABLE IF NOT EXISTS ref_links (id TEXT NOT NULL, "customerId" TEXT NOT NULL, "refCode" TEXT NOT NULL, url TEXT NOT NULL, "issuedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL, status USER-DEFINED NOT NULL, "createdAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: ref_matches
CREATE TABLE IF NOT EXISTS ref_matches (id TEXT NOT NULL, "bookingId" TEXT NOT NULL, "customerId" TEXT NOT NULL, "refCode" TEXT NOT NULL, "refClickId" TEXT, "matchedVia" USER-DEFINED NOT NULL, confidence DOUBLE PRECISION NOT NULL, "matchedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: ref_rewards
CREATE TABLE IF NOT EXISTS ref_rewards (id TEXT NOT NULL, type USER-DEFINED NOT NULL, "referrerCustomerId" TEXT, "friendCustomerId" TEXT, "bookingId" TEXT, "refMatchId" TEXT, amount INTEGER NOT NULL, currency TEXT NOT NULL, status USER-DEFINED NOT NULL, reason TEXT, "createdAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL, "grantedAt" TIMESTAMP WITHOUT TIME ZONE, "redeemedAt" TIMESTAMP WITHOUT TIME ZONE);

-- Table: service_variations
CREATE TABLE IF NOT EXISTS service_variations (id TEXT NOT NULL, square_id TEXT NOT NULL, name TEXT, service_id TEXT, duration_minutes INTEGER, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL);

-- Table: square_existing_clients
CREATE TABLE IF NOT EXISTS square_existing_clients (id INTEGER NOT NULL, square_customer_id TEXT NOT NULL, given_name TEXT, family_name TEXT, email_address TEXT, phone_number TEXT, got_signup_bonus BOOLEAN, activated_as_referrer BOOLEAN, personal_code TEXT, created_at TIMESTAMP WITHOUT TIME ZONE, updated_at TIMESTAMP WITHOUT TIME ZONE, gift_card_id TEXT, referral_code TEXT, referral_url TEXT, total_referrals INTEGER, total_rewards INTEGER, email_sent_at TIMESTAMP WITH TIME ZONE, first_payment_completed BOOLEAN, ip_addresses ARRAY, first_ip_address TEXT, last_ip_address TEXT, used_referral_code TEXT, referral_email_sent BOOLEAN, gift_card_order_id TEXT, gift_card_line_item_uid TEXT, gift_card_delivery_channel TEXT, gift_card_activation_url TEXT, gift_card_pass_kit_url TEXT, gift_card_digital_email TEXT, referral_sms_sent BOOLEAN, referral_sms_sent_at TIMESTAMP WITH TIME ZONE, referral_sms_sid TEXT, gift_card_gan TEXT);

-- Table: square_gift_card_gan_audit
CREATE TABLE IF NOT EXISTS square_gift_card_gan_audit (gift_card_id TEXT NOT NULL, square_customer_id TEXT, resolved_gan TEXT, verified_at TIMESTAMP WITH TIME ZONE, raw_payload JSONB);

-- Table: team_members
CREATE TABLE IF NOT EXISTS team_members (id TEXT NOT NULL, square_team_member_id TEXT NOT NULL, given_name TEXT, family_name TEXT, email_address TEXT, phone_number TEXT, status TEXT, created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, role USER-DEFINED NOT NULL, location_code USER-DEFINED NOT NULL);

