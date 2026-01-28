#!/usr/bin/env node
/**
 * Fix data inconsistencies where got_signup_bonus=true but used_referral_code is null
 * 
 * This script identifies and optionally fixes customers who have:
 * - got_signup_bonus = true
 * - used_referral_code = null
 * - A gift card ID exists
 * 
 * This is a data inconsistency that should not occur in normal operation.
 */

const prisma = require('../lib/prisma-client')

async function findInconsistencies() {
  console.log('🔍 Searching for data inconsistencies...')
  console.log('   Looking for customers with got_signup_bonus=true but used_referral_code=null\n')
  
  const inconsistencies = await prisma.$queryRaw`
    SELECT 
      square_customer_id,
      given_name,
      family_name,
      email_address,
      phone_number,
      got_signup_bonus,
      used_referral_code,
      gift_card_id,
      gift_card_gan,
      created_at,
      updated_at
    FROM square_existing_clients
    WHERE got_signup_bonus = TRUE
      AND (used_referral_code IS NULL OR used_referral_code = '')
      AND gift_card_id IS NOT NULL
    ORDER BY created_at DESC
  `
  
  console.log(`📊 Found ${inconsistencies.length} inconsistent record(s):\n`)
  
  if (inconsistencies.length === 0) {
    console.log('✅ No inconsistencies found!')
    return []
  }
  
  for (const customer of inconsistencies) {
    console.log(`   Customer: ${customer.given_name} ${customer.family_name}`)
    console.log(`   Phone: ${customer.phone_number}`)
    console.log(`   Email: ${customer.email_address || 'N/A'}`)
    console.log(`   Customer ID: ${customer.square_customer_id}`)
    console.log(`   Gift Card ID: ${customer.gift_card_id}`)
    console.log(`   Gift Card GAN: ${customer.gift_card_gan || 'N/A'}`)
    console.log(`   Created: ${customer.created_at}`)
    console.log(`   Updated: ${customer.updated_at}`)
    
    // Check if there's a ReferralReward record
    const rewardRecords = await prisma.referralReward.findMany({
      where: {
        referred_customer_id: customer.square_customer_id,
        reward_type: 'friend_signup_bonus'
      }
    })
    
    console.log(`   ReferralReward records: ${rewardRecords.length}`)
    if (rewardRecords.length > 0) {
      console.log(`   - Referrer: ${rewardRecords[0].referrer_customer_id}`)
      console.log(`   - Reward amount: $${rewardRecords[0].reward_amount_cents / 100}`)
    }
    
    // Check if there's a gift card record in the new table
    const giftCardRecord = await prisma.giftCard.findUnique({
      where: { square_gift_card_id: customer.gift_card_id }
    })
    
    if (giftCardRecord) {
      console.log(`   Gift Card record exists: ${giftCardRecord.id}`)
      console.log(`   Reward type: ${giftCardRecord.reward_type}`)
    } else {
      console.log(`   ⚠️  No gift card record in gift_cards table`)
    }
    
    console.log('')
  }
  
  return inconsistencies
}

async function fixInconsistencies(dryRun = true) {
  const inconsistencies = await findInconsistencies()
  
  if (inconsistencies.length === 0) {
    return
  }
  
  console.log(`\n${dryRun ? '🔍 DRY RUN' : '🔧 FIXING'} inconsistencies...\n`)
  
  for (const customer of inconsistencies) {
    console.log(`Processing: ${customer.given_name} ${customer.family_name} (${customer.square_customer_id})`)
    
    // Try to find the referral code from ReferralReward records
    const rewardRecords = await prisma.referralReward.findMany({
      where: {
        referred_customer_id: customer.square_customer_id,
        reward_type: 'friend_signup_bonus'
      }
    })
    
    let referralCode = null
    
    if (rewardRecords.length > 0) {
      // Get referral code from metadata
      const metadata = rewardRecords[0].metadata
      if (metadata && typeof metadata === 'object' && metadata.referral_code) {
        referralCode = metadata.referral_code
        console.log(`   ✅ Found referral code from ReferralReward: ${referralCode}`)
      }
    }
    
    // If still no referral code, check ReferralProfile
    if (!referralCode) {
      const referralProfile = await prisma.referralProfile.findUnique({
        where: { square_customer_id: customer.square_customer_id }
      })
      
      if (referralProfile?.used_referral_code) {
        referralCode = referralProfile.used_referral_code
        console.log(`   ✅ Found referral code from ReferralProfile: ${referralCode}`)
      }
    }
    
    if (!referralCode) {
      console.log(`   ⚠️  Could not determine referral code for this customer`)
      console.log(`   ⚠️  This gift card may have been incorrectly issued`)
      console.log(`   ⚠️  Recommendation: Review manually and consider setting got_signup_bonus=false`)
      continue
    }
    
    if (dryRun) {
      console.log(`   [DRY RUN] Would update used_referral_code to: ${referralCode}`)
    } else {
      try {
        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET used_referral_code = ${referralCode},
              updated_at = NOW()
          WHERE square_customer_id = ${customer.square_customer_id}
        `
        console.log(`   ✅ Updated used_referral_code to: ${referralCode}`)
      } catch (error) {
        console.error(`   ❌ Error updating: ${error.message}`)
      }
    }
    
    // Create ReferralReward record if missing
    if (rewardRecords.length === 0) {
      const giftCardRecord = await prisma.giftCard.findUnique({
        where: { square_gift_card_id: customer.gift_card_id }
      })
      
      if (giftCardRecord && referralCode) {
        // Find referrer by code
        const referrer = await prisma.$queryRaw`
          SELECT square_customer_id, given_name, family_name
          FROM square_existing_clients
          WHERE personal_code = ${referralCode}
            OR referral_code = ${referralCode}
          LIMIT 1
        `
        
        if (referrer && referrer.length > 0) {
          if (dryRun) {
            console.log(`   [DRY RUN] Would create ReferralReward record for referrer: ${referrer[0].square_customer_id}`)
          } else {
            try {
              await prisma.referralReward.create({
                data: {
                  referrer_customer_id: referrer[0].square_customer_id,
                  referred_customer_id: customer.square_customer_id,
                  reward_amount_cents: 1000,
                  status: 'PAID',
                  gift_card_id: giftCardRecord.id,
                  payment_id: null,
                  booking_id: null,
                  reward_type: 'friend_signup_bonus',
                  paid_at: customer.created_at || new Date(),
                  metadata: {
                    referral_code: referralCode,
                    source: 'data-fix-script',
                    gift_card_square_id: customer.gift_card_id,
                    fixed_at: new Date().toISOString()
                  }
                }
              })
              console.log(`   ✅ Created ReferralReward record`)
            } catch (error) {
              console.error(`   ❌ Error creating ReferralReward: ${error.message}`)
            }
          }
        } else {
          console.log(`   ⚠️  Could not find referrer for code: ${referralCode}`)
        }
      }
    }
    
    console.log('')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = !args.includes('--fix')
  
  try {
    if (dryRun) {
      console.log('🔍 Running in DRY RUN mode (no changes will be made)')
      console.log('   Use --fix to apply changes\n')
    } else {
      console.log('🔧 Running in FIX mode (changes will be applied)\n')
    }
    
    await fixInconsistencies(dryRun)
    
    console.log('✅ Done!')
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
}

module.exports = { findInconsistencies, fixInconsistencies }



