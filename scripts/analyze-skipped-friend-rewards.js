#!/usr/bin/env node

/**
 * Diagnostic script to identify which friend rewards were skipped and why
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function analyzeSkippedFriendRewards() {
  console.log('🔍 Analyzing Skipped Friend Rewards\n')
  console.log('='.repeat(80))

  try {
    // Get all friend signup bonus gift cards
    const friendGiftCards = await prisma.giftCard.findMany({
      where: {
        reward_type: 'FRIEND_SIGNUP_BONUS'
      },
      include: {
        customer: {
          select: {
            square_customer_id: true,
            given_name: true,
            family_name: true,
            email_address: true,
            phone_number: true,
            used_referral_code: true,
            created_at: true
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    })

    // Get all successfully created referral rewards
    const createdRewards = await prisma.referralReward.findMany({
      where: {
        reward_type: 'friend_signup_bonus'
      },
      select: {
        referred_customer_id: true,
        gift_card_id: true
      }
    })
    const createdRewardsSet = new Set(
      createdRewards.map(r => `${r.referred_customer_id}:${r.gift_card_id}`)
    )

    // Get all referrers
    const allReferrers = new Set()
    const referralProfiles = await prisma.referralProfile.findMany({
      select: { personal_code: true }
    })
    referralProfiles.forEach(rp => {
      if (rp.personal_code) {
        allReferrers.add(rp.personal_code.toUpperCase())
      }
    })

    const referrersFromOldTable = await prisma.$queryRaw`
      SELECT personal_code
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL AND personal_code != ''
    `
    referrersFromOldTable.forEach(r => {
      if (r.personal_code) {
        allReferrers.add(r.personal_code.toUpperCase())
      }
    })

    // Categorize skipped rewards
    const skippedByReason = {
      no_referral_code: [],
      referrer_not_found: [],
      already_created: []
    }

    for (const giftCard of friendGiftCards) {
      const customer = giftCard.customer
      const rewardKey = `${customer.square_customer_id}:${giftCard.id}`
      
      // Check if already created
      if (createdRewardsSet.has(rewardKey)) {
        skippedByReason.already_created.push({
          gift_card_id: giftCard.id,
          customer_id: customer.square_customer_id,
          name: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown',
          email: customer.email_address,
          used_referral_code: customer.used_referral_code
        })
        continue
      }

      // Check for missing referral code
      if (!customer.used_referral_code || customer.used_referral_code.trim() === '') {
        skippedByReason.no_referral_code.push({
          gift_card_id: giftCard.id,
          customer_id: customer.square_customer_id,
          name: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown',
          email: customer.email_address,
          phone: customer.phone_number,
          created_at: customer.created_at,
          gift_card_created_at: giftCard.created_at
        })
        continue
      }

      // Check if referrer exists
      const referralCodeUpper = customer.used_referral_code.toUpperCase()
      if (!allReferrers.has(referralCodeUpper)) {
        skippedByReason.referrer_not_found.push({
          gift_card_id: giftCard.id,
          customer_id: customer.square_customer_id,
          name: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown',
          email: customer.email_address,
          phone: customer.phone_number,
          used_referral_code: customer.used_referral_code,
          created_at: customer.created_at,
          gift_card_created_at: giftCard.created_at
        })
      }
    }

    // Print results
    console.log(`\n📊 Summary:`)
    console.log(`   Total friend gift cards found: ${friendGiftCards.length}`)
    console.log(`   Successfully created rewards: ${createdRewards.length}`)
    console.log(`   Skipped (no referral code): ${skippedByReason.no_referral_code.length}`)
    console.log(`   Skipped (referrer not found): ${skippedByReason.referrer_not_found.length}`)
    console.log(`   Already created (duplicates): ${skippedByReason.already_created.length}`)

    console.log(`\n❌ Customers with NO REFERRAL CODE (${skippedByReason.no_referral_code.length}):`)
    console.log('='.repeat(80))
    skippedByReason.no_referral_code.slice(0, 20).forEach((c, i) => {
      console.log(`${i + 1}. ${c.name} (${c.customer_id})`)
      console.log(`   Email: ${c.email || 'N/A'}, Phone: ${c.phone || 'N/A'}`)
      console.log(`   Gift Card ID: ${c.gift_card_id}`)
      console.log(`   Customer Created: ${c.created_at}`)
      console.log()
    })
    if (skippedByReason.no_referral_code.length > 20) {
      console.log(`   ... and ${skippedByReason.no_referral_code.length - 20} more\n`)
    }

    console.log(`\n⚠️  Customers with REFERRER NOT FOUND (${skippedByReason.referrer_not_found.length}):`)
    console.log('='.repeat(80))
    skippedByReason.referrer_not_found.slice(0, 20).forEach((c, i) => {
      console.log(`${i + 1}. ${c.name} (${c.customer_id})`)
      console.log(`   Email: ${c.email || 'N/A'}, Phone: ${c.phone || 'N/A'}`)
      console.log(`   Used Referral Code: "${c.used_referral_code}"`)
      console.log(`   Gift Card ID: ${c.gift_card_id}`)
      console.log(`   Customer Created: ${c.created_at}`)
      console.log()
    })
    if (skippedByReason.referrer_not_found.length > 20) {
      console.log(`   ... and ${skippedByReason.referrer_not_found.length - 20} more\n`)
    }

    // Save to file
    const fs = require('fs')
    const output = {
      summary: {
        total_friend_gift_cards: friendGiftCards.length,
        successfully_created: createdRewards.length,
        skipped_no_referral_code: skippedByReason.no_referral_code.length,
        skipped_referrer_not_found: skippedByReason.referrer_not_found.length,
        already_created: skippedByReason.already_created.length
      },
      no_referral_code: skippedByReason.no_referral_code,
      referrer_not_found: skippedByReason.referrer_not_found
    }
    
    fs.writeFileSync(
      'skipped-friend-rewards-analysis.json',
      JSON.stringify(output, null, 2)
    )
    console.log(`\n💾 Full details saved to: skipped-friend-rewards-analysis.json`)

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  analyzeSkippedFriendRewards()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { analyzeSkippedFriendRewards }

