#!/usr/bin/env node
/**
 * Analyze gift card timing - when were they created and why haven't they been used?
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { Client, Environment } = require('square')

const squareEnvironmentName = process.env.SQUARE_ENVIRONMENT || 'production'
const environment = squareEnvironmentName === 'sandbox' ? Environment.Sandbox : Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim() || 'EAAAlkz59O1Z43lX6VjHUgdk0yC11RP6nUfSvFlwaxDdfVDSKQNft6IY53iOls10',
  environment,
})
const giftCardsApi = squareClient.giftCardsApi
const giftCardActivitiesApi = squareClient.giftCardActivitiesApi

const customersToCheck = [
  { name: 'Marina Apostolaki', id: '0MHT1S68NENXGAS2S635FDTQ74', giftCardId: 'gftc:4674c820a9944b68bb46f00a1fa8b816' },
  { name: 'Rahel Tekeste', id: 'P51JT0CJ0RQXEYZFERE67SXEQG', giftCardId: 'gftc:4098e0941da24f83933cba609a01336c' },
  { name: 'Mariele Longfellow', id: 'GE4KAHES1P4DY056MNTVQV3SJ4', giftCardId: 'gftc:4208f51c78e943acbbb6636cd44e4a50' },
  { name: 'Kate Rodgers', id: 'WGKFCXD42JE1QPFBNX5DS2D0NG', giftCardId: 'gftc:4874e982297f40cba6f3224900c31367' }
]

async function analyzeGiftCardTiming() {
  console.log('⏰ Analyzing Gift Card Timing\n')
  console.log('='.repeat(80))
  
  try {
    for (const customerInfo of customersToCheck) {
      console.log(`\n📋 ${customerInfo.name}`)
      console.log('-'.repeat(80))
      
      // 1. Get customer info from database
      const customer = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          gift_card_id,
          gift_card_gan,
          got_signup_bonus,
          used_referral_code,
          first_payment_completed,
          created_at,
          updated_at
        FROM square_existing_clients
        WHERE square_customer_id = ${customerInfo.id}
      `
      
      if (customer && customer.length > 0) {
        const c = customer[0]
        console.log(`   Customer created: ${c.created_at}`)
        console.log(`   Last updated: ${c.updated_at}`)
        console.log(`   Got signup bonus: ${c.got_signup_bonus ? '✅ Yes' : '❌ No'}`)
        console.log(`   First payment completed: ${c.first_payment_completed ? '✅ Yes' : '❌ No'}`)
        console.log(`   Used referral code: ${c.used_referral_code || 'N/A'}`)
        
        const daysSinceCreated = Math.floor((new Date() - new Date(c.created_at)) / (1000 * 60 * 60 * 24))
        console.log(`   Days since created: ${daysSinceCreated} days`)
      }
      
      // 2. Get gift card details from Square
      try {
        const giftCardResponse = await giftCardsApi.retrieveGiftCard(customerInfo.giftCardId)
        const giftCard = giftCardResponse.result.giftCard
        
        if (giftCard) {
          const balanceCents = giftCard.balanceMoney?.amount 
            ? Number(giftCard.balanceMoney.amount)
            : 0
          const balanceDollars = (balanceCents / 100).toFixed(2)
          
          console.log(`\n   💳 Gift Card Details:`)
          console.log(`      GAN: ${giftCard.gan || 'N/A'}`)
          console.log(`      State: ${giftCard.state}`)
          console.log(`      Balance: $${balanceDollars}`)
          console.log(`      Created at: ${giftCard.createdAt || 'N/A'}`)
          
          if (giftCard.createdAt) {
            const daysSinceCardCreated = Math.floor((new Date() - new Date(giftCard.createdAt)) / (1000 * 60 * 60 * 24))
            console.log(`      Days since card created: ${daysSinceCardCreated} days`)
          }
          
          // 3. Get gift card activities to see when it was activated
          try {
            const activitiesResponse = await giftCardActivitiesApi.listGiftCardActivities(customerInfo.giftCardId, {
              limit: 10
            })
            
            const activities = activitiesResponse.result.activities || []
            if (activities.length > 0) {
              console.log(`\n   📜 Gift Card Activities (${activities.length} found):`)
              activities.forEach((activity, idx) => {
                const amount = activity.activateActivityDetails?.amountMoney?.amount 
                  ? Number(activity.activateActivityDetails.amountMoney.amount) / 100
                  : activity.adjustIncrementActivityDetails?.amountMoney?.amount
                  ? Number(activity.adjustIncrementActivityDetails.amountMoney.amount) / 100
                  : activity.adjustDecrementActivityDetails?.amountMoney?.amount
                  ? Number(activity.adjustDecrementActivityDetails.amountMoney.amount) / 100
                  : 0
                
                const activityType = activity.type
                const createdAt = activity.createdAt
                
                console.log(`      ${idx + 1}. ${activityType} - $${amount.toFixed(2)} - ${createdAt}`)
                
                if (activityType === 'ACTIVATE') {
                  const daysSinceActivation = Math.floor((new Date() - new Date(createdAt)) / (1000 * 60 * 60 * 24))
                  console.log(`         ⏰ Activated ${daysSinceActivation} days ago`)
                }
              })
            } else {
              console.log(`\n   ⚠️  No activities found for this gift card`)
            }
          } catch (activityError) {
            console.log(`\n   ⚠️  Could not fetch activities: ${activityError.message}`)
          }
          
          // 4. Analysis
          console.log(`\n   🔍 ANALYSIS:`)
          if (balanceCents === 1000) {
            if (customer && customer.length > 0) {
              const c = customer[0]
              const daysSinceCreated = Math.floor((new Date() - new Date(c.created_at)) / (1000 * 60 * 60 * 24))
              
              if (daysSinceCreated < 1) {
                console.log(`      ✅ Card was just created today - normal that it hasn't been used yet`)
              } else if (daysSinceCreated < 7) {
                console.log(`      ℹ️  Card created ${daysSinceCreated} days ago - customer may not have visited yet`)
              } else if (daysSinceCreated < 30) {
                console.log(`      ⚠️  Card created ${daysSinceCreated} days ago - customer might have forgotten about it`)
              } else {
                console.log(`      ❌ Card created ${daysSinceCreated} days ago - customer likely forgot or didn't receive email`)
              }
            }
            
            console.log(`      Possible reasons for non-use:`)
            console.log(`      1. Customer hasn't made a purchase yet`)
            console.log(`      2. Customer forgot about the gift card`)
            console.log(`      3. Email with gift card details wasn't received`)
            console.log(`      4. Customer doesn't know how to use it`)
            console.log(`      5. Customer is waiting for a specific service/occasion`)
          }
        }
      } catch (error) {
        console.log(`   ❌ Error checking gift card: ${error.message}`)
      }
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ Analysis complete')
    console.log('='.repeat(80))
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

analyzeGiftCardTiming()

