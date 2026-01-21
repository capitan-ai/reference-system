#!/usr/bin/env node
/**
 * Analyze referral statistics:
 * - Total customers who used referral codes
 * - How many tried to use their own code (self-referrals)
 * - Completion rates, etc.
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function analyzeReferralStatistics() {
  console.log('📊 Analyzing Referral Statistics\n')
  console.log('='.repeat(80))
  
  try {
    // 1. Total customers who used referral codes
    const totalWithCodes = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
    `
    const totalCustomersWithCodes = parseInt(totalWithCodes[0]?.count || 0)
    
    // 2. Customers who completed first payment
    const completedPayments = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
        AND first_payment_completed = TRUE
    `
    const totalCompletedPayments = parseInt(completedPayments[0]?.count || 0)
    
    // 3. Self-referrals (customers who used their own code)
    const selfReferrals = await prisma.$queryRaw`
      SELECT 
        customer.square_customer_id,
        customer.given_name,
        customer.family_name,
        customer.email_address,
        customer.used_referral_code,
        customer.personal_code,
        customer.first_payment_completed,
        customer.got_signup_bonus,
        customer.created_at,
        customer.updated_at
      FROM square_existing_clients customer
      WHERE customer.used_referral_code IS NOT NULL
        AND customer.used_referral_code != ''
        AND UPPER(TRIM(customer.used_referral_code)) = UPPER(TRIM(customer.personal_code))
    `
    
    const selfReferralCount = selfReferrals.length
    
    // 4. Self-referrals who completed payment
    const selfReferralsCompleted = selfReferrals.filter(c => c.first_payment_completed).length
    
    // 5. Self-referrals who got signup bonus
    const selfReferralsWithBonus = selfReferrals.filter(c => c.got_signup_bonus).length
    
    // 6. Total unique referrers (activated)
    const totalReferrers = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE activated_as_referrer = TRUE
    `
    const totalActivatedReferrers = parseInt(totalReferrers[0]?.count || 0)
    
    // 7. Total referrals given (sum of all total_referrals)
    const totalReferralsGiven = await prisma.$queryRaw`
      SELECT SUM(COALESCE(total_referrals, 0)) as total
      FROM square_existing_clients
      WHERE activated_as_referrer = TRUE
    `
    const sumReferrals = parseInt(totalReferralsGiven[0]?.total || 0)
    
    // 8. Total rewards given (sum of all total_rewards)
    const totalRewardsGiven = await prisma.$queryRaw`
      SELECT SUM(COALESCE(total_rewards, 0)) as total
      FROM square_existing_clients
      WHERE activated_as_referrer = TRUE
    `
    const sumRewards = parseInt(totalRewardsGiven[0]?.total || 0)
    
    // 9. Valid referrals (excluding self-referrals)
    const validReferrals = totalCustomersWithCodes - selfReferralCount
    
    // 10. Valid completed payments (excluding self-referrals)
    const validCompletedPayments = totalCompletedPayments - selfReferralsCompleted
    
    console.log('\n📈 OVERALL STATISTICS:\n')
    console.log('='.repeat(80))
    console.log(`Total customers who used referral codes: ${totalCustomersWithCodes}`)
    console.log(`  ├─ Completed first payment: ${totalCompletedPayments} (${((totalCompletedPayments / totalCustomersWithCodes) * 100).toFixed(1)}%)`)
    console.log(`  └─ Pending payment: ${totalCustomersWithCodes - totalCompletedPayments}`)
    
    console.log(`\n✅ VALID REFERRALS (excluding self-referrals):`)
    console.log(`  Total valid customers: ${validReferrals}`)
    console.log(`  ├─ Completed first payment: ${validCompletedPayments} (${validReferrals > 0 ? ((validCompletedPayments / validReferrals) * 100).toFixed(1) : 0}%)`)
    console.log(`  └─ Pending payment: ${validReferrals - validCompletedPayments}`)
    
    console.log(`\n⚠️  SELF-REFERRALS (customers using their own code):`)
    console.log(`  Total self-referrals: ${selfReferralCount} (${totalCustomersWithCodes > 0 ? ((selfReferralCount / totalCustomersWithCodes) * 100).toFixed(1) : 0}%)`)
    console.log(`  ├─ Completed payment: ${selfReferralsCompleted}`)
    console.log(`  ├─ Got signup bonus: ${selfReferralsWithBonus}`)
    console.log(`  └─ Should be blocked: ${selfReferralsWithBonus > 0 ? '⚠️ YES - Some got bonus!' : '✅ No bonus given'}`)
    
    console.log(`\n🎯 REFERRER STATISTICS:`)
    console.log(`  Total activated referrers: ${totalActivatedReferrers}`)
    console.log(`  Total referrals given: ${sumReferrals}`)
    console.log(`  Total rewards given: $${(sumRewards / 100).toFixed(2)}`)
    console.log(`  Average referrals per referrer: ${totalActivatedReferrers > 0 ? (sumReferrals / totalActivatedReferrers).toFixed(2) : 0}`)
    
    // Show self-referral details
    if (selfReferralCount > 0) {
      console.log(`\n${'='.repeat(80)}`)
      console.log(`\n📋 SELF-REFERRAL DETAILS:\n`)
      
      selfReferrals.forEach((customer, idx) => {
        const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim()
        console.log(`${idx + 1}. ${name || 'Unknown'}`)
        console.log(`   Customer ID: ${customer.square_customer_id}`)
        console.log(`   Email: ${customer.email_address || 'N/A'}`)
        console.log(`   Used code: ${customer.used_referral_code}`)
        console.log(`   Personal code: ${customer.personal_code || 'N/A'}`)
        console.log(`   First payment: ${customer.first_payment_completed ? '✅ Completed' : '❌ Not completed'}`)
        console.log(`   Got signup bonus: ${customer.got_signup_bonus ? '⚠️ YES (should be blocked!)' : '✅ No'}`)
        console.log(`   Created: ${customer.created_at}`)
        console.log(`   Updated: ${customer.updated_at}`)
        console.log('')
      })
    }
    
    // Additional analysis: Referrers with most referrals
    console.log(`\n${'='.repeat(80)}`)
    console.log(`\n🏆 TOP REFERRERS:\n`)
    
    const topReferrers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code,
        total_referrals,
        total_rewards,
        activated_as_referrer
      FROM square_existing_clients
      WHERE activated_as_referrer = TRUE
        AND total_referrals > 0
      ORDER BY total_referrals DESC, total_rewards DESC
      LIMIT 10
    `
    
    if (topReferrers && topReferrers.length > 0) {
      topReferrers.forEach((referrer, idx) => {
        const name = `${referrer.given_name || ''} ${referrer.family_name || ''}`.trim()
        console.log(`${idx + 1}. ${name || 'Unknown'} (${referrer.personal_code || 'N/A'})`)
        console.log(`   Referrals: ${referrer.total_referrals || 0}`)
        console.log(`   Rewards: $${((referrer.total_rewards || 0) / 100).toFixed(2)}`)
        console.log('')
      })
    } else {
      console.log('No referrers with referrals yet.')
    }
    
    console.log(`\n${'='.repeat(80)}`)
    console.log('\n✅ Analysis complete\n')
    
    return {
      totalCustomersWithCodes,
      totalCompletedPayments,
      selfReferralCount,
      selfReferralsCompleted,
      selfReferralsWithBonus,
      validReferrals,
      validCompletedPayments,
      totalActivatedReferrers,
      sumReferrals,
      sumRewards
    }
    
  } catch (error) {
    console.error('\n❌ Error analyzing referral statistics:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  analyzeReferralStatistics()
    .then((stats) => {
      console.log('\n📊 Summary:')
      console.log(`   Real customers (with codes): ${stats.totalCustomersWithCodes}`)
      console.log(`   Self-referrals: ${stats.selfReferralCount}`)
      console.log(`   Valid referrals: ${stats.validReferrals}`)
      process.exit(0)
    })
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { analyzeReferralStatistics }



