#!/usr/bin/env node
/**
 * Check exact timing of gift card issuance
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

async function checkGiftCardIssueTiming() {
  console.log('🎁 Gift Card Issue Timing Analysis\n')
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
          created_at,
          updated_at
        FROM square_existing_clients
        WHERE square_customer_id = ${customerInfo.id}
      `
      
      if (customer && customer.length > 0) {
        const c = customer[0]
        console.log(`\n1️⃣ DATABASE INFO:`)
        console.log(`   Customer created: ${c.created_at}`)
        console.log(`   Got signup bonus: ${c.got_signup_bonus ? '✅ Yes' : '❌ No'}`)
        console.log(`   Gift card ID: ${c.gift_card_id || 'N/A'}`)
        console.log(`   Gift card GAN: ${c.gift_card_gan || 'N/A'}`)
      }
      
      // 2. Get gift card from Square
      try {
        const giftCardResponse = await giftCardsApi.retrieveGiftCard(customerInfo.giftCardId)
        const giftCard = giftCardResponse.result.giftCard
        
        if (giftCard) {
          console.log(`\n2️⃣ SQUARE GIFT CARD INFO:`)
          console.log(`   GAN: ${giftCard.gan || 'N/A'}`)
          console.log(`   State: ${giftCard.state}`)
          console.log(`   Created at: ${giftCard.createdAt || 'N/A'}`)
          
          if (giftCard.createdAt) {
            const createdDate = new Date(giftCard.createdAt)
            console.log(`   Created: ${createdDate.toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`)
          }
        }
        
        // 3. Get gift card activities
        try {
          const activitiesResponse = await giftCardActivitiesApi.listGiftCardActivities(
            customerInfo.giftCardId,
            'ACTIVATE'  // Filter by type
          )
          
          const activities = activitiesResponse.result.activities || []
          
          if (activities.length > 0) {
            console.log(`\n3️⃣ GIFT CARD ACTIVATION:`)
            activities.forEach((activity, idx) => {
              if (activity.type === 'ACTIVATE') {
                const activateDetails = activity.activateActivityDetails
                const amount = activateDetails?.amountMoney?.amount 
                  ? Number(activateDetails.amountMoney.amount) / 100
                  : 0
                const createdAt = activity.createdAt
                const createdDate = new Date(createdAt)
                
                console.log(`   ${idx + 1}. ACTIVATED:`)
                console.log(`      Amount: $${amount.toFixed(2)}`)
                console.log(`      Created at: ${createdAt}`)
                console.log(`      Created: ${createdDate.toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`)
                
                if (customer && customer.length > 0) {
                  const c = customer[0]
                  const customerCreated = new Date(c.created_at)
                  const timeDiff = Math.round((createdDate - customerCreated) / 1000 / 60)
                  console.log(`      Time after customer created: ${timeDiff} minutes`)
                }
              }
            })
          } else {
            // Try to get all activities
            const allActivitiesResponse = await giftCardActivitiesApi.listGiftCardActivities(
              customerInfo.giftCardId
            )
            const allActivities = allActivitiesResponse.result.activities || []
            
            if (allActivities.length > 0) {
              console.log(`\n3️⃣ GIFT CARD ACTIVITIES (${allActivities.length} found):`)
              allActivities.forEach((activity, idx) => {
                const activityType = activity.type
                const createdAt = activity.createdAt
                const createdDate = new Date(createdAt)
                
                let amount = 0
                if (activity.activateActivityDetails?.amountMoney?.amount) {
                  amount = Number(activity.activateActivityDetails.amountMoney.amount) / 100
                } else if (activity.adjustIncrementActivityDetails?.amountMoney?.amount) {
                  amount = Number(activity.adjustIncrementActivityDetails.amountMoney.amount) / 100
                } else if (activity.adjustDecrementActivityDetails?.amountMoney?.amount) {
                  amount = Number(activity.adjustDecrementActivityDetails.amountMoney.amount) / 100
                }
                
                console.log(`   ${idx + 1}. ${activityType}:`)
                if (amount > 0) {
                  console.log(`      Amount: $${amount.toFixed(2)}`)
                }
                console.log(`      Created: ${createdDate.toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`)
                
                if (activityType === 'ACTIVATE') {
                  if (customer && customer.length > 0) {
                    const c = customer[0]
                    const customerCreated = new Date(c.created_at)
                    const timeDiff = Math.round((createdDate - customerCreated) / 1000 / 60)
                    console.log(`      ⏰ ${timeDiff} minutes after customer created`)
                  }
                }
              })
            } else {
              console.log(`\n3️⃣ ⚠️  No activities found`)
            }
          }
        } catch (activityError) {
          console.log(`\n3️⃣ ⚠️  Could not fetch activities: ${activityError.message}`)
        }
        
        // 4. Check booking timing
        const bookingRuns = await prisma.$queryRaw`
          SELECT 
            correlation_id,
            created_at,
            payload
          FROM giftcard_runs
          WHERE square_event_type = 'booking.created'
            AND context::text LIKE ${`%${customerInfo.id}%`}
          ORDER BY created_at ASC
          LIMIT 1
        `
        
        if (bookingRuns && bookingRuns.length > 0) {
          const booking = bookingRuns[0]
          const bookingDate = new Date(booking.created_at)
          
          console.log(`\n4️⃣ BOOKING TIMING:`)
          console.log(`   Booking created: ${bookingDate.toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`)
          
          if (giftCard && giftCard.createdAt) {
            const giftCardDate = new Date(giftCard.createdAt)
            const timeDiff = Math.round((giftCardDate - bookingDate) / 1000 / 60)
            console.log(`   Gift card created: ${giftCardDate.toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`)
            console.log(`   ⏰ Gift card issued ${timeDiff} minutes after booking`)
            
            if (timeDiff < 5) {
              console.log(`   ✅ Gift card issued IMMEDIATELY after booking (friend reward)`)
            } else if (timeDiff < 60) {
              console.log(`   ℹ️  Gift card issued within 1 hour after booking`)
            } else {
              console.log(`   ⚠️  Gift card issued more than 1 hour after booking`)
            }
          }
        }
        
      } catch (error) {
        console.log(`\n❌ Error checking gift card: ${error.message}`)
        if (error.errors) {
          error.errors.forEach(err => {
            console.log(`   - ${err.code}: ${err.detail || err.field}`)
          })
        }
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

checkGiftCardIssueTiming()

