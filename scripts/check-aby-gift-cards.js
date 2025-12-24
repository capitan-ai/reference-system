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
const customersApi = squareClient.customersApi
const giftCardActivitiesApi = squareClient.giftCardActivitiesApi

async function checkAbyGiftCards() {
  try {
    console.log('🔍 Checking Aby\'s gift card status...\n')
    
    // Find Aby in database
    const aby = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, 
             gift_card_id, personal_code, got_signup_bonus, activated_as_referrer,
             first_payment_completed, used_referral_code, total_referrals, total_rewards
      FROM square_existing_clients 
      WHERE square_customer_id = 'Y4BV3AGY3NXYCK63PA4ZA2ZJ14'
    `
    
    if (!aby || aby.length === 0) {
      console.log('❌ Aby not found in database')
      return
    }
    
    const abyData = aby[0]
    console.log('📋 Database Record:')
    console.log(`   Name: ${abyData.given_name} ${abyData.family_name}`)
    console.log(`   Email: ${abyData.email_address || 'N/A'}`)
    console.log(`   Gift Card ID: ${abyData.gift_card_id || 'N/A'}`)
    console.log(`   Personal Code: ${abyData.personal_code || 'N/A'}`)
    console.log(`   Got Signup Bonus: ${abyData.got_signup_bonus}`)
    console.log(`   Activated as Referrer: ${abyData.activated_as_referrer}`)
    console.log(`   First Payment Completed: ${abyData.first_payment_completed}`)
    console.log(`   Used Referral Code: ${abyData.used_referral_code || 'N/A'}`)
    console.log(`   Total Referrals: ${abyData.total_referrals || 0}`)
    console.log(`   Total Rewards: ${abyData.total_rewards || 0} cents ($${(abyData.total_rewards || 0) / 100})`)
    
    if (!abyData.gift_card_id) {
      console.log('\n❌ No gift card ID found in database for Aby')
      return
    }
    
    let giftCard = null
    
    // Check gift card in Square
    console.log('\n🔍 Checking Aby\'s gift card in Square...')
    try {
      const giftCardResponse = await giftCardsApi.retrieveGiftCard(abyData.gift_card_id)
      giftCard = giftCardResponse.result.giftCard
      
      if (giftCard) {
        console.log('✅ Gift Card Found in Square:')
        console.log(`   Gift Card ID: ${giftCard.id}`)
        console.log(`   GAN: ${giftCard.gan || 'N/A'}`)
        console.log(`   Type: ${giftCard.type}`)
        console.log(`   State: ${giftCard.state} ${giftCard.state === 'PENDING' ? '⚠️ (NEEDS ACTIVATION)' : ''}`)
        console.log(`   Balance: $${(giftCard.balanceMoney?.amount || 0) / 100}`)
        console.log(`   Linked Customers: ${giftCard.customerIds?.length || 0}`)
        if (giftCard.customerIds && giftCard.customerIds.length > 0) {
          console.log(`   Customer IDs: ${giftCard.customerIds.join(', ')}`)
        }
        console.log(`   Created At: ${giftCard.createdAt || 'N/A'}`)
        
        // Check gift card activities
        console.log('\n🔍 Checking gift card activities...')
        try {
          const activitiesResponse = await giftCardActivitiesApi.listGiftCardActivities(
            abyData.gift_card_id
          )
          
          if (activitiesResponse.result && activitiesResponse.result.giftCardActivities) {
            const activities = activitiesResponse.result.giftCardActivities
            console.log(`   Found ${activities.length} activity/activities:`)
            
            activities.forEach((activity, index) => {
              console.log(`\n   Activity ${index + 1}:`)
              console.log(`      Type: ${activity.type}`)
              console.log(`      ID: ${activity.id}`)
              console.log(`      Created At: ${activity.createdAt}`)
              
              if (activity.giftCardBalanceMoney) {
                console.log(`      Balance After: $${(activity.giftCardBalanceMoney.amount || 0) / 100}`)
              }
              
              // Check activity details based on type
              if (activity.type === 'ACTIVATE' && activity.activateActivityDetails) {
                console.log(`      Activated Amount: $${(activity.activateActivityDetails.amountMoney?.amount || 0) / 100}`)
              } else if (activity.type === 'ADJUST_INCREMENT' && activity.adjustIncrementActivityDetails) {
                console.log(`      Increment Amount: $${(activity.adjustIncrementActivityDetails.amountMoney?.amount || 0) / 100}`)
                console.log(`      Reason: ${activity.adjustIncrementActivityDetails.reason || 'N/A'}`)
              } else if (activity.type === 'ADJUST_DECREMENT' && activity.adjustDecrementActivityDetails) {
                console.log(`      Decrement Amount: $${(activity.adjustDecrementActivityDetails.amountMoney?.amount || 0) / 100}`)
              } else if (activity.type === 'REDEEM' && activity.redeemActivityDetails) {
                console.log(`      Redeemed Amount: $${(activity.redeemActivityDetails.amountMoney?.amount || 0) / 100}`)
              }
            })
            
            if (activities.length === 0) {
              console.log('   ⚠️ No activities found - gift card was never activated or loaded!')
              console.log('   This is why the balance is $0 and state is PENDING')
            }
          }
        } catch (activityError) {
          console.error('   ❌ Error checking activities:', activityError.message)
        }
      }
    } catch (error) {
      console.error('❌ Error retrieving gift card:', error.message)
      if (error.errors) {
        console.error('   Square API errors:', JSON.stringify(error.errors, null, 2))
      }
    }
    
    // Check if Aby used a referral code (should have gotten friend gift card)
    if (abyData.used_referral_code) {
      console.log('\n🔍 Checking referrer (Umi) information...')
      const referrer = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, gift_card_id, personal_code
        FROM square_existing_clients 
        WHERE personal_code = ${abyData.used_referral_code}
        LIMIT 1
      `
      
      if (referrer && referrer.length > 0) {
        const referrerData = referrer[0]
        console.log(`   Referrer: ${referrerData.given_name} ${referrerData.family_name}`)
        console.log(`   Referrer Gift Card ID: ${referrerData.gift_card_id || 'N/A'}`)
        
        if (referrerData.gift_card_id) {
          try {
            const referrerGiftCardResponse = await giftCardsApi.retrieveGiftCard(referrerData.gift_card_id)
            const referrerGiftCard = referrerGiftCardResponse.result.giftCard
            
            if (referrerGiftCard) {
              console.log(`   Referrer Gift Card State: ${referrerGiftCard.state} ${referrerGiftCard.state === 'PENDING' ? '⚠️ (NEEDS ACTIVATION)' : ''}`)
              console.log(`   Referrer Gift Card Balance: $${(referrerGiftCard.balanceMoney?.amount || 0) / 100}`)
              console.log(`   Referrer Gift Card Created At: ${referrerGiftCard.createdAt || 'N/A'}`)
            }
          } catch (err) {
            console.error(`   ❌ Error checking referrer gift card: ${err.message}`)
          }
        }
      }
    }
    
    console.log('\n📊 Summary:')
    if (giftCard) {
      console.log(`   Aby's Gift Card Balance: $${(giftCard.balanceMoney?.amount || 0) / 100}`)
      console.log(`   Aby's Gift Card State: ${giftCard.state}`)
      
      if (giftCard.state === 'PENDING' && (giftCard.balanceMoney?.amount || 0) === 0) {
        console.log('\n⚠️ ISSUE FOUND:')
        console.log('   - Gift card state is PENDING (should be ACTIVE)')
        console.log('   - Balance is $0 (should be $10 for friend gift card)')
        console.log('   - No ACTIVATE activity found')
        console.log('   - The gift card was created but never activated!')
      }
    }
    
    console.log(`   Database shows got_signup_bonus: ${abyData.got_signup_bonus}`)
    console.log(`   Database shows first_payment_completed: ${abyData.first_payment_completed}`)
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkAbyGiftCards()
