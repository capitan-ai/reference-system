#!/usr/bin/env node
/**
 * Verify Natalia Bijak's gift card balance and check why email wasn't sent
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const giftCardsApi = squareClient.giftCardsApi

const CUSTOMER_ID = '5Q1A2BG073YPWP8G6H0FGQE9VG'
const GIFT_CARD_ID = 'gftc:469e17f9f6f04d649ca31a668fbb23d0'

async function verifyGiftCard() {
  console.log('🔍 Verifying Gift Card Balance for Natalia Bijak')
  console.log('='.repeat(60))
  console.log(`Customer ID: ${CUSTOMER_ID}`)
  console.log(`Gift Card ID: ${GIFT_CARD_ID}`)
  console.log('')

  try {
    // Step 1: Check database
    console.log('📋 Step 1: Database Information')
    const customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        gift_card_id,
        gift_card_gan,
        gift_card_delivery_channel,
        got_signup_bonus,
        used_referral_code
      FROM square_existing_clients
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    
    if (!customer || customer.length === 0) {
      console.log('❌ Customer not found')
      return
    }
    
    const cust = customer[0]
    console.log(`   ✅ Customer: ${cust.given_name} ${cust.family_name}`)
    console.log(`   - Email: ${cust.email_address}`)
    console.log(`   - Gift Card ID: ${cust.gift_card_id}`)
    console.log(`   - GAN: ${cust.gift_card_gan}`)
    console.log(`   - Delivery Channel: ${cust.gift_card_delivery_channel}`)
    console.log('')

    // Step 2: Get gift card from Square API
    console.log('📋 Step 2: Square API - Gift Card Balance')
    try {
      const giftCardResponse = await giftCardsApi.retrieveGiftCard(GIFT_CARD_ID)
      const giftCard = giftCardResponse.result.giftCard

      if (!giftCard) {
        console.log('   ❌ Gift card not found in Square')
        return
      }

      const balanceCents = giftCard.balanceMoney?.amount || 0
      const balance = (balanceCents / 100).toFixed(2)

      console.log(`   ✅ Gift Card Found:`)
      console.log(`      - ID: ${giftCard.id}`)
      console.log(`      - GAN: ${giftCard.gan}`)
      console.log(`      - Balance: $${balance}`)
      console.log(`      - State: ${giftCard.state}`)
      console.log(`      - Type: ${giftCard.type}`)
      console.log('')

      // Check if balance is $10
      if (balanceCents === 1000) {
        console.log('   ✅ Gift card has $10.00 loaded correctly!')
      } else if (balanceCents > 0) {
        console.log(`   ⚠️  Gift card has $${balance} (expected $10.00)`)
      } else {
        console.log('   ❌ Gift card has $0.00 balance!')
      }
      console.log('')

      // Step 3: Get activities
      console.log('📋 Step 3: Gift Card Activities')
      try {
        const activitiesResponse = await giftCardsApi.listGiftCardActivities(
          GIFT_CARD_ID,
          {}
        )

        if (activitiesResponse.result?.giftCardActivities) {
          const activities = activitiesResponse.result.giftCardActivities
          console.log(`   Found ${activities.length} activity/activities:`)
          console.log('')

          activities.forEach((activity, index) => {
            console.log(`   Activity ${index + 1}:`)
            console.log(`      - Type: ${activity.type}`)
            console.log(`      - ID: ${activity.id}`)
            console.log(`      - Created: ${activity.createdAt}`)

            if (activity.activateActivityDetails) {
              const details = activity.activateActivityDetails
              const amount = details.amountMoney?.amount || 0
              console.log(`      - Activation Amount: $${(amount / 100).toFixed(2)}`)
              if (details.orderId) {
                console.log(`      - Order ID: ${details.orderId}`)
              }
              if (details.buyerPaymentInstrumentIds) {
                console.log(`      - Payment Method: ${details.buyerPaymentInstrumentIds.join(', ')}`)
              }
            }

            if (activity.adjustIncrementActivityDetails) {
              const details = activity.adjustIncrementActivityDetails
              const amount = details.amountMoney?.amount || 0
              console.log(`      - Load Amount: $${(amount / 100).toFixed(2)}`)
              console.log(`      - Reason: ${details.reason || 'N/A'}`)
            }

            if (activity.giftCardBalanceMoney) {
              const balance = activity.giftCardBalanceMoney.amount || 0
              console.log(`      - Balance After: $${(balance / 100).toFixed(2)}`)
            }

            console.log('')
          })

          // Summary
          const activationActivity = activities.find(a => a.type === 'ACTIVATE')
          if (activationActivity) {
            const amount = activationActivity.activateActivityDetails?.amountMoney?.amount || 0
            console.log(`   📊 Summary: Gift card was activated with $${(amount / 100).toFixed(2)}`)
          }
        } else {
          console.log('   ⚠️  No activities found')
        }
      } catch (error) {
        console.log(`   ❌ Error fetching activities: ${error.message}`)
      }

    } catch (error) {
      console.log(`   ❌ Error fetching gift card from Square: ${error.message}`)
      if (error.errors) {
        console.log(`   Square API Errors:`, JSON.stringify(error.errors, null, 2))
      }
      return
    }

    // Step 4: Check booking timestamp and run details
    console.log('📋 Step 4: Booking Event Details')
    const run = await prisma.$queryRaw`
      SELECT 
        correlation_id,
        square_event_type,
        stage,
        status,
        payload,
        context,
        created_at,
        updated_at
      FROM giftcard_runs
      WHERE resource_id = ${CUSTOMER_ID}
         OR correlation_id LIKE '%cba3df6c3b49eead38d573af%'
      ORDER BY created_at DESC
      LIMIT 1
    `

    if (run && run.length > 0) {
      const bookingRun = run[0]
      const bookingDate = new Date(bookingRun.created_at)
      console.log(`   ✅ Booking Event Found:`)
      console.log(`      - Correlation ID: ${bookingRun.correlation_id}`)
      console.log(`      - Event Type: ${bookingRun.square_event_type}`)
      console.log(`      - Stage: ${bookingRun.stage}`)
      console.log(`      - Status: ${bookingRun.status}`)
      console.log(`      - Created: ${bookingDate.toISOString()}`)
      console.log(`      - Completed: ${new Date(bookingRun.updated_at).toISOString()}`)
      
      if (bookingRun.payload?.created_at) {
        const bookingTime = new Date(bookingRun.payload.created_at)
        console.log(`      - Booking Time: ${bookingTime.toISOString()}`)
      }
      console.log('')
    }

    // Step 5: Email sending analysis
    console.log('📋 Step 5: Email Sending Analysis')
    console.log(`   Checking why email wasn't sent...`)
    console.log('')
    
    const hasEmail = !!cust.email_address
    const hasGAN = !!cust.gift_card_gan
    const balanceCents = await getBalanceFromSquare()
    
    console.log(`   Preconditions Check:`)
    console.log(`      - Email Address: ${hasEmail ? '✅ Present' : '❌ Missing'}`)
    console.log(`      - Gift Card GAN: ${hasGAN ? '✅ Present' : '❌ Missing'}`)
    console.log(`      - Gift Card Balance: ${balanceCents !== null ? `$${(balanceCents / 100).toFixed(2)}` : '❌ Could not verify'}`)
    console.log('')

    if (!hasEmail) {
      console.log('   ❌ REASON: Email address is missing')
    } else if (!hasGAN) {
      console.log('   ❌ REASON: Gift card GAN is missing')
    } else if (balanceCents !== null && balanceCents === 0) {
      console.log('   ❌ REASON: Gift card balance is $0.00 (amountCents would be 0)')
    } else if (balanceCents !== null && balanceCents > 0) {
      console.log(`   ⚠️  Possible reasons:`)
      console.log(`      1. waitForPassKitUrl timed out (waits up to 5 minutes)`)
      console.log(`      2. Email sending failed silently`)
      console.log(`      3. amountCents parameter was not passed correctly`)
      console.log(`      4. SendGrid API error`)
      console.log(`      5. Notification event creation failed`)
    }

    console.log('')
    console.log('✅ Verification complete!')

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

async function getBalanceFromSquare() {
  try {
    const response = await giftCardsApi.retrieveGiftCard(GIFT_CARD_ID)
    return response.result?.giftCard?.balanceMoney?.amount || null
  } catch (error) {
    return null
  }
}

verifyGiftCard()


