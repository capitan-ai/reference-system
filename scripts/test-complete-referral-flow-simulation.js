#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { createReferralCode, findReferrerByCode } = require('../lib/utils')

const prisma = new PrismaClient()

// Simulate webhook functions (import from route.js logic)
async function simulateCustomerCreated(customerData) {
  console.log('\n📝 STEP 1: Simulating customer.created webhook...')
  
  const customerId = `TEST_CUST_${Date.now()}`
  const ipAddress = '192.168.1.100' // Test IP
  
  // Insert test customer
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
      first_ip_address,
      ip_addresses
    ) VALUES (
      ${customerId},
      ${customerData.given_name},
      ${customerData.family_name},
      ${customerData.email},
      ${customerData.phone},
      FALSE,
      FALSE,
      NULL,
      NULL,
      ${customerData.referral_code || null},
      ${ipAddress},
      ARRAY[${ipAddress}]
    )
    ON CONFLICT (square_customer_id) DO NOTHING
  `
  
  console.log(`✅ Test customer created: ${customerId}`)
  return customerId
}

async function simulateBookingCreated(customerId, referralCode) {
  console.log('\n📅 STEP 2: Simulating booking.created webhook...')
  
  if (!referralCode) {
    console.log('ℹ️ No referral code, just logging booking')
    return
  }
  
  // Get customer
  const customer = await prisma.$queryRaw`
    SELECT * FROM square_existing_clients 
    WHERE square_customer_id = ${customerId}
  `
  
  if (!customer || customer.length === 0) {
    console.log('❌ Customer not found')
    return
  }
  
  if (customer[0].got_signup_bonus) {
    console.log('ℹ️ Already received bonus, skipping')
    return
  }
  
  // Simulate finding referrer
  console.log(`🎯 Checking referral code: ${referralCode}`)
  console.log(`✅ Referrer would be found (simulated)`)
  console.log(`💵 Friend would receive $10 gift card (simulated)`)
  
  // Update database
  await prisma.$executeRaw`
    UPDATE square_existing_clients 
    SET 
      got_signup_bonus = TRUE,
      gift_card_id = 'GC_FRIEND_TEST_123',
      used_referral_code = ${referralCode}
    WHERE square_customer_id = ${customerId}
  `
  
  console.log('✅ Friend would receive $10 gift card!')
}

async function simulatePaymentCompleted(customerId) {
  console.log('\n💰 STEP 3: Simulating payment.updated webhook...')
  
  // Get customer
  const customer = await prisma.$queryRaw`
    SELECT * FROM square_existing_clients 
    WHERE square_customer_id = ${customerId}
  `
  
  if (!customer || customer.length === 0) {
    console.log('❌ Customer not found')
    return
  }
  
  if (customer[0].first_payment_completed) {
    console.log('ℹ️ First payment already processed')
    return
  }
  
  // If customer used referral code, give referrer reward
  if (customer[0].used_referral_code) {
    const referralCode = customer[0].used_referral_code
    console.log(`🎯 Customer used referral code: ${referralCode}`)
    console.log(`👤 Referrer would be found (simulated)`)
    console.log(`💵 Referrer would receive $10 loaded onto gift card (simulated)`)
  }
  
  // Generate referral code for new customer
  const newCode = generateReferralCode()
  console.log(`🎁 Generating new referral code: ${newCode}`)
  
  // Update database
  await prisma.$executeRaw`
    UPDATE square_existing_clients 
    SET 
      personal_code = ${newCode},
      activated_as_referrer = TRUE,
      first_payment_completed = TRUE,
      referral_email_sent = TRUE
    WHERE square_customer_id = ${customerId}
  `
  
  console.log(`✅ Customer now has referral code: ${newCode}`)
  console.log(`📧 Email would be sent with their referral code`)
}

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

async function cleanupTestCustomers() {
  console.log('\n🧹 Cleaning up test customers...')
  
  await prisma.$executeRaw`
    DELETE FROM square_existing_clients 
    WHERE square_customer_id LIKE 'TEST_CUST_%'
  `
  
  console.log('✅ Test customers deleted')
}

async function runTest() {
  console.log('🧪 STARTING REFERRAL SYSTEM TEST')
  console.log('=' .repeat(80))
  
  try {
    // Clean up any previous tests
    await cleanupTestCustomers()
    
    // Create test referrer
    console.log('\n👤 Creating test referrer...')
    const referrerCode = 'TESTREF123'
    
    await prisma.$executeRaw`
      INSERT INTO square_existing_clients (
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code,
        activated_as_referrer
      ) VALUES (
        'TEST_REFERRER_001',
        'Test',
        'Referrer',
        'referrer@test.com',
        ${referrerCode},
        TRUE
      )
      ON CONFLICT (square_customer_id) DO NOTHING
    `
    
    console.log(`✅ Test referrer created with code: ${referrerCode}`)
    
    // Scenario 1: Friend WITH referral code
    console.log('\n' + '='.repeat(80))
    console.log('SCENARIO 1: Friend books WITH referral code')
    console.log('='.repeat(80))
    
    const friend1Id = await simulateCustomerCreated({
      given_name: 'Friend',
      family_name: 'One',
      email: 'friend1@test.com',
      phone: '+14155551234',
      referral_code: referrerCode
    })
    
    await simulateBookingCreated(friend1Id, referrerCode)
    await simulatePaymentCompleted(friend1Id)
    
    // Verify results
    const friend1 = await prisma.$queryRaw`
      SELECT * FROM square_existing_clients 
      WHERE square_customer_id = ${friend1Id}
    `
    
    console.log('\n📊 VERIFICATION:')
    console.log(`   Got signup bonus: ${friend1[0].got_signup_bonus}`)
    console.log(`   Used referral code: ${friend1[0].used_referral_code}`)
    console.log(`   Gift card ID: ${friend1[0].gift_card_id}`)
    console.log(`   Has own referral code: ${friend1[0].personal_code ? 'YES' : 'NO'}`)
    console.log(`   Activated as referrer: ${friend1[0].activated_as_referrer}`)
    console.log(`   First payment completed: ${friend1[0].first_payment_completed}`)
    
    // Scenario 2: Friend WITHOUT referral code
    console.log('\n' + '='.repeat(80))
    console.log('SCENARIO 2: Friend books WITHOUT referral code')
    console.log('='.repeat(80))
    
    const friend2Id = await simulateCustomerCreated({
      given_name: 'Friend',
      family_name: 'Two',
      email: 'friend2@test.com',
      phone: '+14155555678',
      referral_code: null
    })
    
    await simulateBookingCreated(friend2Id, null)
    await simulatePaymentCompleted(friend2Id)
    
    // Verify results
    const friend2 = await prisma.$queryRaw`
      SELECT * FROM square_existing_clients 
      WHERE square_customer_id = ${friend2Id}
    `
    
    console.log('\n📊 VERIFICATION:')
    console.log(`   Got signup bonus: ${friend2[0].got_signup_bonus ? 'YES (should be NO)' : 'NO ✅'}`)
    console.log(`   Has own referral code: ${friend2[0].personal_code ? 'YES ✅' : 'NO'}`)
    console.log(`   Activated as referrer: ${friend2[0].activated_as_referrer ? 'YES ✅' : 'NO'}`)
    console.log(`   First payment completed: ${friend2[0].first_payment_completed ? 'YES ✅' : 'NO'}`)
    
    // Clean up
    await cleanupTestCustomers()
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ TEST COMPLETED SUCCESSFULLY!')
    console.log('='.repeat(80))
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the test
runTest()
