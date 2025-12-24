#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

// Initialize Square API client
const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const giftCardsApi = squareClient.giftCardsApi
const giftCardActivitiesApi = squareClient.giftCardActivitiesApi

async function activateAbyGiftCard() {
  try {
    console.log('🔍 Checking and activating Aby\'s gift card...\n')
    
    // Find Aby in database
    const aby = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, gift_card_id, 
             got_signup_bonus, used_referral_code
      FROM square_existing_clients 
      WHERE square_customer_id = 'Y4BV3AGY3NXYCK63PA4ZA2ZJ14'
    `
    
    if (!aby || aby.length === 0) {
      console.log('❌ Aby not found in database')
      return
    }
    
    const abyData = aby[0]
    console.log(`📋 Aby: ${abyData.given_name} ${abyData.family_name}`)
    console.log(`   Gift Card ID: ${abyData.gift_card_id || 'N/A'}`)
    console.log(`   Got Signup Bonus: ${abyData.got_signup_bonus}`)
    
    if (!abyData.gift_card_id) {
      console.log('❌ No gift card ID found')
      return
    }
    
    // Check current gift card status
    console.log('\n🔍 Checking current gift card status...')
    const giftCardResponse = await giftCardsApi.retrieveGiftCard(abyData.gift_card_id)
    const giftCard = giftCardResponse.result.giftCard
    
    console.log(`   State: ${giftCard.state}`)
    console.log(`   Balance: $${(giftCard.balanceMoney?.amount || 0) / 100}`)
    
    if (giftCard.state === 'ACTIVE' && (giftCard.balanceMoney?.amount || 0) > 0) {
      console.log('\n✅ Gift card is already active with balance!')
      return
    }
    
    // Determine amount - friend gift card should be $10
    const amountCents = abyData.got_signup_bonus ? 1000 : 0 // $10 if got signup bonus
    
    if (amountCents === 0) {
      console.log('\n⚠️ Cannot determine amount')
      return
    }
    
    console.log(`\n🔗 Adding $${amountCents / 100} to gift card using ADJUST_INCREMENT...`)
    console.log(`   Note: This will add money and activate the card if it's PENDING`)
    
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    
    // Try using ADJUST_INCREMENT instead of ACTIVATE
    // ADJUST_INCREMENT can add money to a gift card and should work even for PENDING cards
    const adjustRequest = {
      idempotencyKey: `adjust-aby-gift-card-${abyData.gift_card_id}-${Date.now()}`,
      giftCardActivity: {
        giftCardId: abyData.gift_card_id,
        type: 'ADJUST_INCREMENT',
        locationId: locationId,
        adjustIncrementActivityDetails: {
          amountMoney: {
            amount: amountCents,
            currency: 'USD'
          },
          reason: 'REFERRAL_FRIEND_BONUS' // Reason for the adjustment
        }
      }
    }
    
    const adjustResponse = await giftCardActivitiesApi.createGiftCardActivity(adjustRequest)
    
    if (adjustResponse.result && adjustResponse.result.giftCardActivity) {
      const activity = adjustResponse.result.giftCardActivity
      console.log('✅ Money added to gift card successfully!')
      console.log(`   Activity ID: ${activity.id}`)
      console.log(`   Balance after adjustment: $${(activity.giftCardBalanceMoney?.amount || 0) / 100}`)
      
      // Verify by retrieving the gift card again
      const verifyResponse = await giftCardsApi.retrieveGiftCard(abyData.gift_card_id)
      const verifyGiftCard = verifyResponse.result.giftCard
      
      console.log('\n🔍 Verification:')
      console.log(`   State: ${verifyGiftCard.state}`)
      console.log(`   Balance: $${(verifyGiftCard.balanceMoney?.amount || 0) / 100}`)
      
      if ((verifyGiftCard.balanceMoney?.amount || 0) > 0) {
        console.log('\n✅ Success! Gift card now has balance!')
      }
    } else {
      console.log('❌ Unexpected response from Square API')
    }
    
    // Also check and fix referrer's (Umi's) gift card if needed
    if (abyData.used_referral_code) {
      console.log('\n\n🔍 Checking referrer (Umi\'s) gift card...')
      
      const referrer = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, gift_card_id
        FROM square_existing_clients 
        WHERE personal_code = ${abyData.used_referral_code}
        LIMIT 1
      `
      
      if (referrer && referrer.length > 0) {
        const referrerData = referrer[0]
        console.log(`   Referrer: ${referrerData.given_name} ${referrerData.family_name}`)
        
        if (referrerData.gift_card_id) {
          const referrerGiftCardResponse = await giftCardsApi.retrieveGiftCard(referrerData.gift_card_id)
          const referrerGiftCard = referrerGiftCardResponse.result.giftCard
          
          console.log(`   Referrer Gift Card State: ${referrerGiftCard.state}`)
          console.log(`   Referrer Gift Card Balance: $${(referrerGiftCard.balanceMoney?.amount || 0) / 100}`)
          
          // Aby already paid, so referrer should have $10
          if ((referrerGiftCard.balanceMoney?.amount || 0) === 0 && abyData.got_signup_bonus) {
            console.log(`\n   🔗 Adding $10 to referrer gift card...`)
            
            const referrerAdjustRequest = {
              idempotencyKey: `adjust-referrer-gift-card-${referrerData.gift_card_id}-${Date.now()}`,
              giftCardActivity: {
                giftCardId: referrerData.gift_card_id,
                type: 'ADJUST_INCREMENT',
                locationId: locationId,
                adjustIncrementActivityDetails: {
                  amountMoney: {
                    amount: 1000, // $10
                    currency: 'USD'
                  },
                  reason: 'REFERRAL_REWARD'
                }
              }
            }
            
            const referrerAdjustResponse = await giftCardActivitiesApi.createGiftCardActivity(referrerAdjustRequest)
            
            if (referrerAdjustResponse.result && referrerAdjustResponse.result.giftCardActivity) {
              const referrerActivity = referrerAdjustResponse.result.giftCardActivity
              console.log(`   ✅ Money added to referrer gift card!`)
              console.log(`   Balance: $${(referrerActivity.giftCardBalanceMoney?.amount || 0) / 100}`)
            }
          } else if ((referrerGiftCard.balanceMoney?.amount || 0) > 0) {
            console.log(`   ✅ Referrer gift card already has balance!`)
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.errors) {
      console.error('   Square API errors:', JSON.stringify(error.errors, null, 2))
    }
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

activateAbyGiftCard()
