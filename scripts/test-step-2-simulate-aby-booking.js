#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// Simulate the booking.created webhook for Aby
async function simulateAbyBooking() {
  try {
    console.log('🧪 Simulating Aby\'s Booking with Referral Code')
    console.log('=' .repeat(80))
    
    // First, let's manually add Aby as a customer
    console.log('\n📍 Adding Aby to database...')
    
    const abyCustomerId = `ABY_TEST_${Date.now()}`
    const referralCode = 'CUST_MHA4LEYB5ERA' // Umi's code
    
    await prisma.$executeRaw`
      INSERT INTO square_existing_clients (
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        got_signup_bonus,
        activated_as_referrer,
        personal_code,
        gift_card_id,
        used_referral_code,
        created_at,
        updated_at
      ) VALUES (
        ${abyCustomerId},
        'Aby',
        'Test',
        'aby.test@example.com',
        '+14155559999',
        FALSE,
        FALSE,
        NULL,
        NULL,
        ${referralCode},
        NOW(),
        NOW()
      )
    `
    
    console.log('✅ Aby added to database')
    
    // Now simulate the booking logic
    console.log('\n📅 Simulating booking.created webhook...')
    
    // Get customer
    const customer = await prisma.$queryRaw`
      SELECT * FROM square_existing_clients 
      WHERE square_customer_id = ${abyCustomerId}
    `
    
    if (!customer || customer.length === 0) {
      console.log('❌ Customer not found')
      return
    }
    
    const aby = customer[0]
    
    console.log(`🎉 First booking detected for: ${aby.given_name} ${aby.family_name}`)
    console.log(`   Used referral code: ${aby.used_referral_code}`)
    
    // Find referrer
    console.log(`\n🔍 Looking up referrer for code: ${referralCode}`)
    
    const referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, 
             personal_code, gift_card_id
      FROM square_existing_clients 
      WHERE personal_code = ${referralCode}
      LIMIT 1
    `
    
    if (!referrer || referrer.length === 0) {
      console.log('❌ Referrer not found')
      return
    }
    
    const umi = referrer[0]
    console.log(`✅ Found referrer: ${umi.given_name} ${umi.family_name}`)
    
    // Simulate creating gift card
    console.log('\n💵 Simulating $10 gift card creation for Aby...')
    const friendGiftCardId = `GC_FRIEND_TEST_${Date.now()}`
    
    console.log(`✅ Would create gift card: ${friendGiftCardId}`)
    
    // Update database
    await prisma.$executeRaw`
      UPDATE square_existing_clients 
      SET 
        got_signup_bonus = TRUE,
        gift_card_id = ${friendGiftCardId}
      WHERE square_customer_id = ${abyCustomerId}
    `
    
    console.log('✅ Aby\'s record updated with gift card')
    
    console.log('\n' + '=' .repeat(80))
    console.log('📋 STEP 2 COMPLETE - SIMULATED')
    console.log('=' .repeat(80))
    console.log(`   Friend: ${aby.given_name} ${aby.family_name}`)
    console.log(`   Used Code: ${aby.used_referral_code}`)
    console.log(`   Gift Card: ${friendGiftCardId}`)
    console.log(`   Got $10: YES ✅`)
    console.log('=' .repeat(80))
    
    console.log('\n📝 NEXT STEP:')
    console.log('   - Aby should now use the $10 gift card to pay')
    console.log('   - After payment, run Step 3 to check Umi\'s reward')
    console.log('   - Run: node scripts/test-step-3-check-payment.js')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

simulateAbyBooking()
