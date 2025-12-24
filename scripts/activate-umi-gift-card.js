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

async function activateUmiGiftCard() {
  try {
    console.log('🔍 Checking and activating Umi\'s (referrer) gift card...\n')
    
    // Find Umi by personal code (CUST_MHA4LEYB5ERA which Aby used)
    const umi = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, gift_card_id, 
             personal_code, activated_as_referrer
      FROM square_existing_clients 
      WHERE personal_code = 'CUST_MHA4LEYB5ERA'
      LIMIT 1
    `
    
    if (!umi || umi.length === 0) {
      console.log('❌ Umi not found in database with personal_code: CUST_MHA4LEYB5ERA')
      // Try to find by name
      const umiByName = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, gift_card_id, 
               personal_code, activated_as_referrer
        FROM square_existing_clients 
        WHERE given_name ILIKE '%umi%' OR family_name ILIKE '%umi%'
        LIMIT 1
      `
      if (umiByName && umiByName.length > 0) {
        console.log('✅ Found Umi by name')
        await processUmi(umiByName[0])
      } else {
        console.log('❌ Could not find Umi in database')
      }
      return
    }
    
    console.log('✅ Found Umi!')
    await processUmi(umi[0])
    
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

async function processUmi(umiData) {
  try {
    console.log(`📋 Umi: ${umiData.given_name} ${umiData.family_name}`)
    console.log(`   Customer ID: ${umiData.square_customer_id}`)
    console.log(`   Personal Code: ${umiData.personal_code || 'N/A'}`)
    console.log(`   Gift Card ID: ${umiData.gift_card_id || 'N/A'}`)
    console.log(`   Activated as Referrer: ${umiData.activated_as_referrer}`)
    
    if (!umiData.gift_card_id) {
      console.log('❌ No gift card ID found for Umi')
      console.log('   Umi might not have a gift card yet')
      return
    }
    
    // Check current gift card status
    console.log('\n🔍 Checking current gift card status...')
    const giftCardResponse = await giftCardsApi.retrieveGiftCard(umiData.gift_card_id)
    const giftCard = giftCardResponse.result.giftCard
    
    console.log(`   State: ${giftCard.state}`)
    const currentBalanceAmount = giftCard.balanceMoney?.amount
    const currentBalanceNumber = typeof currentBalanceAmount === 'bigint' ? Number(currentBalanceAmount) : (currentBalanceAmount || 0)
    console.log(`   Balance: $${currentBalanceNumber / 100}`)
    
    if (giftCard.state === 'ACTIVE' && currentBalanceNumber > 0) {
      console.log('\n✅ Gift card is already active with balance!')
      return
    }
    
    // Umi should have $10 because Aby paid (Aby used Umi's referral code)
    // Check if Aby completed payment
    const aby = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, used_referral_code, 
             first_payment_completed, got_signup_bonus
      FROM square_existing_clients 
      WHERE used_referral_code = ${umiData.personal_code}
        AND first_payment_completed = true
      LIMIT 1
    `
    
    let amountCents = 0
    if (aby && aby.length > 0) {
      const abyData = aby[0]
      console.log(`\n   Found friend who paid: ${abyData.given_name} ${abyData.family_name}`)
      console.log(`   Friend completed payment: ${abyData.first_payment_completed}`)
      amountCents = 1000 // $10 for referrer reward
    } else {
      console.log('\n   ⚠️ No friend has completed payment yet using Umi\'s referral code')
      console.log('   Will activate with $10 anyway (referrer gift card)')
      amountCents = 1000
    }
    
    if (amountCents === 0) {
      console.log('\n⚠️ Cannot determine amount')
      return
    }
    
    console.log(`\n🔗 Activating gift card with $${amountCents / 100} using ACTIVATE activity...`)
    console.log(`   Using custom processing flow (no order/payment required)`)
    
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    
    // Use ACTIVATE activity with buyer_payment_instrument_ids for custom processing
    const activateRequest = {
      idempotencyKey: `activate-umi-gift-card-${umiData.gift_card_id}-${Date.now()}`,
      giftCardActivity: {
        giftCardId: umiData.gift_card_id,
        type: 'ACTIVATE',
        locationId: locationId,
        activateActivityDetails: {
          amountMoney: {
            amount: amountCents,
            currency: 'USD'
          },
          buyerPaymentInstrumentIds: ['referral-reward'] // Required for custom processing
        }
      }
    }
    
    const activateResponse = await giftCardActivitiesApi.createGiftCardActivity(activateRequest)
    
    if (activateResponse.result && activateResponse.result.giftCardActivity) {
      const activity = activateResponse.result.giftCardActivity
      console.log('✅ Gift card activated successfully!')
      console.log(`   Activity ID: ${activity.id}`)
      console.log(`   Activity Type: ${activity.type}`)
      const balanceAmount = activity.giftCardBalanceMoney?.amount
      const balanceNumber = typeof balanceAmount === 'bigint' ? Number(balanceAmount) : (balanceAmount || 0)
      console.log(`   Balance after activation: $${balanceNumber / 100}`)
      
      // Verify by retrieving the gift card again
      const verifyResponse = await giftCardsApi.retrieveGiftCard(umiData.gift_card_id)
      const verifyGiftCard = verifyResponse.result.giftCard
      
      console.log('\n🔍 Verification:')
      console.log(`   State: ${verifyGiftCard.state} ${verifyGiftCard.state === 'ACTIVE' ? '✅' : '⚠️'}`)
      const verifyBalanceAmount = verifyGiftCard.balanceMoney?.amount
      const verifyBalanceNumber = typeof verifyBalanceAmount === 'bigint' ? Number(verifyBalanceAmount) : (verifyBalanceAmount || 0)
      console.log(`   Balance: $${verifyBalanceNumber / 100}`)
      
      if (verifyGiftCard.state === 'ACTIVE' && verifyBalanceNumber > 0) {
        console.log('\n✅ Success! Umi\'s gift card is now active with balance!')
      }
    } else {
      console.log('❌ Unexpected response from Square API')
    }
    
  } catch (error) {
    console.error('❌ Error processing Umi:', error.message)
    if (error.errors) {
      console.error('   Square API errors:', JSON.stringify(error.errors, null, 2))
    }
    console.error('Stack:', error.stack)
  }
}

activateUmiGiftCard()
