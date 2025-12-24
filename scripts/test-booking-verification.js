#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

async function verifyBookingFlow(customerId) {
  console.log('🔍 Verifying booking.created webhook flow')
  console.log('=' .repeat(60))
  console.log(`Customer ID: ${customerId}`)
  console.log('')
  
  try {
    // Check database
    console.log('📋 Step 1: Check database...')
    const dbCustomer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, got_signup_bonus, 
             used_referral_code, gift_card_id, first_payment_completed
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    if (dbCustomer && dbCustomer.length > 0) {
      const c = dbCustomer[0]
      console.log(`   ✅ Customer in database:`)
      console.log(`      - Name: ${c.given_name || 'Unknown'} ${c.family_name || ''}`)
      console.log(`      - Has signup bonus: ${c.got_signup_bonus}`)
      console.log(`      - Used referral code: ${c.used_referral_code || 'None'}`)
      console.log(`      - Gift card ID: ${c.gift_card_id || 'None'}`)
      console.log(`      - First payment completed: ${c.first_payment_completed || false}`)
      console.log('')
      
      // If they used a referral code, check the referrer
      if (c.used_referral_code) {
        console.log('📋 Step 2: Checking referrer...')
        const referrer = await prisma.$queryRaw`
          SELECT square_customer_id, given_name, family_name, personal_code, 
                 total_referrals, total_rewards, gift_card_id
          FROM square_existing_clients 
          WHERE personal_code = ${c.used_referral_code}
        `
        
        if (referrer && referrer.length > 0) {
          const r = referrer[0]
          console.log(`   ✅ Referrer found:`)
          console.log(`      - Name: ${r.given_name} ${r.family_name}`)
          console.log(`      - Code: ${r.personal_code}`)
          console.log(`      - Total referrals: ${r.total_referrals || 0}`)
          console.log(`      - Total rewards: $${(r.total_rewards || 0) / 100}`)
          console.log(`      - Gift card ID: ${r.gift_card_id || 'None'}`)
        } else {
          console.log(`   ❌ Referrer with code "${c.used_referral_code}" not found`)
        }
      }
    } else {
      console.log('   ❌ Customer not in database')
    }
    
    console.log('')
    console.log('📋 Step 3: Check Square custom attributes...')
    const attributes = await squareClient.customerCustomAttributesApi.listCustomerCustomAttributes(customerId)
    
    if (attributes.result && attributes.result.customAttributes) {
      console.log(`   📋 Found ${attributes.result.customAttributes.length} custom attribute(s):`)
      attributes.result.customAttributes.forEach(attr => {
        console.log(`      - ${attr.key}: "${attr.value}"`)
      })
      
      // Check if any value matches a referral code
      console.log('')
      console.log('📋 Step 4: Checking if any custom attribute value is a referral code...')
      for (const attr of attributes.result.customAttributes) {
        if (typeof attr.value === 'string' && attr.value.length > 0 && attr.value.length <= 20) {
          const referrer = await prisma.$queryRaw`
            SELECT square_customer_id, given_name, family_name, personal_code
            FROM square_existing_clients 
            WHERE UPPER(TRIM(personal_code)) = UPPER(TRIM(${attr.value}))
            LIMIT 1
          `
          
          if (referrer && referrer.length > 0) {
            console.log(`   ✅ Found referral code: "${attr.value}"`)
            console.log(`      - Key: ${attr.key}`)
            console.log(`      - Referrer: ${referrer[0].given_name} ${referrer[0].family_name}`)
            console.log(`      - Would create gift card for friend`)
            console.log(`      - Referrer would get $10 when friend pays`)
          }
        }
      }
    } else {
      console.log('   ⚠️ No custom attributes found')
    }
    
    console.log('')
    console.log('✅ Verification complete!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

const customerId = process.argv[2] || '5XSV6VT86R5CYWCJC4QK7FW0E0'
verifyBookingFlow(customerId)





