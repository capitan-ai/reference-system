#!/usr/bin/env node
/**
 * Check specific customers from recent webhooks for data consistency
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkSpecificCustomers() {
  console.log('🔍 Checking specific customers from recent webhooks...\n')
  
  // Customer IDs from recent webhooks
  const customerIds = [
    'SV2KBSXN8DXK9XNEP6XE7MNDM0',
    '7S3V4QVA5E9WX8EZMWNKZMZRRW',
    'ZPRH0B6SG6S3N93PQVFXXMAPV8',
    '83ZQHJNNF07J7E1RME84RXS1KG',
    '7C5DG7FXV1F470XV0EX4EHJE1W',
    'G8QADD30N7BTWC5XHA67ZHMWQR',
    'WTA4YDAC287BT1AHDSK04HJQS0',
    '0QM3FB1M39C6YTTNCYFDEC3A8M'
  ]
  
  const customers = await prisma.$queryRaw`
    SELECT 
      square_customer_id,
      given_name,
      family_name,
      got_signup_bonus,
      used_referral_code,
      gift_card_id,
      first_payment_completed,
      activated_as_referrer,
      personal_code,
      updated_at
    FROM square_existing_clients
    WHERE square_customer_id = ANY(${customerIds})
    ORDER BY updated_at DESC
  `
  
  console.log(`📊 Found ${customers.length} customer(s) from recent webhooks:\n`)
  
  let inconsistentCount = 0
  for (const customer of customers) {
    const isInconsistent = customer.got_signup_bonus && (!customer.used_referral_code || customer.used_referral_code === '')
    const status = isInconsistent ? '❌ INCONSISTENT' : '✅ OK'
    
    if (isInconsistent) {
      inconsistentCount++
    }
    
    console.log(`   ${status} Customer: ${customer.given_name || 'Unknown'} ${customer.family_name || ''}`)
    console.log(`      Customer ID: ${customer.square_customer_id}`)
    console.log(`      Got Signup Bonus: ${customer.got_signup_bonus || false}`)
    console.log(`      Used Referral Code: ${customer.used_referral_code || 'NULL'}`)
    console.log(`      Gift Card ID: ${customer.gift_card_id || 'NULL'}`)
    console.log(`      First Payment Completed: ${customer.first_payment_completed || false}`)
    console.log(`      Personal Code: ${customer.personal_code || 'NULL'}`)
    console.log(`      Updated At: ${customer.updated_at}`)
    console.log('')
  }
  
  if (inconsistentCount === 0) {
    console.log('✅ All customers from recent webhooks have consistent data!')
    console.log('   This suggests the fixes are working correctly.\n')
  } else {
    console.log(`⚠️ Found ${inconsistentCount} customer(s) with inconsistent data.\n`)
  }
  
  await prisma.$disconnect()
}

checkSpecificCustomers().catch(console.error)



