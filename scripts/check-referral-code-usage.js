#!/usr/bin/env node
/**
 * Check if any referral codes have been used
 * Checks multiple sources:
 * - RefClick (clicks on referral links)
 * - square_existing_clients.used_referral_code
 * - square_existing_clients.total_rewards (rewards given for referrals)
 * 
 * Note: RefMatch and RefReward tables have been removed
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkReferralCodeUsage() {
  console.log('🔍 Checking Referral Code Usage\n')
  
  try {
    // Note: RefMatch and RefReward tables have been removed
    // Referral matching is now tracked via square_existing_clients.used_referral_code
    // Rewards are tracked via square_existing_clients.total_rewards
    
    // 1. Check RefClick table (clicks on referral links)
    console.log('\n1️⃣ Referral Link Clicks (RefClick):')
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
    
    // 2. Check square_existing_clients.used_referral_code
    console.log('\n2️⃣ Used Referral Codes (square_existing_clients):')
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
    
    // 4. Check rewards from square_existing_clients (rewards are tracked here now)
    console.log('\n4️⃣ Referral Rewards (from square_existing_clients):')
    const rewardsStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as customers_with_rewards,
        SUM(total_rewards)::int as total_rewards_count,
        SUM(total_referrals)::int as total_referrals_count
      FROM square_existing_clients
      WHERE total_rewards > 0 OR total_referrals > 0
    `
    
    const rewardStats = rewardsStats[0]
    console.log(`   Customers with rewards: ${rewardStats.customers_with_rewards || 0}`)
    console.log(`   Total rewards given: ${rewardStats.total_rewards_count || 0}`)
    console.log(`   Total referrals: ${rewardStats.total_referrals_count || 0}`)
    
    // 5. Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    
    const hasUsage = clickStats.total > 0 || usedStats.total > 0
    
    if (hasUsage) {
      console.log('✅ Referral codes HAVE been used!')
      console.log(`\n   📊 Statistics:`)
      console.log(`   - Clicks: ${clickStats.total}`)
      console.log(`   - Customers with used codes: ${usedStats.total}`)
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
