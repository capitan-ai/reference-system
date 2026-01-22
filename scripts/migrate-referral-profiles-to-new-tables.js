#!/usr/bin/env node

/**
 * Migration script to move referral profile data from square_existing_clients
 * to the new normalized referral_profiles table
 * 
 * Usage:
 *   node scripts/migrate-referral-profiles-to-new-tables.js
 *   DRY_RUN=true node scripts/migrate-referral-profiles-to-new-tables.js  # Preview only
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const DRY_RUN = process.env.DRY_RUN === 'true'

async function migrateReferralProfiles() {
  console.log('🚀 Starting Referral Profile Data Migration')
  console.log('='.repeat(60))
  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n')
  }
  console.log()

  try {
    // Step 1: Find all customers with referral data
    console.log('📊 Step 1: Finding customers with referral data...')
    const customersWithReferralData = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        personal_code,
        referral_code,
        referral_url,
        activated_as_referrer,
        used_referral_code,
        referral_email_sent,
        referral_sms_sent,
        referral_sms_sent_at,
        referral_sms_sid,
        total_referrals,
        total_rewards,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE (personal_code IS NOT NULL 
             OR activated_as_referrer = TRUE
             OR used_referral_code IS NOT NULL)
      ORDER BY created_at DESC
    `

    console.log(`   Found ${customersWithReferralData.length} customers with referral data\n`)

    if (customersWithReferralData.length === 0) {
      console.log('✅ No referral profiles to migrate')
      return
    }

    // Step 2: Check which referral profiles already exist in new table
    console.log('🔍 Step 2: Checking existing records in referral_profiles table...')
    const existingProfiles = await prisma.referralProfile.findMany({
      select: {
        square_customer_id: true
      }
    })
    const existingProfileIds = new Set(existingProfiles.map(p => p.square_customer_id))
    console.log(`   Found ${existingProfileIds.size} existing referral profiles in new table\n`)

    // Step 3: Migrate referral profiles
    console.log('📦 Step 3: Migrating referral profile data...\n')
    
    let migrated = 0
    let skipped = 0
    let errors = 0
    const errorDetails = []

    for (let i = 0; i < customersWithReferralData.length; i++) {
      const customer = customersWithReferralData[i]
      
      // Skip if already migrated
      if (existingProfileIds.has(customer.square_customer_id)) {
        skipped++
        if (i < 10 || i % 1000 === 0) {
          console.log(`   ⏭️  Skipped (already exists): ${customer.square_customer_id}`)
        }
        continue
      }

      try {
        // Generate referral_url if we have personal_code but no URL
        let referralUrl = customer.referral_url
        if (!referralUrl && customer.personal_code) {
          referralUrl = generateReferralUrl(customer.personal_code)
        }

        if (!DRY_RUN) {
          // Create referral profile record
          await prisma.referralProfile.create({
            data: {
              square_customer_id: customer.square_customer_id,
              personal_code: customer.personal_code || null,
              referral_code: customer.referral_code || customer.personal_code || null,
              referral_url: referralUrl || null,
              activated_as_referrer: customer.activated_as_referrer || false,
              used_referral_code: customer.used_referral_code || null,
              referral_email_sent: customer.referral_email_sent || false,
              referral_sms_sent: customer.referral_sms_sent || false,
              referral_sms_sent_at: customer.referral_sms_sent_at || null,
              referral_sms_sid: customer.referral_sms_sid || null,
              total_referrals_count: customer.total_referrals || 0,
              total_rewards_cents: (customer.total_rewards || 0) * 100, // Convert dollars to cents
              created_at: customer.created_at || new Date(),
              updated_at: customer.updated_at || new Date(),
              activated_at: customer.activated_as_referrer ? (customer.updated_at || customer.created_at || new Date()) : null
            }
          })
        }

        migrated++
        if (i < 10 || i % 500 === 0) {
          console.log(`   ✅ Migrated: ${customer.square_customer_id} (personal_code: ${customer.personal_code || 'N/A'})`)
        }

      } catch (error) {
        errors++
        errorDetails.push({
          square_customer_id: customer.square_customer_id,
          personal_code: customer.personal_code,
          error: error.message
        })
        if (errors <= 10) {
          console.log(`   ❌ Error migrating ${customer.square_customer_id}: ${error.message}`)
        }
      }
    }

    console.log()
    console.log('='.repeat(60))
    console.log('📊 Migration Summary')
    console.log('='.repeat(60))
    console.log(`   Total customers with referral data: ${customersWithReferralData.length}`)
    console.log(`   ✅ Migrated: ${migrated}`)
    console.log(`   ⏭️  Skipped (already exists): ${skipped}`)
    console.log(`   ❌ Errors: ${errors}`)
    console.log()

    if (errors > 0 && errorDetails.length > 0) {
      console.log('❌ Error Details:')
      errorDetails.slice(0, 10).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.square_customer_id} (${err.personal_code || 'N/A'}): ${err.error}`)
      })
      if (errors > 10) {
        console.log(`   ... and ${errors - 10} more errors`)
      }
      console.log()
    }

    console.log('💡 Next Steps:')
    console.log('   1. Verify the migrated data: SELECT * FROM referral_profiles LIMIT 10')
    console.log('   2. Check that all referral profiles match square_existing_clients')
    console.log('   3. Run validation script to verify sync')
    console.log()
    console.log('✅ Migration script completed')

  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  migrateReferralProfiles()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { migrateReferralProfiles }

