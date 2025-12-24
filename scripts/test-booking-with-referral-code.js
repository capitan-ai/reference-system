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

// Import the functions from the webhook handler
async function getCustomerCustomAttributes(customerId) {
  try {
    console.log(`   Fetching custom attributes for customer ${customerId}...`)
    const response = await customerCustomAttributesApi.listCustomerCustomAttributes(customerId)
    
    if (response.result && response.result.customAttributes) {
      const attributes = {}
      response.result.customAttributes.forEach(attr => {
        attributes[attr.key] = attr.value
        console.log(`   📋 Custom attribute: key="${attr.key}", value="${attr.value}"`)
      })
      return attributes
    }
    return {}
  } catch (error) {
    console.error(`Error getting custom attributes:`, error.message)
    return {}
  }
}

async function findReferrerByCode(referralCode) {
  try {
    if (!referralCode || typeof referralCode !== 'string') {
      return null
    }
    
    const normalizedCode = referralCode.trim().toUpperCase()
    console.log(`   🔍 Looking up referral code in database: "${normalizedCode}"`)
    
    let referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code, gift_card_id
      FROM square_existing_clients 
      WHERE UPPER(TRIM(personal_code)) = ${normalizedCode}
      LIMIT 1
    `
    
    if (referrer && referrer.length > 0) {
      console.log(`   ✅ Found referrer: ${referrer[0].given_name} ${referrer[0].family_name}`)
      return referrer[0]
    }
    
    referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code, gift_card_id
      FROM square_existing_clients 
      WHERE personal_code = ${referralCode}
      LIMIT 1
    `
    
    if (referrer && referrer.length > 0) {
      console.log(`   ✅ Found referrer (exact match): ${referrer[0].given_name} ${referrer[0].family_name}`)
      return referrer[0]
    }
    
    console.log(`   ❌ No referrer found`)
    return null
  } catch (error) {
    console.error(`Error finding referrer:`, error.message)
    return null
  }
}

async function createGiftCard(customerId, customerName, amountCents = 1000, isReferrer = false) {
  try {
    const giftCardName = isReferrer 
      ? `Zorina Referral Rewards - ${customerName}` 
      : `Zorina Welcome Gift - ${customerName}`
    
    const giftCardRequest = {
      idempotencyKey: `test-gift-card-${customerId}-${Date.now()}`,
      locationId: process.env.SQUARE_LOCATION_ID?.trim(),
      giftCard: {
        type: 'DIGITAL',
        state: 'ACTIVE',
        balanceMoney: {
          amount: amountCents,
          currency: 'USD'
        }
      }
    }

    const response = await giftCardsApi.createGiftCard(giftCardRequest)
    
    if (response.result.giftCard) {
      const giftCardId = response.result.giftCard.id
      console.log(`   ✅ Created $${amountCents/100} gift card: ${giftCardId}`)
      return giftCardId
    }
    return null
  } catch (error) {
    console.error(`   ❌ Error creating gift card:`, error.message)
    return null
  }
}

async function testBookingWithReferralCode(customerId, referralCodeToTest = 'BOZHENA8884') {
  console.log('🧪 Testing booking.created webhook logic with referral code')
  console.log('=' .repeat(60))
  console.log(`Customer ID: ${customerId}`)
  console.log(`Testing for referral code: ${referralCodeToTest}`)
  console.log('')
  
  try {
    // Step 1: Check if customer exists in database
    console.log('📋 Step 1: Checking if customer exists in database...')
    let customerExists = await prisma.$queryRaw`
      SELECT square_customer_id, got_signup_bonus, used_referral_code, email_address,
             given_name, family_name, gift_card_id
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    if (!customerExists || customerExists.length === 0) {
      console.log('   ⚠️ Customer not in database - would need to add them first')
      console.log('   📥 Fetching customer from Square...')
      
      try {
        const response = await customersApi.retrieveCustomer(customerId)
        const squareCustomer = response.result.customer
        
        await prisma.$executeRaw`
          INSERT INTO square_existing_clients (
            square_customer_id, given_name, family_name, email_address, phone_number,
            got_signup_bonus, activated_as_referrer, personal_code, gift_card_id,
            used_referral_code, first_ip_address, ip_addresses, referral_email_sent,
            created_at, updated_at
          ) VALUES (
            ${customerId},
            ${squareCustomer.givenName || null},
            ${squareCustomer.familyName || null},
            ${squareCustomer.emailAddress || null},
            ${squareCustomer.phoneNumber || null},
            FALSE, FALSE, NULL, NULL, NULL,
            'test', ARRAY['test'], FALSE,
            NOW(), NOW()
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
      } catch (error) {
        console.error('   ❌ Error fetching customer:', error.message)
        return
      }
    }
    
    const customer = customerExists[0]
    console.log(`   ✅ Customer found: ${customer.given_name} ${customer.family_name}`)
    console.log(`   - Has signup bonus: ${customer.got_signup_bonus}`)
    console.log(`   - Used referral code: ${customer.used_referral_code || 'None'}`)
    console.log(`   - Has gift card: ${customer.gift_card_id || 'None'}`)
    console.log('')
    
    // Step 2: Check if customer already got signup bonus
    if (customer.got_signup_bonus) {
      console.log('   ⚠️ Customer already received signup bonus - would skip')
      return
    }
    
    console.log('📋 Step 2: Checking custom attributes for referral code...')
    const attributes = await getCustomerCustomAttributes(customerId)
    console.log('')
    
    // Step 3: Look for referral code in custom attributes
    console.log('📋 Step 3: Searching for referral code in custom attributes...')
    let referralCode = null
    
    // Check for specific 'referral_code' key
    if (attributes['referral_code']) {
      console.log(`   🎯 Found 'referral_code' key: "${attributes['referral_code']}"`)
      const testReferrer = await findReferrerByCode(attributes['referral_code'])
      if (testReferrer) {
        referralCode = attributes['referral_code']
        console.log(`   ✅ Valid referral code found: ${referralCode}`)
      }
    }
    
    // Check all custom attribute values
    if (!referralCode) {
      console.log('   🔍 Checking all custom attribute values...')
      for (const [key, value] of Object.entries(attributes)) {
        if (typeof value === 'string' && value.length > 0 && value.length <= 20) {
          console.log(`   🔍 Checking: "${value}" (key: ${key})`)
          const testReferrer = await findReferrerByCode(value)
          if (testReferrer) {
            referralCode = value
            console.log(`   ✅ Found referral code: ${referralCode}`)
            break
          }
        }
      }
    }
    
    console.log('')
    
    // Step 4: If referral code found, give gift card
    if (referralCode) {
      console.log('📋 Step 4: Referral code found - Processing gift card...')
      const referrer = await findReferrerByCode(referralCode)
      
      if (referrer) {
        console.log(`   👤 Referrer: ${referrer.given_name} ${referrer.family_name}`)
        console.log(`   🎁 Creating $10 gift card for friend...`)
        
        const friendGiftCardId = await createGiftCard(
          customerId,
          `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Friend',
          1000,
          false
        )
        
        if (friendGiftCardId) {
          console.log(`   ✅ Gift card created: ${friendGiftCardId}`)
          
          // Update database
          await prisma.$executeRaw`
            UPDATE square_existing_clients 
            SET 
              got_signup_bonus = TRUE,
              gift_card_id = ${friendGiftCardId},
              used_referral_code = ${referralCode}
            WHERE square_customer_id = ${customerId}
          `
          
          console.log('   ✅ Database updated:')
          console.log(`      - got_signup_bonus = TRUE`)
          console.log(`      - gift_card_id = ${friendGiftCardId}`)
          console.log(`      - used_referral_code = ${referralCode}`)
          console.log('')
          console.log('✅ TEST PASSED - Friend received $10 gift card!')
          console.log(`   Next: When friend pays, referrer (${referrer.given_name}) will get $10`)
        } else {
          console.log('   ❌ Failed to create gift card')
        }
      } else {
        console.log('   ❌ Referrer not found in database')
      }
    } else {
      console.log('📋 Step 4: No referral code found')
      console.log('   ⚠️ Customer booked without referral code')
      console.log('   - Will receive referral code after first payment')
      console.log('   - No gift card given')
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Get customer ID from command line or use the one from your logs
const customerId = process.argv[2] || '5XSV6VT86R5CYWCJC4QK7FW0E0'
const referralCode = process.argv[3] || 'BOZHENA8884'

console.log('🚀 Starting test...\n')
testBookingWithReferralCode(customerId, referralCode)





