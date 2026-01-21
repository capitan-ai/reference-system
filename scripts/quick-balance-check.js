#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

const GIFT_CARD_ID = 'gftc:469e17f9f6f04d649ca31a668fbb23d0'

async function checkBalance() {
  try {
    if (!process.env.SQUARE_ACCESS_TOKEN) {
      console.error('❌ SQUARE_ACCESS_TOKEN not found')
      process.exit(1)
    }

    const client = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN.trim(),
      environment: Environment.Production,
    })

    console.log('Checking gift card balance...')
    const response = await client.giftCardsApi.retrieveGiftCard(GIFT_CARD_ID)
    const gc = response.result.giftCard
    
    // Handle BigInt conversion
    const balanceRaw = gc.balanceMoney?.amount || 0
    const balance = typeof balanceRaw === 'bigint' ? Number(balanceRaw) : balanceRaw
    const balanceDollars = (balance / 100).toFixed(2)
    
    console.log(`\n✅ Gift Card Balance: $${balanceDollars}`)
    console.log(`   State: ${gc.state}`)
    console.log(`   GAN: ${gc.gan}`)
    
    if (balance === 1000) {
      console.log(`\n✅ Gift card HAS $10.00 loaded correctly`)
      console.log(`   → Email skip reason is NOT due to balance being $0`)
      console.log(`   → Issue is likely: waitForPassKitUrl timeout or email sending error`)
    } else if (balance === 0) {
      console.log(`\n❌ Gift card balance is $0.00`)
      console.log(`   → This is why email was skipped!`)
      console.log(`   → amountCents check would have been 0 or undefined`)
      console.log(`   → Email function skipped: meaningfulAmount <= 0`)
    } else {
      console.log(`\n⚠️  Unexpected balance: $${balanceDollars}`)
    }
    
    // Check first activity
    try {
      const activities = await client.giftCardsApi.listGiftCardActivities(GIFT_CARD_ID)
      if (activities.result?.giftCardActivities?.length > 0) {
        const first = activities.result.giftCardActivities[0]
        console.log(`\nFirst Activity:`)
        console.log(`   Type: ${first.type}`)
        if (first.activateActivityDetails) {
          const amtRaw = first.activateActivityDetails.amountMoney?.amount || 0
          const amt = typeof amtRaw === 'bigint' ? Number(amtRaw) : amtRaw
          console.log(`   Activation Amount: $${(amt / 100).toFixed(2)}`)
        }
      }
    } catch (activityError) {
      console.log(`\n⚠️ Could not fetch activities: ${activityError.message}`)
    }
    
  } catch (error) {
    console.error('Error:', error.message)
    if (error.errors) {
      console.error('Square API Errors:', JSON.stringify(error.errors, null, 2))
    }
  }
}

checkBalance()

