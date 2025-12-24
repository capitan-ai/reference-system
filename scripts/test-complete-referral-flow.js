#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const { sendReferralCodeEmail } = require('../lib/email-service')

const prisma = new PrismaClient()
const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const customersApi = squareClient.customersApi
const giftCardsApi = squareClient.giftCardsApi

// Generate unique referral code
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Create test referrer (you)
async function createTestReferrer() {
  console.log('👤 Creating test referrer (you)...')
  
  try {
    const referrerData = {
      givenName: 'Test',
      familyName: 'Referrer',
      emailAddress: process.env.TEST_EMAIL || 'your-email@gmail.com',
      phoneNumber: '+1234567890'
    }

    const response = await customersApi.createCustomer({
      givenName: referrerData.givenName,
      familyName: referrerData.familyName,
      emailAddress: referrerData.emailAddress,
      phoneNumber: referrerData.phoneNumber
    })

    if (response.result.customer) {
      const customer = response.result.customer
      console.log(`✅ Created test referrer: ${customer.id}`)
      
      // Add to our database
      const referralCode = generateReferralCode()
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
          created_at,
          updated_at
        ) VALUES (
          ${customer.id},
          ${customer.givenName},
          ${customer.familyName},
          ${customer.emailAddress},
          ${customer.phoneNumber},
          FALSE,
          TRUE,
          ${referralCode},
          ${customer.createdAt}::timestamp with time zone,
          ${customer.updatedAt}::timestamp with time zone
        )
      `

      // Update Square customer with custom attributes
      await customersApi.updateCustomer(customer.id, {
        customer: {
          customAttributes: [
            {
              key: 'referral_code',
              value: referralCode
            },
            {
              key: 'referral_url',
              value: `https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/ref/${referralCode}`
            },
            {
              key: 'is_referrer',
              value: 'true'
            }
          ]
        }
      })

      console.log(`✅ Added to database with referral code: ${referralCode}`)
      return { customer, referralCode }
    }
  } catch (error) {
    console.error('❌ Error creating test referrer:', error.message)
    return null
  }
}

// Create test friend (new customer)
async function createTestFriend(referralCode) {
  console.log('👤 Creating test friend (new customer)...')
  
  try {
    const friendData = {
      givenName: 'Test',
      familyName: 'Friend',
      emailAddress: 'testfriend@example.com',
      phoneNumber: '+1987654321'
    }

    const response = await customersApi.createCustomer({
      givenName: friendData.givenName,
      familyName: friendData.familyName,
      emailAddress: friendData.emailAddress,
      phoneNumber: friendData.phoneNumber
    })

    if (response.result.customer) {
      const customer = response.result.customer
      console.log(`✅ Created test friend: ${customer.id}`)
      
      // Update Square customer with referral code (simulating they used the code)
      await customersApi.updateCustomer(customer.id, {
        customer: {
          customAttributes: [
            {
              key: 'referral_code',
              value: referralCode
            },
            {
              key: 'used_referral_code',
              value: 'true'
            }
          ]
        }
      })

      console.log(`✅ Updated friend with referral code: ${referralCode}`)
      return customer
    }
  } catch (error) {
    console.error('❌ Error creating test friend:', error.message)
    return null
  }
}

// Simulate payment completion
async function simulatePaymentCompletion(customerId) {
  console.log('💰 Simulating payment completion...')
  
  try {
    // Get customer custom attributes
    const response = await customersApi.retrieveCustomer(customerId)
    const customer = response.result.customer
    
    if (!customer.customAttributes) {
      console.log('❌ No custom attributes found')
      return
    }

    const attributes = {}
    customer.customAttributes.forEach(attr => {
      attributes[attr.key] = attr.value
    })

    if (!attributes.referral_code) {
      console.log('❌ No referral code found')
      return
    }

    const referralCode = attributes.referral_code
    console.log(`🎯 Found referral code: ${referralCode}`)

    // Find the referrer
    const referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, personal_code
      FROM square_existing_clients 
      WHERE personal_code = ${referralCode}
    `

    if (!referrer || referrer.length === 0) {
      console.log('❌ Referrer not found')
      return
    }

    const referrerData = referrer[0]
    console.log(`👤 Found referrer: ${referrerData.given_name} ${referrerData.family_name}`)

    // Create gift card for the NEW customer (friend)
    const friendGiftCardResponse = await giftCardsApi.createGiftCard({
      idempotencyKey: `test-friend-${customerId}-${Date.now()}`,
      giftCard: {
        type: 'DIGITAL',
        state: 'ACTIVE',
        balanceMoney: {
          amount: 1000, // $10.00
          currency: 'USD'
        }
      }
    })

    // Create gift card for the REFERRER
    const referrerGiftCardResponse = await giftCardsApi.createGiftCard({
      idempotencyKey: `test-referrer-${referrerData.square_customer_id}-${Date.now()}`,
      giftCard: {
        type: 'DIGITAL',
        state: 'ACTIVE',
        balanceMoney: {
          amount: 1000, // $10.00
          currency: 'USD'
        }
      }
    })

    if (friendGiftCardResponse.result.giftCard && referrerGiftCardResponse.result.giftCard) {
      const friendGiftCard = friendGiftCardResponse.result.giftCard
      const referrerGiftCard = referrerGiftCardResponse.result.giftCard

      console.log(`✅ Gift cards created:`)
      console.log(`   - Friend gets: $10 gift card (${friendGiftCard.id})`)
      console.log(`   - Referrer gets: $10 gift card (${referrerGiftCard.id})`)

      // Update database
      // Add friend to database
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
          created_at,
          updated_at
        ) VALUES (
          ${customerId},
          'Test',
          'Friend',
          'testfriend@example.com',
          '+1987654321',
          TRUE,
          FALSE,
          NULL,
          ${friendGiftCard.id},
          NOW(),
          NOW()
        )
        ON CONFLICT (square_customer_id) DO UPDATE SET
          got_signup_bonus = TRUE,
          gift_card_id = ${friendGiftCard.id}
      `

      // Update referrer's stats
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET 
          total_referrals = COALESCE(total_referrals, 0) + 1,
          total_rewards = COALESCE(total_rewards, 0) + 1000,
          gift_card_id = ${referrerGiftCard.id}
        WHERE square_customer_id = ${referrerData.square_customer_id}
      `

      console.log(`✅ Database updated successfully!`)
      console.log(`🎉 Test completed successfully!`)
      console.log(`   - Referral code: ${referralCode}`)
      console.log(`   - Friend: Test Friend (${customerId})`)
      console.log(`   - Referrer: ${referrerData.given_name} ${referrerData.family_name} (${referrerData.square_customer_id})`)
      console.log(`   - Both parties received $10 gift cards!`)

      return {
        success: true,
        friendGiftCard: friendGiftCard.id,
        referrerGiftCard: referrerGiftCard.id,
        referralCode
      }
    }

  } catch (error) {
    console.error('❌ Error simulating payment:', error.message)
    return { success: false, error: error.message }
  }
}

// Main test function
async function runCompleteTest() {
  console.log('🧪 Starting Complete Referral System Test...')
  console.log('=' .repeat(50))
  
  try {
    await prisma.$connect()

    // Step 1: Create test referrer (you)
    const referrer = await createTestReferrer()
    if (!referrer) {
      console.log('❌ Failed to create referrer')
      return
    }

    console.log('\n' + '=' .repeat(50))

    // Step 2: Send referral code email
    console.log('📧 Sending referral code email...')
    const emailResult = await sendReferralCodeEmail(
      `${referrer.customer.givenName} ${referrer.customer.familyName}`,
      referrer.customer.emailAddress,
      referrer.referralCode,
      `https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/ref/${referrer.referralCode}`
    )

    if (emailResult.success) {
      console.log(`✅ Email sent successfully! Check your inbox.`)
    } else {
      console.log(`❌ Email failed: ${emailResult.error}`)
    }

    console.log('\n' + '=' .repeat(50))

    // Step 3: Create test friend
    const friend = await createTestFriend(referrer.referralCode)
    if (!friend) {
      console.log('❌ Failed to create friend')
      return
    }

    console.log('\n' + '=' .repeat(50))

    // Step 4: Simulate payment completion
    const paymentResult = await simulatePaymentCompletion(friend.id)
    if (!paymentResult.success) {
      console.log('❌ Payment simulation failed')
      return
    }

    console.log('\n' + '=' .repeat(50))
    console.log('🎉 COMPLETE TEST SUCCESSFUL!')
    console.log('=' .repeat(50))
    console.log('📊 Test Summary:')
    console.log(`   ✅ Referrer created: ${referrer.customer.givenName} ${referrer.customer.familyName}`)
    console.log(`   ✅ Referral code: ${referrer.referralCode}`)
    console.log(`   ✅ Email sent to: ${referrer.customer.emailAddress}`)
    console.log(`   ✅ Friend created: ${friend.givenName} ${friend.familyName}`)
    console.log(`   ✅ Payment simulated successfully`)
    console.log(`   ✅ Friend gift card: ${paymentResult.friendGiftCard}`)
    console.log(`   ✅ Referrer gift card: ${paymentResult.referrerGiftCard}`)
    console.log('=' .repeat(50))

  } catch (error) {
    console.error('💥 Test failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the test
runCompleteTest()
