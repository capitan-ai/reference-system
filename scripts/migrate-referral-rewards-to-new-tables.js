#!/usr/bin/env node

/**
 * Migration script to backfill historical referral rewards from existing data
 * into the new normalized referral_rewards table
 * 
 * This script attempts to reconstruct referral reward history from:
 * - Gift cards with reward_type REFERRER_REWARD (referrer rewards)
 * - Gift cards with reward_type FRIEND_SIGNUP_BONUS (friend bonuses)
 * - Customers with used_referral_code (to match referrers with friends)
 * - total_referrals and total_rewards counts in square_existing_clients
 * 
 * Usage:
 *   node scripts/migrate-referral-rewards-to-new-tables.js
 *   DRY_RUN=true node scripts/migrate-referral-rewards-to-new-tables.js  # Preview only
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const DRY_RUN = process.env.DRY_RUN === 'true'

async function migrateReferralRewards() {
  console.log('🚀 Starting Referral Rewards Backfill Migration')
  console.log('='.repeat(60))
  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n')
  }
  console.log()

  try {
    // Step 1: Find all referrer reward gift cards (REFERRER_REWARD type)
    console.log('📊 Step 1: Finding referrer reward gift cards...')
    const referrerGiftCards = await prisma.giftCard.findMany({
      where: {
        reward_type: 'REFERRER_REWARD'
      },
      include: {
        customer: {
          select: {
            square_customer_id: true,
            personal_code: true,
            total_referrals: true,
            total_rewards: true
          }
        }
      }
    })
    console.log(`   Found ${referrerGiftCards.length} referrer reward gift cards\n`)

    // Step 2: Find all friend signup bonus gift cards (FRIEND_SIGNUP_BONUS type)
    console.log('📊 Step 2: Finding friend signup bonus gift cards...')
    const friendGiftCards = await prisma.giftCard.findMany({
      where: {
        reward_type: 'FRIEND_SIGNUP_BONUS'
      },
      include: {
        customer: {
          select: {
            square_customer_id: true,
            used_referral_code: true
          }
        }
      }
    })
    console.log(`   Found ${friendGiftCards.length} friend signup bonus gift cards\n`)

    // Step 3: Find customers who used referral codes (to match with referrers)
    console.log('📊 Step 3: Finding customers who used referral codes...')
    const customersWithUsedCodes = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        used_referral_code,
        gift_card_id,
        got_signup_bonus,
        created_at
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
      ORDER BY created_at ASC
    `
    console.log(`   Found ${customersWithUsedCodes.length} customers who used referral codes\n`)

    // Step 4: Get existing referral rewards to avoid duplicates
    console.log('🔍 Step 4: Checking existing referral rewards...')
    const existingRewards = await prisma.referralReward.findMany({
      select: {
        id: true,
        referrer_customer_id: true,
        referred_customer_id: true,
        gift_card_id: true,
        reward_type: true
      }
    })
    const existingRewardsSet = new Set(
      existingRewards.map(r => 
        `${r.referrer_customer_id}:${r.referred_customer_id}:${r.gift_card_id || 'null'}:${r.reward_type || 'null'}`
      )
    )
    console.log(`   Found ${existingRewards.length} existing referral rewards\n`)

    // Step 5: Backfill friend signup bonuses
    console.log('📦 Step 5: Backfilling friend signup bonus rewards...\n')
    let friendRewardsCreated = 0
    let friendRewardsSkipped = 0
    let friendRewardsErrors = 0
    const friendRewardErrors = []

    for (const friendGiftCard of friendGiftCards) {
      try {
        const customer = friendGiftCard.customer
        if (!customer || !customer.used_referral_code) {
          friendRewardsSkipped++
          continue
        }

        // Find the referrer by their personal_code
        const referrerProfile = await prisma.referralProfile.findUnique({
          where: { personal_code: customer.used_referral_code },
          include: {
            customer: {
              select: {
                square_customer_id: true
              }
            }
          }
        })

        // Fallback: check square_existing_clients if not in referral_profiles
        let referrerCustomerId = null
        if (referrerProfile) {
          referrerCustomerId = referrerProfile.square_customer_id
        } else {
          const referrerFromOldTable = await prisma.$queryRaw`
            SELECT square_customer_id
            FROM square_existing_clients
            WHERE personal_code = ${customer.used_referral_code}
            LIMIT 1
          `
          if (referrerFromOldTable && referrerFromOldTable.length > 0) {
            referrerCustomerId = referrerFromOldTable[0].square_customer_id
          }
        }

        if (!referrerCustomerId) {
          friendRewardsSkipped++
          continue
        }

        // Check if this reward already exists
        const rewardKey = `${referrerCustomerId}:${customer.square_customer_id}:${friendGiftCard.id}:friend_signup_bonus`
        if (existingRewardsSet.has(rewardKey)) {
          friendRewardsSkipped++
          continue
        }

        if (!DRY_RUN) {
          await prisma.referralReward.create({
            data: {
              referrer_customer_id: referrerCustomerId,
              referred_customer_id: customer.square_customer_id,
              reward_amount_cents: friendGiftCard.initial_amount_cents || friendGiftCard.current_balance_cents || 1000,
              status: 'PAID',
              gift_card_id: friendGiftCard.id,
              payment_id: null,
              booking_id: null,
              reward_type: 'friend_signup_bonus',
              paid_at: friendGiftCard.created_at || new Date(),
              metadata: {
                referral_code: customer.used_referral_code,
                source: 'historical_backfill',
                gift_card_square_id: friendGiftCard.square_gift_card_id,
                migrated_at: new Date().toISOString()
              }
            }
          })
        }

        friendRewardsCreated++
        if (friendRewardsCreated <= 10 || friendRewardsCreated % 50 === 0) {
          console.log(`   ✅ Created friend reward: referrer ${referrerCustomerId} → friend ${customer.square_customer_id}`)
        }
      } catch (error) {
        friendRewardsErrors++
        friendRewardErrors.push({
          gift_card_id: friendGiftCard.id,
          customer_id: friendGiftCard.customer?.square_customer_id,
          error: error.message
        })
        if (friendRewardsErrors <= 10) {
          console.log(`   ❌ Error creating friend reward for gift card ${friendGiftCard.id}: ${error.message}`)
        }
      }
    }

    console.log()

    // Step 6: Backfill referrer rewards
    console.log('📦 Step 6: Backfilling referrer rewards...\n')
    let referrerRewardsCreated = 0
    let referrerRewardsSkipped = 0
    let referrerRewardsErrors = 0
    const referrerRewardErrors = []

    // Build a map of referral codes to referrer customer IDs
    const referralCodeToReferrerMap = new Map()
    const allReferrers = await prisma.$queryRaw`
      SELECT square_customer_id, personal_code
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL
        AND personal_code != ''
    `
    for (const referrer of allReferrers) {
      if (referrer.personal_code) {
        referralCodeToReferrerMap.set(referrer.personal_code.toUpperCase(), referrer.square_customer_id)
      }
    }

    // Also check referral_profiles table
    const referralProfiles = await prisma.referralProfile.findMany({
      select: {
        square_customer_id: true,
        personal_code: true
      }
    })
    for (const profile of referralProfiles) {
      if (profile.personal_code) {
        referralCodeToReferrerMap.set(profile.personal_code.toUpperCase(), profile.square_customer_id)
      }
    }

    // For each referrer with rewards, try to find friends who used their code
    for (const referrerGiftCard of referrerGiftCards) {
      try {
        const referrer = referrerGiftCard.customer
        if (!referrer || !referrer.personal_code) {
          referrerRewardsSkipped++
          continue
        }

        // Find customers who used this referrer's code
        const friendsWhoUsedCode = customersWithUsedCodes.filter(
          friend => friend.used_referral_code && 
                   friend.used_referral_code.toUpperCase() === referrer.personal_code.toUpperCase() &&
                   friend.square_customer_id !== referrer.square_customer_id // Exclude self-referrals
        )

        if (friendsWhoUsedCode.length === 0) {
          // No friends found who used this code - create a placeholder reward
          // This represents a reward that was given but we can't match to a specific friend
          const rewardKey = `${referrer.square_customer_id}:unknown:${referrerGiftCard.id}:referrer_reward`
          if (!existingRewardsSet.has(rewardKey)) {
            if (!DRY_RUN) {
              await prisma.referralReward.create({
                data: {
                  referrer_customer_id: referrer.square_customer_id,
                  referred_customer_id: 'unknown', // Placeholder for unmatched rewards
                  reward_amount_cents: referrerGiftCard.initial_amount_cents || referrerGiftCard.current_balance_cents || 1000,
                  status: 'PAID',
                  gift_card_id: referrerGiftCard.id,
                  payment_id: null,
                  booking_id: null,
                  reward_type: 'referrer_reward',
                  paid_at: referrerGiftCard.created_at || new Date(),
                  metadata: {
                    referral_code: referrer.personal_code,
                    source: 'historical_backfill',
                    note: 'Referrer reward - unable to match to specific friend',
                    gift_card_square_id: referrerGiftCard.square_gift_card_id,
                    migrated_at: new Date().toISOString()
                  }
                }
              })
            }
            referrerRewardsCreated++
            if (referrerRewardsCreated <= 10 || referrerRewardsCreated % 50 === 0) {
              console.log(`   ✅ Created referrer reward (unmatched): ${referrer.square_customer_id}`)
            }
          }
          continue
        }

        // Create one reward per friend who used the code
        // We'll limit to the number of rewards indicated by total_referrals
        const expectedRewardCount = referrer.total_referrals || friendsWhoUsedCode.length
        const friendsToProcess = friendsWhoUsedCode.slice(0, expectedRewardCount)

        for (const friend of friendsToProcess) {
          const rewardKey = `${referrer.square_customer_id}:${friend.square_customer_id}:${referrerGiftCard.id}:referrer_reward`
          if (existingRewardsSet.has(rewardKey)) {
            referrerRewardsSkipped++
            continue
          }

          if (!DRY_RUN) {
            await prisma.referralReward.create({
              data: {
                referrer_customer_id: referrer.square_customer_id,
                referred_customer_id: friend.square_customer_id,
                reward_amount_cents: 1000, // $10 per referral
                status: 'PAID',
                gift_card_id: referrerGiftCard.id,
                payment_id: null,
                booking_id: null,
                reward_type: 'referrer_reward',
                paid_at: referrerGiftCard.created_at || new Date(),
                metadata: {
                  referral_code: referrer.personal_code,
                  source: 'historical_backfill',
                  gift_card_square_id: referrerGiftCard.square_gift_card_id,
                  migrated_at: new Date().toISOString()
                }
              }
            })
            existingRewardsSet.add(rewardKey) // Track to avoid duplicates in this run
          }

          referrerRewardsCreated++
          if (referrerRewardsCreated <= 10 || referrerRewardsCreated % 50 === 0) {
            console.log(`   ✅ Created referrer reward: ${referrer.square_customer_id} ← friend ${friend.square_customer_id}`)
          }
        }
      } catch (error) {
        referrerRewardsErrors++
        referrerRewardErrors.push({
          gift_card_id: referrerGiftCard.id,
          referrer_id: referrerGiftCard.customer?.square_customer_id,
          error: error.message
        })
        if (referrerRewardsErrors <= 10) {
          console.log(`   ❌ Error creating referrer reward for gift card ${referrerGiftCard.id}: ${error.message}`)
        }
      }
    }

    console.log()

    // Step 7: Summary
    console.log('='.repeat(60))
    console.log('📊 Migration Summary')
    console.log('='.repeat(60))
    console.log(`   Friend Signup Bonus Rewards:`)
    console.log(`      ✅ Created: ${friendRewardsCreated}`)
    console.log(`      ⏭️  Skipped (already exists or no referrer found): ${friendRewardsSkipped}`)
    console.log(`      ❌ Errors: ${friendRewardsErrors}`)
    console.log()
    console.log(`   Referrer Rewards:`)
    console.log(`      ✅ Created: ${referrerRewardsCreated}`)
    console.log(`      ⏭️  Skipped (already exists): ${referrerRewardsSkipped}`)
    console.log(`      ❌ Errors: ${referrerRewardsErrors}`)
    console.log()

    if (friendRewardErrors.length > 0 || referrerRewardErrors.length > 0) {
      console.log('❌ Error Details:')
      if (friendRewardErrors.length > 0) {
        console.log('   Friend Reward Errors:')
        friendRewardErrors.slice(0, 10).forEach((err, i) => {
          console.log(`      ${i + 1}. Gift Card ${err.gift_card_id}: ${err.error}`)
        })
      }
      if (referrerRewardErrors.length > 0) {
        console.log('   Referrer Reward Errors:')
        referrerRewardErrors.slice(0, 10).forEach((err, i) => {
          console.log(`      ${i + 1}. Gift Card ${err.gift_card_id}: ${err.error}`)
        })
      }
      console.log()
    }

    console.log('💡 Next Steps:')
    console.log('   1. Verify the migrated data: SELECT * FROM referral_rewards ORDER BY created_at DESC LIMIT 20')
    console.log('   2. Check reward counts: SELECT reward_type, COUNT(*) FROM referral_rewards GROUP BY reward_type')
    console.log('   3. Verify referrer totals match: Compare total_referrals with COUNT(*) of referral_rewards')
    console.log()

    if (DRY_RUN) {
      console.log('⚠️  This was a DRY RUN - no data was actually migrated')
      console.log('   Run without DRY_RUN=true to perform the actual migration')
    } else {
      console.log('✅ Migration script completed')
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  migrateReferralRewards()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { migrateReferralRewards }



