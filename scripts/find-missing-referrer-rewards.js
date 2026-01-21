#!/usr/bin/env node
/**
 * Find all customers who completed first payment but their referrer didn't get a reward
 * This script identifies missing referrer rewards that need to be issued
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function findMissingReferrerRewards() {
  console.log('🔍 Finding Missing Referrer Rewards\n')
  console.log('='.repeat(80))
  
  try {
    // Find all customers who:
    // 1. Completed first payment
    // 2. Used a referral code
    // 3. Their referrer exists
    const customersWithMissingRewards = await prisma.$queryRaw`
      SELECT 
        friend.square_customer_id as friend_customer_id,
        friend.given_name as friend_given_name,
        friend.family_name as friend_family_name,
        friend.email_address as friend_email,
        friend.used_referral_code,
        friend.first_payment_completed,
        friend.created_at as friend_created_at,
        friend.updated_at as friend_updated_at,
        referrer.square_customer_id as referrer_customer_id,
        referrer.given_name as referrer_given_name,
        referrer.family_name as referrer_family_name,
        referrer.email_address as referrer_email,
        referrer.personal_code as referrer_code,
        referrer.total_referrals,
        referrer.total_rewards,
        referrer.gift_card_id as referrer_gift_card_id,
        referrer.activated_as_referrer
      FROM square_existing_clients friend
      INNER JOIN square_existing_clients referrer
        ON UPPER(TRIM(friend.used_referral_code)) = UPPER(TRIM(referrer.personal_code))
      WHERE friend.first_payment_completed = TRUE
        AND friend.used_referral_code IS NOT NULL
        AND friend.used_referral_code != ''
        AND referrer.activated_as_referrer = TRUE
      ORDER BY friend.updated_at DESC
    `
    
    if (!customersWithMissingRewards || customersWithMissingRewards.length === 0) {
      console.log('✅ No customers found with completed first payment and referral codes')
      return []
    }
    
    console.log(`\n📊 Found ${customersWithMissingRewards.length} customers who completed first payment with referral codes\n`)
    
    // Now we need to check if the referrer actually got the reward
    // We'll count how many friends completed first payment for each referrer
    // and compare with their total_referrals
    
    const referrerFriendCounts = await prisma.$queryRaw`
      SELECT 
        referrer.square_customer_id as referrer_customer_id,
        COUNT(friend.square_customer_id) as friends_completed_payment
      FROM square_existing_clients referrer
      INNER JOIN square_existing_clients friend
        ON UPPER(TRIM(friend.used_referral_code)) = UPPER(TRIM(referrer.personal_code))
      WHERE friend.first_payment_completed = TRUE
        AND friend.used_referral_code IS NOT NULL
        AND friend.used_referral_code != ''
        AND referrer.activated_as_referrer = TRUE
      GROUP BY referrer.square_customer_id
    `
    
    const friendCountMap = new Map()
    referrerFriendCounts.forEach(row => {
      friendCountMap.set(row.referrer_customer_id, parseInt(row.friends_completed_payment) || 0)
    })
    
    // More accurate approach: count how many friends completed payment for each referrer
    // and compare with their total_referrals
    // If a referrer has fewer total_referrals than friends who completed payment, they're missing rewards
    
    // Group friends by referrer
    const referrerFriendsMap = new Map()
    for (const customer of customersWithMissingRewards) {
      const referrerId = customer.referrer_customer_id
      if (!referrerFriendsMap.has(referrerId)) {
        referrerFriendsMap.set(referrerId, {
          referrer: {
            id: customer.referrer_customer_id,
            name: `${customer.referrer_given_name || ''} ${customer.referrer_family_name || ''}`.trim(),
            email: customer.referrer_email,
            code: customer.referrer_code,
            totalReferrals: customer.total_referrals || 0,
            totalRewards: customer.total_rewards || 0,
            giftCardId: customer.referrer_gift_card_id,
            updatedAt: customer.referrer_updated_at || customer.referrer_created_at
          },
          friends: []
        })
      }
      
      referrerFriendsMap.get(referrerId).friends.push({
        id: customer.friend_customer_id,
        name: `${customer.friend_given_name || ''} ${customer.friend_family_name || ''}`.trim(),
        email: customer.friend_email,
        code: customer.used_referral_code,
        paymentCompletedAt: customer.friend_updated_at
      })
    }
    
    // Find missing rewards: if referrer has fewer total_referrals than friends who completed payment
    const missingRewards = []
    for (const [referrerId, data] of referrerFriendsMap.entries()) {
      const friendsCompleted = data.friends.length
      const actualReferrals = data.referrer.totalReferrals
      
      // If we have more friends who completed payment than referrals recorded,
      // the referrer is missing rewards
      if (friendsCompleted > actualReferrals) {
        // For each friend beyond the recorded referrals, they need a reward
        const missingCount = friendsCompleted - actualReferrals
        
        // Sort friends by payment completion time (oldest first)
        const sortedFriends = [...data.friends].sort((a, b) => 
          new Date(a.paymentCompletedAt) - new Date(b.paymentCompletedAt)
        )
        
        // The oldest friends should have triggered rewards first
        // So if we're missing rewards, it's likely the oldest ones that didn't get processed
        // Filter out self-referrals (friend and referrer are the same person)
        for (let i = 0; i < missingCount && i < sortedFriends.length; i++) {
          const friend = sortedFriends[i]
          
          // Skip self-referrals
          if (friend.id === data.referrer.id) {
            console.log(`   ⚠️  Skipping self-referral: ${friend.name} used their own code`)
            continue
          }
          
          missingRewards.push({
            friend: {
              id: friend.id,
              name: friend.name,
              email: friend.email,
              code: friend.code,
              paymentCompletedAt: friend.paymentCompletedAt
            },
            referrer: {
              id: data.referrer.id,
              name: data.referrer.name,
              email: data.referrer.email,
              code: data.referrer.code,
              totalReferrals: data.referrer.totalReferrals,
              totalRewards: data.referrer.totalRewards,
              giftCardId: data.referrer.giftCardId,
              expectedReferrals: friendsCompleted
            }
          })
        }
      }
    }
    
    console.log(`\n⚠️  Found ${missingRewards.length} likely missing referrer rewards:\n`)
    console.log('='.repeat(80))
    
    missingRewards.forEach((item, idx) => {
      console.log(`\n${idx + 1}. ${item.friend.name} → ${item.referrer.name} (${item.referrer.code})`)
      console.log(`   Friend: ${item.friend.id}`)
      console.log(`   Friend email: ${item.friend.email || 'N/A'}`)
      console.log(`   Friend payment completed: ${item.friend.paymentCompletedAt}`)
      console.log(`   Referrer: ${item.referrer.id}`)
      console.log(`   Referrer email: ${item.referrer.email || 'N/A'}`)
      console.log(`   Referrer stats: ${item.referrer.totalReferrals} referrals, $${((item.referrer.totalRewards || 0) / 100).toFixed(2)} rewards`)
      console.log(`   Expected referrals: ${item.referrer.expectedReferrals}`)
      console.log(`   Referrer gift card: ${item.referrer.giftCardId || 'N/A'}`)
      console.log(`   Status: ${item.referrer.giftCardId ? 'Has card, may need to load $10' : 'No card, needs new $10 card'}`)
    })
    
    console.log(`\n${'='.repeat(80)}`)
    console.log(`\n📋 Summary:`)
    console.log(`   Total customers with completed payments: ${customersWithMissingRewards.length}`)
    console.log(`   Likely missing rewards: ${missingRewards.length}`)
    
    // Also show statistics
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT friend.square_customer_id) as total_friends_with_codes,
        COUNT(DISTINCT referrer.square_customer_id) as total_referrers_affected,
        SUM(CASE WHEN friend.first_payment_completed = TRUE THEN 1 ELSE 0 END) as friends_completed_payment
      FROM square_existing_clients friend
      INNER JOIN square_existing_clients referrer
        ON UPPER(TRIM(friend.used_referral_code)) = UPPER(TRIM(referrer.personal_code))
      WHERE friend.used_referral_code IS NOT NULL
        AND friend.used_referral_code != ''
        AND referrer.activated_as_referrer = TRUE
    `
    
    if (stats && stats.length > 0) {
      const s = stats[0]
      console.log(`\n📊 Overall Statistics:`)
      console.log(`   Total friends who used referral codes: ${s.total_friends_with_codes || 0}`)
      console.log(`   Friends who completed first payment: ${s.friends_completed_payment || 0}`)
      console.log(`   Total referrers affected: ${s.total_referrers_affected || 0}`)
    }
    
    return missingRewards
    
  } catch (error) {
    console.error('\n❌ Error finding missing referrer rewards:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  findMissingReferrerRewards()
    .then(rewards => {
      if (rewards && rewards.length > 0) {
        console.log(`\n✅ Analysis complete. Found ${rewards.length} missing rewards.`)
        console.log(`\n💡 Next step: Run scripts/issue-missing-referrer-rewards.js to issue them`)
        process.exit(0)
      } else {
        console.log(`\n✅ Analysis complete. No missing rewards found.`)
        process.exit(0)
      }
    })
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { findMissingReferrerRewards }

