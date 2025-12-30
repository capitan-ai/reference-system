#!/usr/bin/env node
/**
 * Check if new customers have used their $10 gift cards
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { Client, Environment } = require('square')

// Determine environment from access token or env var
const squareEnvironmentName = process.env.SQUARE_ENVIRONMENT || 'production'
const environment = squareEnvironmentName === 'sandbox' ? Environment.Sandbox : Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const giftCardsApi = squareClient.giftCardsApi

const customersToCheck = [
  { name: 'Marina Apostolaki', id: '0MHT1S68NENXGAS2S635FDTQ74', giftCardId: 'gftc:4674c820a9944b68bb46f00a1fa8b816' },
  { name: 'Rahel Tekeste', id: 'P51JT0CJ0RQXEYZFERE67SXEQG', giftCardId: 'gftc:4098e0941da24f83933cba609a01336c' },
  { name: 'Mariele Longfellow', id: 'GE4KAHES1P4DY056MNTVQV3SJ4', giftCardId: 'gftc:4208f51c78e943acbbb6636cd44e4a50' },
  { name: 'Kate Rodgers', id: 'WGKFCXD42JE1QPFBNX5DS2D0NG', giftCardId: 'gftc:4874e982297f40cba6f3224900c31367' }
]

async function checkGiftCardUsage() {
  console.log('💳 Checking Gift Card Usage\n')
  console.log('='.repeat(80))
  
  try {
    for (const customerInfo of customersToCheck) {
      console.log(`\n📋 ${customerInfo.name}`)
      console.log(`   Customer ID: ${customerInfo.id}`)
      console.log(`   Gift Card ID: ${customerInfo.giftCardId}`)
      console.log('-'.repeat(80))
      
      try {
        // Get gift card from Square API
        const response = await giftCardsApi.retrieveGiftCard(customerInfo.giftCardId)
        const giftCard = response.result.giftCard
        
        if (giftCard) {
          // Handle BigInt conversion
          const balanceCents = giftCard.balanceMoney?.amount 
            ? Number(giftCard.balanceMoney.amount)
            : 0
          const balanceDollars = (balanceCents / 100).toFixed(2)
          const state = giftCard.state
          const gan = giftCard.gan
          
          console.log(`   GAN: ${gan || 'N/A'}`)
          console.log(`   State: ${state}`)
          console.log(`   Current Balance: $${balanceDollars}`)
          
          if (balanceCents < 1000) {
            const usedAmount = 1000 - balanceCents
            const usedDollars = (usedAmount / 100).toFixed(2)
            console.log(`   ✅ USED: $${usedDollars} of $10.00`)
            if (balanceCents > 0) {
              console.log(`   Remaining: $${balanceDollars}`)
            } else {
              console.log(`   💰 Fully used!`)
            }
          } else if (balanceCents === 1000) {
            console.log(`   ⚠️  NOT USED: Full $10.00 balance remains`)
          } else {
            console.log(`   ℹ️  Balance: $${balanceDollars} (more than original $10)`)
          }
        } else {
          console.log(`   ❌ Gift card not found in Square`)
        }
      } catch (error) {
        console.log(`   ❌ Error checking gift card: ${error.message}`)
        if (error.errors) {
          error.errors.forEach(err => {
            console.log(`      - ${err.code}: ${err.detail || err.field}`)
          })
        }
      }
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ Check complete')
    console.log('='.repeat(80))
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkGiftCardUsage()

