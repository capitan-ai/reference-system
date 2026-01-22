#!/usr/bin/env node

/**
 * Validation script to check for data inconsistencies between:
 * - square_existing_clients (old table) 
 * - gift_cards, referral_profiles (new normalized tables)
 * 
 * This helps ensure both tables stay in sync during the transition period.
 * 
 * Usage:
 *   node scripts/validate-table-sync.js
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function validateTableSync() {
  console.log('🔍 Validating Table Synchronization')
  console.log('='.repeat(60))
  console.log()

  const issues = {
    giftCards: [],
    referralProfiles: [],
    summary: {
      totalIssues: 0,
      giftCardIssues: 0,
      referralProfileIssues: 0
    }
  }

  try {
    // ========================================================================
    // VALIDATE GIFT CARDS
    // ========================================================================
    console.log('📦 Step 1: Validating Gift Cards...')
    
    // Check: Customers with gift_card_id in square_existing_clients but no record in gift_cards
    try {
      const customersWithGiftCardButNoRecord = await prisma.$queryRaw`
        SELECT 
          sec.square_customer_id,
          sec.gift_card_id,
          sec.gift_card_gan,
          sec.given_name,
          sec.family_name
        FROM square_existing_clients sec
        WHERE sec.gift_card_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM gift_cards gc
            WHERE gc.square_gift_card_id = sec.gift_card_id
          )
      `

      if (customersWithGiftCardButNoRecord && customersWithGiftCardButNoRecord.length > 0) {
        console.log(`   ⚠️  Found ${customersWithGiftCardButNoRecord.length} customers with gift_card_id in square_existing_clients but no record in gift_cards`)
        issues.giftCards.push({
          type: 'missing_in_new_table',
          count: customersWithGiftCardButNoRecord.length,
          examples: customersWithGiftCardButNoRecord.slice(0, 5)
        })
        issues.summary.giftCardIssues += customersWithGiftCardButNoRecord.length
      } else {
        console.log(`   ✅ All gift cards in square_existing_clients have corresponding records in gift_cards`)
      }
    } catch (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        console.log(`   ⚠️  gift_cards table does not exist yet - skipping validation`)
      } else {
        throw error
      }
    }

    // Check: Gift cards in new table that don't match square_existing_clients
    try {
      const giftCardsNotInOldTable = await prisma.$queryRaw`
        SELECT 
          gc.square_customer_id,
          gc.square_gift_card_id,
          gc.gift_card_gan,
          sec.gift_card_id as old_table_gift_card_id
        FROM gift_cards gc
        LEFT JOIN square_existing_clients sec 
          ON sec.square_customer_id = gc.square_customer_id
        WHERE sec.gift_card_id IS NULL 
           OR sec.gift_card_id != gc.square_gift_card_id
      `

      if (giftCardsNotInOldTable && giftCardsNotInOldTable.length > 0) {
        console.log(`   ⚠️  Found ${giftCardsNotInOldTable.length} gift cards in gift_cards table that don't match square_existing_clients`)
        issues.giftCards.push({
          type: 'mismatch_with_old_table',
          count: giftCardsNotInOldTable.length,
          examples: giftCardsNotInOldTable.slice(0, 5)
        })
        issues.summary.giftCardIssues += giftCardsNotInOldTable.length
      } else {
        console.log(`   ✅ All gift cards in gift_cards table match square_existing_clients`)
      }
    } catch (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        console.log(`   ⚠️  gift_cards table does not exist yet - skipping validation`)
      } else {
        throw error
      }
    }

    console.log()

    // ========================================================================
    // VALIDATE REFERRAL PROFILES
    // ========================================================================
    console.log('👥 Step 2: Validating Referral Profiles...')
    
    // Check: Customers with personal_code in square_existing_clients but no ReferralProfile
    try {
      const customersWithCodeButNoProfile = await prisma.$queryRaw`
        SELECT 
          sec.square_customer_id,
          sec.personal_code,
          sec.referral_code,
          sec.activated_as_referrer,
          sec.given_name,
          sec.family_name
        FROM square_existing_clients sec
        WHERE (sec.personal_code IS NOT NULL OR sec.activated_as_referrer = TRUE)
          AND NOT EXISTS (
            SELECT 1 FROM referral_profiles rp
            WHERE rp.square_customer_id = sec.square_customer_id
          )
      `

      if (customersWithCodeButNoProfile && customersWithCodeButNoProfile.length > 0) {
        console.log(`   ⚠️  Found ${customersWithCodeButNoProfile.length} customers with referral data in square_existing_clients but no ReferralProfile`)
        issues.referralProfiles.push({
          type: 'missing_in_new_table',
          count: customersWithCodeButNoProfile.length,
          examples: customersWithCodeButNoProfile.slice(0, 5)
        })
        issues.summary.referralProfileIssues += customersWithCodeButNoProfile.length
      } else {
        console.log(`   ✅ All customers with referral data in square_existing_clients have ReferralProfile records`)
      }
    } catch (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        console.log(`   ⚠️  referral_profiles table does not exist yet - skipping validation`)
      } else {
        throw error
      }
    }

    // Check: ReferralProfiles with mismatched personal_code
    try {
      const mismatchedCodes = await prisma.$queryRaw`
        SELECT 
          rp.square_customer_id,
          rp.personal_code as new_table_code,
          sec.personal_code as old_table_code,
          rp.activated_as_referrer,
          sec.activated_as_referrer as old_activated
        FROM referral_profiles rp
        JOIN square_existing_clients sec 
          ON sec.square_customer_id = rp.square_customer_id
        WHERE rp.personal_code != sec.personal_code
           OR (rp.activated_as_referrer != COALESCE(sec.activated_as_referrer, FALSE))
      `

      if (mismatchedCodes && mismatchedCodes.length > 0) {
        console.log(`   ⚠️  Found ${mismatchedCodes.length} ReferralProfiles with mismatched data vs square_existing_clients`)
        issues.referralProfiles.push({
          type: 'mismatch_with_old_table',
          count: mismatchedCodes.length,
          examples: mismatchedCodes.slice(0, 5)
        })
        issues.summary.referralProfileIssues += mismatchedCodes.length
      } else {
        console.log(`   ✅ All ReferralProfile data matches square_existing_clients`)
      }
    } catch (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        console.log(`   ⚠️  referral_profiles table does not exist yet - skipping validation`)
      } else {
        throw error
      }
    }

    // Check: Used referral codes
    try {
      const mismatchedUsedCodes = await prisma.$queryRaw`
        SELECT 
          rp.square_customer_id,
          rp.used_referral_code as new_table_code,
          sec.used_referral_code as old_table_code
        FROM referral_profiles rp
        JOIN square_existing_clients sec 
          ON sec.square_customer_id = rp.square_customer_id
        WHERE rp.used_referral_code IS DISTINCT FROM sec.used_referral_code
      `

      if (mismatchedUsedCodes && mismatchedUsedCodes.length > 0) {
        console.log(`   ⚠️  Found ${mismatchedUsedCodes.length} ReferralProfiles with mismatched used_referral_code`)
        issues.referralProfiles.push({
          type: 'mismatched_used_code',
          count: mismatchedUsedCodes.length,
          examples: mismatchedUsedCodes.slice(0, 5)
        })
        issues.summary.referralProfileIssues += mismatchedUsedCodes.length
      } else {
        console.log(`   ✅ All used_referral_code values match`)
      }
    } catch (error) {
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        console.log(`   ⚠️  referral_profiles table does not exist yet - skipping validation`)
      } else {
        // Ignore this check if tables don't exist
      }
    }

    console.log()

    // ========================================================================
    // SUMMARY
    // ========================================================================
    console.log('='.repeat(60))
    console.log('📊 Validation Summary')
    console.log('='.repeat(60))
    
    issues.summary.totalIssues = issues.summary.giftCardIssues + issues.summary.referralProfileIssues
    
    if (issues.summary.totalIssues === 0) {
      console.log('✅ No inconsistencies found! Both tables are in sync.')
    } else {
      console.log(`⚠️  Found ${issues.summary.totalIssues} total issues:`)
      console.log(`   - Gift Card issues: ${issues.summary.giftCardIssues}`)
      console.log(`   - Referral Profile issues: ${issues.summary.referralProfileIssues}`)
      console.log()
      console.log('💡 Recommendations:')
      console.log('   1. Run migration scripts to sync missing data')
      console.log('   2. Check application logs for errors during writes')
      console.log('   3. Consider using database transactions for atomicity')
    }

    // Show examples of issues
    if (issues.giftCards.length > 0) {
      console.log()
      console.log('📦 Gift Card Issues:')
      issues.giftCards.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue.type}: ${issue.count} records`)
        if (issue.examples && issue.examples.length > 0) {
          console.log(`      Examples:`)
          issue.examples.slice(0, 3).forEach(example => {
            const name = `${example.given_name || ''} ${example.family_name || ''}`.trim() || 'Unknown'
            console.log(`         - ${example.square_customer_id}: ${name} (gift_card_id: ${example.gift_card_id})`)
          })
        }
      })
    }

    if (issues.referralProfiles.length > 0) {
      console.log()
      console.log('👥 Referral Profile Issues:')
      issues.referralProfiles.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue.type}: ${issue.count} records`)
        if (issue.examples && issue.examples.length > 0) {
          console.log(`      Examples:`)
          issue.examples.slice(0, 3).forEach(example => {
            const name = `${example.given_name || ''} ${example.family_name || ''}`.trim() || 'Unknown'
            console.log(`         - ${example.square_customer_id}: ${name}`)
          })
        }
      })
    }

    console.log()
    console.log('💡 During transition period:')
    console.log('   - Both tables are kept in sync')
    console.log('   - Application writes to both tables')
    console.log('   - Run this script regularly to catch inconsistencies')
    console.log('   - After full migration, old table fields can be removed')

  } catch (error) {
    console.error('\n❌ Validation failed:', error.message)
    console.error('Stack:', error.stack)
    
    if (error.message?.includes('does not exist') || error.code === '42P01') {
      console.log('\n💡 Tables may not exist yet. Run migrations first:')
      console.log('   npx prisma migrate deploy')
    }
    
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run validation
validateTableSync()
  .then(() => {
    console.log('\n✅ Validation script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  })

