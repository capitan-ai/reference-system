#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')
const prompts = require('prompts')

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

async function getGiftCardDetails(giftCardId) {
  console.log('🎁 Gift Card Details')
  console.log('=' .repeat(60))
  console.log(`Gift Card ID: ${giftCardId}`)
  console.log('')
  
  try {
    const response = await squareClient.giftCardsApi.retrieveGiftCard(giftCardId)
    const gc = response.result.giftCard
    
    console.log('📊 Gift Card Information:')
    console.log(`   - ID: ${gc.id}`)
    console.log(`   - Type: ${gc.type}`)
    console.log(`   - State: ${gc.state}`)
    console.log(`   - Balance: $${Number(gc.balanceMoney?.amount || 0) / 100}`)
    console.log(`   - Currency: ${gc.balanceMoney?.currency || 'USD'}`)
    
    if (gc.gan) {
      console.log(`   - GAN: ${gc.gan}`)
    }
    
    if (gc.ganSource) {
      console.log(`   - GAN Source: ${gc.ganSource}`)
    }
    
    if (gc.createdAt) {
      console.log(`   - Created At: ${gc.createdAt}`)
    }
    
    if (gc.customerIds && gc.customerIds.length > 0) {
      console.log(`   - Customer IDs: ${gc.customerIds.join(', ')}`)
    }
    
    console.log('')
    console.log('📋 Raw Data (key fields):')
    console.log(`   State: ${gc.state}`)
    console.log(`   Balance Amount (cents): ${gc.balanceMoney?.amount || 0}`)
    console.log(`   Balance (dollars): $${Number(gc.balanceMoney?.amount || 0) / 100}`)
    
    if (gc.state === 'PENDING') {
      console.log('')
      console.log('⚠️  Gift Card Status: PENDING')
      console.log('   This means the gift card was created but not yet activated.')
      console.log('   The balance will be $0 until it is activated.')
    } else if (gc.state === 'ACTIVE') {
      console.log('')
      console.log('✅ Gift Card Status: ACTIVE')
      if (Number(gc.balanceMoney?.amount || 0) === 0) {
        console.log('   ⚠️  Balance is $0 - gift card may need to be loaded')
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.errors) {
      console.error('Square API Errors:', JSON.stringify(error.errors, null, 2))
    }
  }
}

async function main() {
  let giftCardId = process.argv[2]

  if (!giftCardId) {
    console.log('🔍 No gift card ID provided. You can enter either:')
    console.log('   • Full Square gift card ID (starts with gftc:)')
    console.log('   • Gift card number / GAN (digits)')
    console.log('')

    const response = await prompts({
      type: 'text',
      name: 'value',
      message: 'Enter Gift Card ID or GAN:'
    })

    giftCardId = response.value?.trim()
  }

  if (!giftCardId) {
    console.error('❌ Gift card ID or number is required.')
    process.exit(1)
  }

  await getGiftCardDetails(giftCardId)
}

main()





