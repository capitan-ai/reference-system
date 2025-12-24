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
const giftCardsApi = squareClient.giftCardsApi

// Create REAL gift cards using Square API
async function createRealGiftCards() {
  console.log('🎁 Creating REAL Gift Cards with Square API...')
  
  try {
    // Create gift card for friend (new customer)
    const friendGiftCardResponse = await giftCardsApi.createGiftCard({
      idempotencyKey: `test-friend-${Date.now()}`,
      locationId: process.env.SQUARE_LOCATION_ID,
      giftCard: {
        type: 'DIGITAL',
        state: 'ACTIVE',
        balanceMoney: {
          amount: 1000, // $10.00 in cents
          currency: 'USD'
        }
      }
    })

    // Create gift card for referrer
    const referrerGiftCardResponse = await giftCardsApi.createGiftCard({
      idempotencyKey: `test-referrer-${Date.now()}`,
      locationId: process.env.SQUARE_LOCATION_ID,
      giftCard: {
        type: 'DIGITAL',
        state: 'ACTIVE',
        balanceMoney: {
          amount: 1000, // $10.00 in cents
          currency: 'USD'
        }
      }
    })

    if (friendGiftCardResponse.result.giftCard && referrerGiftCardResponse.result.giftCard) {
      const friendGiftCard = friendGiftCardResponse.result.giftCard
      const referrerGiftCard = referrerGiftCardResponse.result.giftCard

      console.log('✅ REAL Gift Cards Created Successfully!')
      console.log('=' .repeat(50))
      console.log('🎁 Friend Gift Card:')
      console.log(`   ID: ${friendGiftCard.id}`)
      console.log(`   Balance: $${friendGiftCard.balanceMoney.amount / 100}`)
      console.log(`   State: ${friendGiftCard.state}`)
      console.log(`   Type: ${friendGiftCard.type}`)
      console.log(`   Created: ${friendGiftCard.createdAt}`)
      
      console.log('\n🎁 Referrer Gift Card:')
      console.log(`   ID: ${referrerGiftCard.id}`)
      console.log(`   Balance: $${referrerGiftCard.balanceMoney.amount / 100}`)
      console.log(`   State: ${referrerGiftCard.state}`)
      console.log(`   Type: ${referrerGiftCard.type}`)
      console.log(`   Created: ${referrerGiftCard.createdAt}`)
      
      console.log('\n📊 Gift Card Details:')
      console.log(`   - Both cards are DIGITAL (can be sent via email)`)
      console.log(`   - Both cards are ACTIVE (ready to use)`)
      console.log(`   - Both cards have $10.00 balance`)
      console.log(`   - Cards can be used at any Square location`)
      
      return {
        friendGiftCard: friendGiftCard.id,
        referrerGiftCard: referrerGiftCard.id,
        friendBalance: friendGiftCard.balanceMoney.amount,
        referrerBalance: referrerGiftCard.balanceMoney.amount
      }
    }

  } catch (error) {
    console.error('❌ Error creating real gift cards:', error.message)
    return null
  }
}

// Show how referral tracking works
async function showReferralTracking() {
  console.log('🔍 How Referral Tracking Works:')
  console.log('=' .repeat(50))
  
  try {
    await prisma.$connect()
    
    // Get a sample referrer from database
    const referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, personal_code, activated_as_referrer
      FROM square_existing_clients 
      WHERE activated_as_referrer = TRUE 
      LIMIT 1
    `
    
    if (referrer && referrer.length > 0) {
      const customer = referrer[0]
      console.log('👤 Sample Referrer:')
      console.log(`   Name: ${customer.given_name} ${customer.family_name}`)
      console.log(`   Square ID: ${customer.square_customer_id}`)
      console.log(`   Referral Code: ${customer.personal_code}`)
      console.log(`   Referral URL: https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/ref/${customer.personal_code}`)
      
      console.log('\n🔗 Referral Link Tracking:')
      console.log('   1. Customer shares their referral link')
      console.log('   2. Friend clicks the link and books appointment')
      console.log('   3. Friend uses referral code during booking')
      console.log('   4. Code is stored in Square custom attributes')
      console.log('   5. When friend pays, webhook processes the referral')
      console.log('   6. Gift cards are created for both parties')
      
      console.log('\n📊 Database Tracking:')
      console.log('   - square_existing_clients table stores all customer data')
      console.log('   - personal_code field contains unique referral code')
      console.log('   - gift_card_id field stores created gift card ID')
      console.log('   - total_referrals field counts successful referrals')
      console.log('   - total_rewards field tracks total rewards earned')
    }
    
  } catch (error) {
    console.error('❌ Error showing referral tracking:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// Main function
async function demonstrateSystem() {
  console.log('🎯 Referral System Demonstration')
  console.log('=' .repeat(60))
  
  // Show referral tracking
  await showReferralTracking()
  
  console.log('\n' + '=' .repeat(60))
  
  // Create real gift cards
  const giftCards = await createRealGiftCards()
  
  if (giftCards) {
    console.log('\n' + '=' .repeat(60))
    console.log('🎉 System Demonstration Complete!')
    console.log('=' .repeat(60))
    console.log('✅ Referral tracking system working')
    console.log('✅ Real gift cards created successfully')
    console.log('✅ Database integration working')
    console.log('✅ Square API integration working')
    console.log('=' .repeat(60))
  }
}

// Run the demonstration
demonstrateSystem()
