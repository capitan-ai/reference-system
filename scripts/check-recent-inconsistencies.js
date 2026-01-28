#!/usr/bin/env node
/**
 * Check for recent data inconsistencies to understand what happened during reproduction
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkRecentInconsistencies() {
  console.log('🔍 Checking for recent data inconsistencies...\n')
  
  // Check for customers with got_signup_bonus=true but used_referral_code=null
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
      personal_code,
      activated_as_referrer,
      first_payment_completed,
      created_at,
      updated_at
    FROM square_existing_clients
    WHERE got_signup_bonus = TRUE
      AND (used_referral_code IS NULL OR used_referral_code = '')
      AND gift_card_id IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 10
  `
  
  console.log(`📊 Found ${inconsistencies.length} inconsistent record(s):\n`)
  
  if (inconsistencies.length === 0) {
    console.log('✅ No inconsistencies found!')
  } else {
    for (const customer of inconsistencies) {
      console.log(`   Customer: ${customer.given_name} ${customer.family_name}`)
      console.log(`   Phone: ${customer.phone_number}`)
      console.log(`   Customer ID: ${customer.square_customer_id}`)
      console.log(`   Gift Card ID: ${customer.gift_card_id}`)
      console.log(`   Personal Code: ${customer.personal_code || 'N/A'}`)
      console.log(`   Activated as Referrer: ${customer.activated_as_referrer}`)
      console.log(`   First Payment Completed: ${customer.first_payment_completed}`)
      console.log(`   Updated At: ${customer.updated_at}`)
      console.log('')
    }
  }
  
  // Check for self-referrals (customers using their own code)
  const selfReferrals = await prisma.$queryRaw`
    SELECT 
      square_customer_id,
      given_name,
      family_name,
      personal_code,
      used_referral_code,
      got_signup_bonus,
      gift_card_id,
      first_payment_completed,
      updated_at
    FROM square_existing_clients
    WHERE personal_code IS NOT NULL
      AND used_referral_code IS NOT NULL
      AND UPPER(TRIM(personal_code)) = UPPER(TRIM(used_referral_code))
    ORDER BY updated_at DESC
    LIMIT 10
  `
  
  console.log(`\n📊 Found ${selfReferrals.length} self-referral case(s):\n`)
  
  if (selfReferrals.length > 0) {
    for (const customer of selfReferrals) {
      console.log(`   Customer: ${customer.given_name} ${customer.family_name}`)
      console.log(`   Customer ID: ${customer.square_customer_id}`)
      console.log(`   Personal Code: ${customer.personal_code}`)
      console.log(`   Used Referral Code: ${customer.used_referral_code}`)
      console.log(`   Got Signup Bonus: ${customer.got_signup_bonus}`)
      console.log(`   First Payment Completed: ${customer.first_payment_completed}`)
      console.log(`   Updated At: ${customer.updated_at}`)
      console.log('')
    }
  }
  
  // Check for customers who got signup bonus after first payment
  const lateBonuses = await prisma.$queryRaw`
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
      AND first_payment_completed = TRUE
      AND gift_card_id IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 10
  `
  
  console.log(`\n📊 Found ${lateBonuses.length} customer(s) with signup bonus after first payment:\n`)
  
  if (lateBonuses.length > 0) {
    for (const customer of lateBonuses) {
      console.log(`   Customer: ${customer.given_name} ${customer.family_name}`)
      console.log(`   Customer ID: ${customer.square_customer_id}`)
      console.log(`   Used Referral Code: ${customer.used_referral_code || 'N/A'}`)
      console.log(`   Updated At: ${customer.updated_at}`)
      console.log('')
    }
  }
  
  await prisma.$disconnect()
}

checkRecentInconsistencies().catch(console.error)



