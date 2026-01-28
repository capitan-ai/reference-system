#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const giftCardsApi = squareClient.giftCardsApi

const GIFT_CARD_ID = 'gftc:469e17f9f6f04d649ca31a668fbb23d0'

async function checkGiftCard() {
  console.log('🎁 Checking Gift Card via Square API')
  console.log('='.repeat(60))
  console.log(`Gift Card ID: ${GIFT_CARD_ID}`)
  console.log('')

  try {
    // Get gift card details
    console.log('📋 Retrieving gift card from Square...')
    const giftCardResponse = await giftCardsApi.retrieveGiftCard(GIFT_CARD_ID)
    const giftCard = giftCardResponse.result.giftCard

    if (!giftCard) {
      console.log('❌ Gift card not found')
      return
    }

    const balanceCents = giftCard.balanceMoney?.amount || 0
    const balance = (balanceCents / 100).toFixed(2)

    console.log('✅ Gift Card Details:')
    console.log(`   - ID: ${giftCard.id}`)
    console.log(`   - GAN: ${giftCard.gan}`)
    console.log(`   - Balance: $${balance}`)
    console.log(`   - State: ${giftCard.state}`)
    console.log(`   - Type: ${giftCard.type}`)
    console.log('')

    // Check if balance is $10
    if (balanceCents === 1000) {
      console.log('✅ Gift card has $10.00 loaded')
    } else if (balanceCents > 0) {
      console.log(`⚠️ Gift card has $${balance} (expected $10.00)`)
    } else {
      console.log('❌ Gift card has $0.00 balance')
    }
    console.log('')

    // Get activities
    console.log('📋 Gift Card Activities:')
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
          console.log(`      - ID: ${activity.id}`)
          console.log(`      - Type: ${activity.type}`)
          console.log(`      - Created: ${activity.createdAt}`)

          if (activity.activateActivityDetails) {
            const details = activity.activateActivityDetails
            const amount = details.amountMoney?.amount || 0
            console.log(`      - Activation Amount: $${(amount / 100).toFixed(2)}`)
            console.log(`      - Order ID: ${details.orderId || 'N/A'}`)
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

          if (activity.redeemActivityDetails) {
            const details = activity.redeemActivityDetails
            const amount = details.amountMoney?.amount || 0
            console.log(`      - Redeemed Amount: $${(amount / 100).toFixed(2)}`)
            console.log(`      - Payment ID: ${details.paymentId || 'N/A'}`)
          }

          if (activity.giftCardBalanceMoney) {
            const balance = activity.giftCardBalanceMoney.amount || 0
            console.log(`      - Balance After Activity: $${(balance / 100).toFixed(2)}`)
          }

          console.log('')
        })

        // Summary
        const activationActivity = activities.find(a => a.type === 'ACTIVATE')
        const loadActivity = activities.find(a => a.type === 'ADJUST_INCREMENT')
        
        if (activationActivity) {
          const amount = activationActivity.activateActivityDetails?.amountMoney?.amount || 0
          console.log(`📊 Summary: Gift card was activated with $${(amount / 100).toFixed(2)}`)
        } else if (loadActivity) {
          const amount = loadActivity.adjustIncrementActivityDetails?.amountMoney?.amount || 0
          console.log(`📊 Summary: Gift card was loaded with $${(amount / 100).toFixed(2)}`)
        }
      } else {
        console.log('   No activities found')
      }
    } catch (error) {
      console.log(`   ⚠️ Could not fetch activities: ${error.message}`)
      if (error.errors) {
        console.log(`   Square API Errors:`, JSON.stringify(error.errors, null, 2))
      }
    }

    console.log('')
    console.log('✅ Check complete!')

  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.errors) {
      console.error('Square API Errors:', JSON.stringify(error.errors, null, 2))
    }
    console.error(error.stack)
  }
}

checkGiftCard()




