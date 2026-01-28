#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

const GIFT_CARD_ID = 'gftc:469e17f9f6f04d649ca31a668fbb23d0'

async function quickCheck() {
  try {
    const client = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
      environment: Environment.Production,
    })
    
    console.log('Checking gift card balance...')
    const response = await client.giftCardsApi.retrieveGiftCard(GIFT_CARD_ID)
    const gc = response.result.giftCard
    
    const balanceCents = gc.balanceMoney?.amount || 0
    const balance = (balanceCents / 100).toFixed(2)
    
    console.log(`\n✅ Gift Card Balance: $${balance}`)
    console.log(`   - GAN: ${gc.gan}`)
    console.log(`   - State: ${gc.state}`)
    console.log(`   - Type: ${gc.type}`)
    
    if (balanceCents === 1000) {
      console.log(`\n✅ Gift card has $10.00 loaded correctly!`)
    } else if (balanceCents > 0) {
      console.log(`\n⚠️  Gift card has $${balance} (expected $10.00)`)
    } else {
      console.log(`\n❌ Gift card has $0.00 balance!`)
    }
    
    // Get activities
    const activities = await client.giftCardsApi.listGiftCardActivities(GIFT_CARD_ID, {})
    if (activities.result?.giftCardActivities?.length > 0) {
      const act = activities.result.giftCardActivities[0]
      console.log(`\nFirst Activity:`)
      console.log(`   - Type: ${act.type}`)
      console.log(`   - Created: ${act.createdAt}`)
      if (act.activateActivityDetails) {
        const amount = act.activateActivityDetails.amountMoney?.amount || 0
        console.log(`   - Amount: $${(amount / 100).toFixed(2)}`)
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message)
    if (error.errors) {
      console.error('Square API Errors:', JSON.stringify(error.errors, null, 2))
    }
  }
}

quickCheck()




