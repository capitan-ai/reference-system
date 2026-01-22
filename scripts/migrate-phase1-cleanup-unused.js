#!/usr/bin/env node

/**
 * Cleanup unused columns and tables in Supabase
 * This script safely removes columns/tables that don't exist in Prisma schema
 * 
 * WARNING: Review the generated SQL before executing!
 */

require('dotenv').config()
const { Pool } = require('pg')
const { PrismaClient } = require('@prisma/client')

const SUPABASE_DIRECT_URL = process.env.SUPABASE_DIRECT_URL || 
  'postgres://postgres:Step7nett.Umit@db.fqkrigvliyphjwpokwbl.supabase.co:5432/postgres'

// Convert camelCase to snake_case
function toSnakeCase(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase()
}

async function getPrismaColumns() {
  // Use Prisma introspection to get actual column names
  const prisma = new PrismaClient({
    datasources: { db: { url: SUPABASE_DIRECT_URL } }
  })
  
  const tables = {}
  
  // Get all models from Prisma
  const models = [
    'customer', 'refLink', 'refClick', 'refMatch', 'refReward',
    'booking', 'payment', 'order', 'location', 'teamMember',
    'serviceVariation', 'bookingAppointmentSegment', 'paymentTender',
    'giftCardRun', 'giftCardJob', 'notificationEvent',
    'devicePassRegistration', 'processedEvent', 'analyticsDeadLetter',
    'squareExistingClient', 'squareGiftCardGanAudit'
  ]
  
  // For each model, try to get a sample record to see column names
  for (const model of models) {
    try {
      // Use raw query to get column names
      const result = await prisma.$queryRawUnsafe(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = (
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN (
            SELECT LOWER(REPLACE(table_name, '_', '')) 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
          )
        )
        LIMIT 1
      `)
      
      // Get table name from Prisma model
      const tableName = await prisma.$queryRawUnsafe(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
      `)
      
    } catch (error) {
      // Model might not exist or have different name
    }
  }
  
  await prisma.$disconnect()
  
  // Manual mapping based on Prisma schema @@map directives
  // Note: ref_links, ref_matches, ref_rewards, processed_events tables have been removed
  return {
    'customers': ['id', 'square_customer_id', 'phone_e164', 'email', 'created_at', 'first_paid_seen', 'first_name', 'last_name', 'full_name'],
    'ref_clicks': ['id', 'ref_code', 'ref_sid', 'customer_id', 'first_seen_at', 'ip_hash', 'user_agent', 'landing_url', 'utm_source', 'utm_medium', 'utm_campaign', 'matched', 'created_at'],
    'bookings': ['id', 'customer_id', 'location_id', 'location_type', 'start_at', 'status', 'all_day', 'version', 'source', 'address_line_1', 'locality', 'administrative_district_level_1', 'postal_code', 'creator_type', 'creator_customer_id', 'creator_team_member_id', 'transition_time_minutes', 'created_at', 'updated_at', 'raw_json'],
    'booking_appointment_segments': ['id', 'booking_id', 'duration_minutes', 'intermission_minutes', 'service_variation_id', 'service_variation_client_id', 'service_variation_version', 'team_member_id', 'any_team_member'],
    'locations': ['id', 'square_location_id', 'name', 'address_line_1', 'locality', 'administrative_district_level_1', 'postal_code', 'created_at', 'updated_at'],
    'team_members': ['id', 'square_team_member_id', 'given_name', 'family_name', 'email_address', 'phone_number', 'status', 'location_code', 'role', 'created_at', 'updated_at'],
    'service_variations': ['id', 'square_id', 'name', 'service_id', 'duration_minutes', 'created_at', 'updated_at'],
    'orders': ['id', 'location_id', 'customer_id', 'state', 'version', 'reference_id', 'created_at', 'updated_at'],
    'payments': ['id', 'square_event_id', 'event_type', 'merchant_id', 'customer_id', 'location_id', 'order_id', 'booking_id', 'amount_money_amount', 'amount_money_currency', 'tip_money_amount', 'tip_money_currency', 'total_money_amount', 'total_money_currency', 'approved_money_amount', 'approved_money_currency', 'status', 'source_type', 'delay_action', 'delay_duration', 'delayed_until', 'administrator_id', 'application_details_square_product', 'capabilities', 'card_application_cryptogram', 'card_application_identifier', 'card_application_name', 'card_auth_result_code', 'card_avs_status', 'card_bin', 'card_brand', 'card_type', 'card_exp_month', 'card_exp_year', 'card_fingerprint', 'card_last_4', 'card_payment_account_reference', 'card_prepaid_type', 'card_entry_method', 'card_statement_description', 'card_status', 'card_verification_method', 'card_verification_results', 'card_cvv_status', 'card_payment_timeline_authorized_at', 'card_payment_timeline_captured_at', 'card_emv_authorization_response_code', 'device_id', 'device_installation_id', 'device_name', 'card_device_id', 'card_device_installation_id', 'card_device_name', 'receipt_number', 'receipt_url', 'processing_fee_amount', 'processing_fee_currency', 'processing_fee_type', 'refund_ids', 'created_at', 'updated_at', 'square_created_at', 'version'],
    'payment_tenders': ['id', 'payment_id', 'tender_id', 'type', 'amount_money_amount', 'amount_money_currency', 'note', 'card_status', 'card_application_cryptogram', 'card_application_identifier', 'card_application_name', 'card_auth_result_code', 'card_avs_status', 'card_bin', 'card_brand', 'card_type', 'card_exp_month', 'card_exp_year', 'card_fingerprint', 'card_last_4', 'card_payment_account_reference', 'card_prepaid_type', 'card_entry_method', 'card_statement_description', 'card_verification_method', 'card_verification_results', 'card_cvv_status', 'card_payment_timeline_authorized_at', 'card_payment_timeline_captured_at', 'card_emv_authorization_response_code', 'card_device_id', 'card_device_installation_id', 'card_device_name', 'cash_buyer_tendered_amount', 'cash_buyer_tendered_currency', 'cash_change_back_amount', 'cash_change_back_currency', 'gift_card_id', 'gift_card_gan', 'bank_account_details_account_last_4', 'bank_account_details_account_type', 'bank_account_details_routing_number', 'created_at'],
    'giftcard_runs': ['id', 'correlation_id', 'square_event_id', 'square_event_type', 'trigger_type', 'resource_id', 'stage', 'status', 'attempts', 'last_error', 'payload', 'context', 'resumed_at', 'created_at', 'updated_at'],
    'giftcard_jobs': ['id', 'correlation_id', 'trigger_type', 'stage', 'status', 'payload', 'context', 'attempts', 'max_attempts', 'scheduled_at', 'locked_at', 'lock_owner', 'last_error', 'created_at', 'updated_at'],
    'notification_events': ['id', 'channel', 'template_type', 'status', 'customer_id', 'referrer_customer_id', 'referral_event_id', 'external_id', 'template_id', 'sent_at', 'status_at', 'error_code', 'error_message', 'metadata', 'created_at'],
    'device_pass_registrations': ['device_library_identifier', 'pass_type_identifier', 'serial_number', 'push_token', 'created_at', 'updated_at'],
    'analytics_dead_letter': ['id', 'event_type', 'payload', 'error_message', 'retry_count', 'last_tried_at', 'created_at'],
    'square_existing_clients': ['id', 'square_customer_id', 'given_name', 'family_name', 'email_address', 'phone_number', 'got_signup_bonus', 'activated_as_referrer', 'personal_code', 'created_at', 'updated_at', 'gift_card_id', 'referral_code', 'referral_url', 'total_referrals', 'total_rewards', 'email_sent_at', 'first_payment_completed', 'ip_addresses', 'first_ip_address', 'last_ip_address', 'used_referral_code', 'referral_email_sent', 'gift_card_order_id', 'gift_card_line_item_uid', 'gift_card_delivery_channel', 'gift_card_activation_url', 'gift_card_pass_kit_url', 'gift_card_digital_email', 'referral_sms_sent', 'referral_sms_sent_at', 'referral_sms_sid', 'gift_card_gan'],
    'square_gift_card_gan_audit': ['gift_card_id', 'square_customer_id', 'resolved_gan', 'verified_at', 'raw_payload']
  }
}

async function main() {
  const pool = new Pool({
    connectionString: SUPABASE_DIRECT_URL,
    ssl: { rejectUnauthorized: false }
  })

  try {
    console.log('🔍 Analyzing database for unused columns and tables...\n')
    
    // Get expected columns from Prisma schema
    const expectedColumns = await getPrismaColumns()
    
    // Get actual database structure
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE '_prisma%'
      ORDER BY table_name
    `)
    
    const unusedColumns = {}
    const unusedTables = []
    
    for (const row of tablesResult.rows) {
      const tableName = row.table_name
      
      // Get actual columns
      const columnsResult = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' 
        AND table_name = $1
        ORDER BY ordinal_position
      `, [tableName])
      
      const actualColumns = columnsResult.rows.map(r => r.column_name)
      
      if (expectedColumns[tableName]) {
        // Table exists in schema - check for unused columns
        const expected = expectedColumns[tableName]
        const unused = actualColumns.filter(col => !expected.includes(col))
        if (unused.length > 0) {
          unusedColumns[tableName] = unused
        }
      } else {
        // Table doesn't exist in schema
        unusedTables.push(tableName)
      }
    }
    
    // Print results
    console.log('='.repeat(80))
    if (unusedTables.length === 0 && Object.keys(unusedColumns).length === 0) {
      console.log('✅ No unused tables or columns found!')
      console.log('   Database structure matches Prisma schema perfectly.')
    } else {
      if (unusedTables.length > 0) {
        console.log('UNUSED TABLES:')
        unusedTables.forEach(table => console.log(`  - ${table}`))
        console.log()
      }
      
      if (Object.keys(unusedColumns).length > 0) {
        console.log('UNUSED COLUMNS:')
        for (const [table, columns] of Object.entries(unusedColumns)) {
          console.log(`  ${table}:`)
          columns.forEach(col => console.log(`    - ${col}`))
        }
        console.log()
      }
      
      // Generate cleanup SQL
      console.log('='.repeat(80))
      console.log('CLEANUP SQL (REVIEW CAREFULLY BEFORE EXECUTING!):')
      console.log('='.repeat(80))
      
      if (unusedTables.length > 0) {
        console.log('\n-- Drop unused tables')
        unusedTables.forEach(table => {
          console.log(`DROP TABLE IF EXISTS "${table}" CASCADE;`)
        })
      }
      
      if (Object.keys(unusedColumns).length > 0) {
        console.log('\n-- Drop unused columns')
        for (const [table, columns] of Object.entries(unusedColumns)) {
          columns.forEach(col => {
            console.log(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${col}";`)
          })
        }
      }
      
      console.log('\n💡 IMPORTANT: Review the SQL above carefully!')
      console.log('   Save it to a file and execute manually after verification.')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()


