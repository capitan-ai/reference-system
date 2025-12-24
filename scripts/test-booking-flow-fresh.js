#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})

const customersApi = squareClient.customersApi
const giftCardsApi = squareClient.giftCardsApi
const customerCustomAttributesApi = squareClient.customerCustomAttributesApi

async function simulateBookingCreatedWebhook(customerId) {
  console.log('🧪 Simulating booking.created webhook')
  console.log('=' .repeat(60))
  console.log(`Customer ID: ${customerId}`)
  console.log('')
  
  try {
    // Step 1: Check if customer exists
    console.log('📋 Step 1: Check if customer exists in database...')
    let customerExists = await prisma.$queryRaw`
      SELECT square_customer_id, got_signup_bonus, used_referral_code, email_address,
             given_name, family_name, gift_card_id
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    if (!customerExists || customerExists.length === 0) {
      console.log('   ℹ️ Customer not in database - fetching from Square...')
      const response = await customersApi.retrieveCustomer(customerId)
      const squareCustomer = response.result.customer
      
      await prisma.$executeRaw`
        INSERT INTO square_existing_clients (
          square_customer_id, given_name, family_name, email_address, phone_number,
          got_signup_bonus, activated_as_referrer, personal_code, gift_card_id,
          used_referral_code, first_ip_address, ip_addresses, referral_email_sent,
          created_at, updated_at
        ) VALUES (
          ${customerId}, ${squareCustomer.givenName || null}, ${squareCustomer.familyName || null},
          ${squareCustomer.emailAddress || null}, ${squareCustomer.phoneNumber || null},
          FALSE, FALSE, NULL, NULL, NULL, 'test', ARRAY['test'], FALSE, NOW(), NOW()
        )
        ON CONFLICT (square_customer_id) DO NOTHING
      `
      
      customerExists = await prisma.$queryRaw`
        SELECT square_customer_id, got_signup_bonus, used_referral_code, email_address,
               given_name, family_name, gift_card_id
        FROM square_existing_clients 
        WHERE square_customer_id = ${customerId}
      `
      console.log('   ✅ Customer added to database')
    }
    
    const customer = customerExists[0]
    console.log(`   ✅ Customer: ${customer.given_name || 'Unknown'} ${customer.family_name || ''}`)
    console.log(`   - Has signup bonus: ${customer.got_signup_bonus}`)
    console.log(`   - Used referral code: ${customer.used_referral_code || 'None'}`)
    console.log('')
    
    if (customer.got_signup_bonus) {
      console.log('   ⚠️ Customer already received signup bonus - skipping')
      console.log('   ℹ️ This is expected behavior for repeat customers')
      return
    }
    
    console.log('📋 Step 2: Get custom attributes from Square...')
    const attributesResponse = await customerCustomAttributesApi.listCustomerCustomAttributes(customerId)
    const attributes = attributesResponse.result
    
    if (!attributes || !attributes.customAttributes) {
      console.log('   ⚠️ No custom attributes found')
      return
    }
    
    console.log(`   📋 Found ${attributes.customAttributes.length} custom attribute(s):`)
    const attrMap = {}
    attributes.customAttributes.forEach(attr => {
      attrMap[attr.key] = attr.value
      console.log(`      - ${attr.key}: "${attr.value}"`)
    })
    console.log('')
    
    // Step 3: Find referral code
    console.log('📋 Step 3: Searching for referral code...')
    let referralCode = null
    
    // Check for referral_code key
    if (attrMap['referral_code']) {
      console.log(`   🎯 Found 'referral_code' key: "${attrMap['referral_code']}"`)
      referralCode = attrMap['referral_code']
    }
    
    // Check all values
    if (!referralCode) {
      for (const [key, value] of Object.entries(attrMap)) {
        if (typeof value === 'string' && value.length > 0 && value.length <= 20) {
          console.log(`   🔍 Checking value: "${value}" (key: ${key})`)
          
          const referrer = await prisma.$queryRaw`
            SELECT square_customer_id, given_name, family_name, personal_code
            FROM square_existing_clients 
            WHERE UPPER(TRIM(personal_code)) = UPPER(TRIM(${value}))
            LIMIT 1
          `
          
          if (referrer && referrer.length > 0) {
            referralCode = value
            console.log(`   ✅ Found referral code: "${referralCode}"`)
            console.log(`   ✅ Referrer: ${referrer[0].given_name} ${referrer[0].family_name}`)
            break
          }
        }
      }
    }
    
    console.log('')
    
    // Step 4: Process gift card
    if (referralCode) {
      console.log('📋 Step 4: Processing referral code gift card...')
      
      const referrer = (await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, personal_code, gift_card_id
        FROM square_existing_clients 
        WHERE UPPER(TRIM(personal_code)) = UPPER(TRIM(${referralCode}))
        LIMIT 1
      `)[0]
      
      if (!referrer) {
        console.log('   ❌ Referrer not found in database')
        return
      }
      
      console.log(`   👤 Referrer: ${referrer.given_name} ${referrer.family_name}`)
      console.log(`   🎁 Creating $10 gift card for friend...`)
      
      const giftCardRequest = {
        idempotencyKey: `test-gift-${customerId}-${Date.now()}`,
        locationId: process.env.SQUARE_LOCATION_ID?.trim(),
        giftCard: {
          type: 'DIGITAL',
          state: 'ACTIVE',
          balanceMoney: { amount: 1000, currency: 'USD' }
        }
      }
      
      const giftCardResponse = await giftCardsApi.createGiftCard(giftCardRequest)
      const giftCardId = giftCardResponse.result.giftCard?.id
      
      if (giftCardId) {
        console.log(`   ✅ Gift card created: ${giftCardId}`)
        
        await prisma.$executeRaw`
          UPDATE square_existing_clients 
          SET 
            got_signup_bonus = TRUE,
            gift_card_id = ${giftCardId},
            used_referral_code = ${referralCode}
          WHERE square_customer_id = ${customerId}
        `
        
        console.log('   ✅ Database updated successfully')
        console.log('')
        console.log('✅ TEST PASSED!')
        console.log(`   Friend (${customer.given_name}) received $10 gift card`)
        console.log(`   Referrer (${referrer.given_name}) will get $10 when friend pays`)
      } else {
        console.log('   ❌ Failed to create gift card')
      }
    } else {
      console.log('📋 Step 4: No referral code found')
      console.log('   ℹ️ Customer booked without referral code')
      console.log('   - Will receive referral code after first payment')
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

const customerId = process.argv[2] || '5XSV6VT86R5CYWCJC4QK7FW0E0'
simulateBookingCreatedWebhook(customerId)

