#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const giftCardsApi = squareClient.giftCardsApi
const giftCardActivitiesApi = squareClient.giftCardActivitiesApi

async function activateCustomerGiftCard(customerId) {
  console.log('🎁 Activating Gift Card for Customer')
  console.log('=' .repeat(60))
  console.log(`Customer ID: ${customerId}`)
  console.log('')
  
  try {
    const dbCustomer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, gift_card_id, used_referral_code
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    if (!dbCustomer || dbCustomer.length === 0) {
      console.log('❌ Customer not found')
      return
    }
    
    const customer = dbCustomer[0]
    console.log(`✅ Customer: ${customer.given_name || 'Unknown'} ${customer.family_name || ''}`)
    console.log(`   Gift Card ID: ${customer.gift_card_id || 'None'}`)
    
    if (!customer.gift_card_id) {
      console.log('❌ No gift card ID')
      return
    }
    
    // Check current state
    const giftCardResponse = await giftCardsApi.retrieveGiftCard(customer.gift_card_id)
    const giftCard = giftCardResponse.result.giftCard
    const balanceAmount = giftCard.balanceMoney?.amount
    const balanceNumber = typeof balanceAmount === 'bigint' ? Number(balanceAmount) : (balanceAmount || 0)
    
    console.log(`   Current State: ${giftCard.state}`)
    console.log(`   Current Balance: $${balanceNumber / 100}`)
    console.log('')
    
    if (giftCard.state === 'ACTIVE' && balanceNumber >= 1000) {
      console.log('✅ Already active with $10!')
      return
    }
    
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    
    // Try ADJUST_INCREMENT (works for owner-funded, no payment required)
    console.log('📋 Attempting ADJUST_INCREMENT method...')
    const adjustRequest = {
      idempotencyKey: `adjust-${customer.gift_card_id}-${Date.now()}`,
      giftCardActivity: {
        giftCardId: customer.gift_card_id,
        type: 'ADJUST_INCREMENT',
        locationId: locationId,
        adjustIncrementActivityDetails: {
          amountMoney: { amount: 1000, currency: 'USD' },
          reason: customer.used_referral_code ? 'REFERRAL_FRIEND_BONUS' : 'REFERRAL_REWARD'
        }
      }
    }
    
    try {
      const adjustResponse = await giftCardActivitiesApi.createGiftCardActivity(adjustRequest)
      
      if (adjustResponse.result?.giftCardActivity) {
        const activity = adjustResponse.result.giftCardActivity
        const activityBalance = activity.giftCardBalanceMoney?.amount
        const activityBalanceNumber = typeof activityBalance === 'bigint' ? Number(activityBalance) : (activityBalance || 0)
        
        console.log('✅ ADJUST_INCREMENT succeeded!')
        console.log(`   Activity ID: ${activity.id}`)
        console.log(`   Balance after adjustment: $${activityBalanceNumber / 100}`)
        
        // Verify
        const verify = await giftCardsApi.retrieveGiftCard(customer.gift_card_id)
        const verifyCard = verify.result.giftCard
        const verifyBalance = verifyCard.balanceMoney?.amount
        const verifyBalanceNumber = typeof verifyBalance === 'bigint' ? Number(verifyBalance) : (verifyBalance || 0)
        
        console.log('')
        console.log('📋 Verification:')
        console.log(`   State: ${verifyCard.state}`)
        console.log(`   Balance: $${verifyBalanceNumber / 100}`)
        
        if (verifyBalanceNumber >= 1000) {
          console.log('')
          console.log('✅ SUCCESS! Gift card loaded with $10!')
        }
        return
      }
    } catch (error) {
      console.log(`❌ ADJUST_INCREMENT failed: ${error.message}`)
      if (error.errors) {
        console.log('Errors:', JSON.stringify(error.errors, null, 2))
      }
      
      // Try ACTIVATE with buyerPaymentInstrumentIds as fallback
      console.log('')
      console.log('📋 Trying ACTIVATE with buyerPaymentInstrumentIds...')
      const activateRequest = {
        idempotencyKey: `activate-${customer.gift_card_id}-${Date.now()}`,
        giftCardActivity: {
          giftCardId: customer.gift_card_id,
          type: 'ACTIVATE',
          locationId: locationId,
          activateActivityDetails: {
            amountMoney: { amount: 1000, currency: 'USD' },
            buyerPaymentInstrumentIds: ['referral-reward']
          }
        }
      }
      
      try {
        const activateResponse = await giftCardActivitiesApi.createGiftCardActivity(activateRequest)
        
        if (activateResponse.result?.giftCardActivity) {
          const activity = activateResponse.result.giftCardActivity
          const activityBalance = activity.giftCardBalanceMoney?.amount
          const activityBalanceNumber = typeof activityBalance === 'bigint' ? Number(activityBalance) : (activityBalance || 0)
          
          console.log('✅ ACTIVATE succeeded!')
          console.log(`   Balance: $${activityBalanceNumber / 100}`)
          
          const verify = await giftCardsApi.retrieveGiftCard(customer.gift_card_id)
          const verifyCard = verify.result.giftCard
          const verifyBalance = verifyCard.balanceMoney?.amount
          const verifyBalanceNumber = typeof verifyBalance === 'bigint' ? Number(verifyBalance) : (verifyBalance || 0)
          
          console.log('')
          console.log('📋 Verification:')
          console.log(`   State: ${verifyCard.state}`)
          console.log(`   Balance: $${verifyBalanceNumber / 100}`)
          
          if (verifyCard.state === 'ACTIVE' && verifyBalanceNumber >= 1000) {
            console.log('✅ SUCCESS! Gift card activated with $10!')
          }
        }
      } catch (activateError) {
        console.log(`❌ ACTIVATE also failed: ${activateError.message}`)
        if (activateError.errors) {
          console.log('Errors:', JSON.stringify(activateError.errors, null, 2))
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

const customerId = process.argv[2] || '5XSV6VT86R5CYWCJC4QK7FW0E0'
console.log('🚀 Testing gift card activation...\n')
activateCustomerGiftCard(customerId)






