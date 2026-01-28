#!/usr/bin/env node
/**
 * Check a specific customer's state
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkCustomer(customerId) {
  console.log(`🔍 Checking customer: ${customerId}\n`)
  
  const customer = await prisma.$queryRaw`
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
    WHERE square_customer_id = ${customerId}
    LIMIT 1
  `
  
  if (!customer || customer.length === 0) {
    console.log('❌ Customer not found')
    await prisma.$disconnect()
    return
  }
  
  const c = customer[0]
  console.log(`✅ Customer: ${c.given_name} ${c.family_name}`)
  console.log(`   Phone: ${c.phone_number}`)
  console.log(`   Email: ${c.email_address || 'N/A'}`)
  console.log(`   Personal Code: ${c.personal_code || 'N/A'}`)
  console.log(`   Used Referral Code: ${c.used_referral_code || 'NULL'}`)
  console.log(`   Got Signup Bonus: ${c.got_signup_bonus || false}`)
  console.log(`   Gift Card ID: ${c.gift_card_id || 'N/A'}`)
  console.log(`   First Payment Completed: ${c.first_payment_completed || false}`)
  console.log(`   Activated as Referrer: ${c.activated_as_referrer || false}`)
  console.log(`   Created At: ${c.created_at}`)
  console.log(`   Updated At: ${c.updated_at}`)
  console.log('')
  
  // Check if this is inconsistent
  const isInconsistent = c.got_signup_bonus && (!c.used_referral_code || c.used_referral_code === '')
  const shouldNotHaveBonus = c.first_payment_completed || c.personal_code || c.activated_as_referrer
  
  console.log(`📋 Analysis:`)
  console.log(`   Is Inconsistent: ${isInconsistent ? '❌ YES' : '✅ NO'}`)
  console.log(`   Should NOT Have Bonus: ${shouldNotHaveBonus ? '❌ YES' : '✅ NO'}`)
  console.log('')
  
  await prisma.$disconnect()
}

const customerId = process.argv[2]
if (!customerId) {
  console.error('Usage: node scripts/check-specific-customer.js <customer_id>')
  process.exit(1)
}

checkCustomer(customerId).catch(console.error)



