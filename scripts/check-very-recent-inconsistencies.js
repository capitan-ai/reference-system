#!/usr/bin/env node
/**
 * Check for VERY recent data inconsistencies (last hour)
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkVeryRecentInconsistencies() {
  console.log('🔍 Checking for VERY recent data inconsistencies (last hour)...\n')
  
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  
  // Check for customers with got_signup_bonus=true but used_referral_code=null updated in last hour
  const recentInconsistencies = await prisma.$queryRaw`
    SELECT 
      square_customer_id,
      given_name,
      family_name,
      email_address,
      phone_number,
      got_signup_bonus,
      used_referral_code,
      gift_card_id,
      personal_code,
      activated_as_referrer,
      first_payment_completed,
      created_at,
      updated_at
    FROM square_existing_clients
    WHERE got_signup_bonus = TRUE
      AND (used_referral_code IS NULL OR used_referral_code = '')
      AND gift_card_id IS NOT NULL
      AND updated_at >= ${oneHourAgo}
    ORDER BY updated_at DESC
    LIMIT 20
  `
  
  console.log(`📊 Found ${recentInconsistencies.length} inconsistent record(s) updated in last hour:\n`)
  
  if (recentInconsistencies.length === 0) {
    console.log('✅ No new inconsistencies found in the last hour!')
    console.log('   This suggests the fixes are working correctly.\n')
  } else {
    for (const customer of recentInconsistencies) {
      console.log(`   Customer: ${customer.given_name} ${customer.family_name}`)
      console.log(`   Phone: ${customer.phone_number}`)
      console.log(`   Customer ID: ${customer.square_customer_id}`)
      console.log(`   Gift Card ID: ${customer.gift_card_id}`)
      console.log(`   First Payment Completed: ${customer.first_payment_completed}`)
      console.log(`   Updated At: ${customer.updated_at}`)
      console.log('')
    }
  }
  
  // Also check for any customers updated in the last hour with got_signup_bonus=true
  const recentSignupBonuses = await prisma.$queryRaw`
    SELECT 
      square_customer_id,
      given_name,
      family_name,
      got_signup_bonus,
      used_referral_code,
      first_payment_completed,
      gift_card_id,
      updated_at
    FROM square_existing_clients
    WHERE got_signup_bonus = TRUE
      AND updated_at >= ${oneHourAgo}
    ORDER BY updated_at DESC
    LIMIT 20
  `
  
  console.log(`\n📊 Found ${recentSignupBonuses.length} customer(s) with got_signup_bonus=true updated in last hour:\n`)
  
  if (recentSignupBonuses.length > 0) {
    for (const customer of recentSignupBonuses) {
      const isInconsistent = !customer.used_referral_code || customer.used_referral_code === ''
      const status = isInconsistent ? '❌ INCONSISTENT' : '✅ OK'
      console.log(`   ${status} Customer: ${customer.given_name} ${customer.family_name}`)
      console.log(`      Customer ID: ${customer.square_customer_id}`)
      console.log(`      Used Referral Code: ${customer.used_referral_code || 'NULL'}`)
      console.log(`      First Payment Completed: ${customer.first_payment_completed}`)
      console.log(`      Updated At: ${customer.updated_at}`)
      console.log('')
    }
  } else {
    console.log('   No customers with got_signup_bonus=true were updated in the last hour.')
  }
  
  await prisma.$disconnect()
}

checkVeryRecentInconsistencies().catch(console.error)



