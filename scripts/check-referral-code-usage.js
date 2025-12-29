#!/usr/bin/env node
/**
 * Check if any referral codes have been used
 * Checks multiple sources:
 * - RefMatch (matched referral codes with bookings)
 * - RefClick (clicks on referral links)
 * - square_existing_clients.used_referral_code
 * - RefReward (rewards given for referrals)
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkReferralCodeUsage() {
  console.log('🔍 Checking Referral Code Usage\n')
  
  try {
    // 1. Check RefMatch table (matched referral codes)
    console.log('1️⃣ Referral Code Matches (RefMatch):')
    const refMatches = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(DISTINCT "refCode")::int as unique_codes,
        COUNT(DISTINCT "customerId")::int as unique_customers,
        MIN("matchedAt") as first_match,
        MAX("matchedAt") as last_match
      FROM ref_matches
    `
    
    const matchStats = refMatches[0]
    console.log(`   Total matches: ${matchStats.total}`)
    console.log(`   Unique codes used: ${matchStats.unique_codes}`)
    console.log(`   Unique customers: ${matchStats.unique_customers}`)
    
    if (matchStats.total > 0) {
      console.log(`   First match: ${matchStats.first_match}`)
      console.log(`   Last match: ${matchStats.last_match}`)
      
      // Get recent matches
      const recentMatches = await prisma.$queryRaw`
        SELECT 
          "refCode" as ref_code,
          "customerId" as customer_id,
          "bookingId" as booking_id,
          "matchedVia" as matched_via,
          "matchedAt" as matched_at
        FROM ref_matches
        ORDER BY "matchedAt" DESC
        LIMIT 10
      `
      
      console.log(`\n   Recent matches (last 10):`)
      recentMatches.forEach((match, idx) => {
        console.log(`   ${idx + 1}. Code: ${match.ref_code}`)
        console.log(`      Booking: ${match.booking_id}`)
        console.log(`      Customer: ${match.customer_id}`)
        console.log(`      Matched via: ${match.matched_via}`)
        console.log(`      Matched at: ${match.matched_at}`)
      })
    } else {
      console.log('   ❌ No referral code matches found')
    }
    
    // 2. Check RefClick table (clicks on referral links)
    console.log('\n2️⃣ Referral Link Clicks (RefClick):')
    const refClicks = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(DISTINCT "refCode")::int as unique_codes,
        COUNT(DISTINCT "customerId")::int as matched_clicks,
        MIN("firstSeenAt") as first_click,
        MAX("firstSeenAt") as last_click
      FROM ref_clicks
    `
    
    const clickStats = refClicks[0]
    console.log(`   Total clicks: ${clickStats.total}`)
    console.log(`   Unique codes clicked: ${clickStats.unique_codes}`)
    console.log(`   Matched clicks: ${clickStats.matched_clicks}`)
    
    if (clickStats.total > 0) {
      console.log(`   First click: ${clickStats.first_click}`)
      console.log(`   Last click: ${clickStats.last_click}`)
    } else {
      console.log('   ❌ No referral link clicks found')
    }
    
    // 3. Check square_existing_clients.used_referral_code
    console.log('\n3️⃣ Used Referral Codes (square_existing_clients):')
    const usedCodes = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(DISTINCT used_referral_code)::int as unique_codes
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
    `
    
    const usedStats = usedCodes[0]
    console.log(`   Customers with used codes: ${usedStats.total}`)
    console.log(`   Unique codes used: ${usedStats.unique_codes}`)
    
    if (usedStats.total > 0) {
      const recentUsed = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          used_referral_code,
          first_payment_completed,
          created_at
        FROM square_existing_clients
        WHERE used_referral_code IS NOT NULL
          AND used_referral_code != ''
        ORDER BY created_at DESC
        LIMIT 10
      `
      
      console.log(`\n   Recent customers who used codes (last 10):`)
      recentUsed.forEach((customer, idx) => {
        console.log(`   ${idx + 1}. ${customer.given_name || ''} ${customer.family_name || ''}`)
        console.log(`      Customer ID: ${customer.square_customer_id}`)
        console.log(`      Used code: ${customer.used_referral_code}`)
        console.log(`      First payment: ${customer.first_payment_completed ? 'Yes' : 'No'}`)
        console.log(`      Created: ${customer.created_at}`)
      })
    } else {
      console.log('   ❌ No customers found with used referral codes')
    }
    
    // 4. Check RefReward table (rewards given)
    console.log('\n4️⃣ Referral Rewards (RefReward):')
    const rewards = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(DISTINCT "referrerCustomerId")::int as unique_referrers,
        COUNT(DISTINCT "friendCustomerId")::int as unique_friends,
        SUM(amount)::int as total_amount_cents,
        MIN("createdAt") as first_reward,
        MAX("createdAt") as last_reward
      FROM ref_rewards
    `
    
    const rewardStats = rewards[0]
    console.log(`   Total rewards: ${rewardStats.total}`)
    console.log(`   Unique referrers: ${rewardStats.unique_referrers}`)
    console.log(`   Unique friends: ${rewardStats.unique_friends}`)
    console.log(`   Total amount: $${((rewardStats.total_amount_cents || 0) / 100).toFixed(2)}`)
    
    if (rewardStats.total > 0) {
      console.log(`   First reward: ${rewardStats.first_reward}`)
      console.log(`   Last reward: ${rewardStats.last_reward}`)
      
      const recentRewards = await prisma.$queryRaw`
        SELECT 
          id,
          type,
          "referrerCustomerId" as referrer_customer_id,
          "friendCustomerId" as friend_customer_id,
          amount,
          status,
          "createdAt" as created_at
        FROM ref_rewards
        ORDER BY "createdAt" DESC
        LIMIT 10
      `
      
      console.log(`\n   Recent rewards (last 10):`)
      recentRewards.forEach((reward, idx) => {
        console.log(`   ${idx + 1}. ${reward.type}`)
        console.log(`      Referrer: ${reward.referrer_customer_id || 'N/A'}`)
        console.log(`      Friend: ${reward.friend_customer_id || 'N/A'}`)
        console.log(`      Amount: $${(reward.amount / 100).toFixed(2)}`)
        console.log(`      Status: ${reward.status}`)
        console.log(`      Created: ${reward.created_at}`)
      })
    } else {
      console.log('   ❌ No referral rewards found')
    }
    
    // 5. Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    
    const hasUsage = matchStats.total > 0 || clickStats.total > 0 || usedStats.total > 0 || rewardStats.total > 0
    
    if (hasUsage) {
      console.log('✅ Referral codes HAVE been used!')
      console.log(`\n   📊 Statistics:`)
      console.log(`   - Matches: ${matchStats.total}`)
      console.log(`   - Clicks: ${clickStats.total}`)
      console.log(`   - Customers with used codes: ${usedStats.total}`)
      console.log(`   - Rewards given: ${rewardStats.total} ($${((rewardStats.total_amount_cents || 0) / 100).toFixed(2)})`)
    } else {
      console.log('❌ NO referral codes have been used yet')
      console.log('\n   💡 This could mean:')
      console.log('   - No one has clicked referral links')
      console.log('   - No one has entered referral codes during booking')
      console.log('   - Referral codes are not being captured from Square webhooks')
      console.log('   - Jobs are still queued and not processed yet')
    }
    
  } catch (error) {
    console.error('\n❌ Error checking referral code usage:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkReferralCodeUsage()
