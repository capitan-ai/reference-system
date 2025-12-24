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

async function linkAbyGiftCard() {
  try {
    console.log('🔍 Looking up Aby in database...')
    
    // Find Aby by customer ID
    const abyById = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, gift_card_id, personal_code
      FROM square_existing_clients 
      WHERE square_customer_id = 'Y4BV3AGY3NXYCK63PA4ZA2ZJ14'
    `
    
    if (!abyById || abyById.length === 0) {
      console.log('❌ Aby not found in database')
      return
    }
    
    console.log('✅ Found Aby!')
    await processAby(abyById[0])
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

async function processAby(aby) {
  try {
    console.log('\n🔗 Linking Aby\'s gift card to her profile...')
    console.log(`   Customer ID: ${aby.square_customer_id}`)
    console.log(`   Name: ${aby.given_name} ${aby.family_name}`)
    console.log(`   Gift Card ID: ${aby.gift_card_id}`)
    
    if (!aby.gift_card_id) {
      console.log('❌ No gift card ID found in database for Aby')
      return
    }
    
    // First, verify the gift card exists in Square
    console.log('\n🔍 Step 1: Verifying gift card exists in Square...')
    let giftCard, gan
    try {
      const giftCardResponse = await giftCardsApi.retrieveGiftCard(aby.gift_card_id)
      
      if (giftCardResponse.result.giftCard) {
        giftCard = giftCardResponse.result.giftCard
        gan = giftCard.gan || ''
        console.log('✅ Gift card found in Square!')
        console.log(`   Gift Card ID: ${giftCard.id}`)
        console.log(`   GAN: ${gan}`)
        console.log(`   Balance: $${(giftCard.balanceMoney?.amount || 0) / 100}`)
        console.log(`   State: ${giftCard.state}`)
        console.log(`   Linked Customers: ${giftCard.customerIds?.length || 0}`)
        
        if (giftCard.customerIds && giftCard.customerIds.includes(aby.square_customer_id)) {
          console.log('   ✅ Gift card is already linked to Aby!')
          console.log('   No action needed.')
          return
        } else {
          console.log('   ⚠️ Gift card is NOT linked to Aby yet')
        }
      }
    } catch (error) {
      console.error('❌ Error retrieving gift card:', error.message)
      if (error.errors) {
        console.error('   Square API errors:', JSON.stringify(error.errors, null, 2))
      }
      return
    }
    
    // Link customer to gift card using Square's link-customer API
    console.log('\n🔗 Step 2: Linking Aby to her gift card using Square API...')
    console.log('   Using: POST /v2/gift-cards/{gift_card_id}/link-customer')
    
    try {
      const linkResponse = await giftCardsApi.linkCustomerToGiftCard(aby.gift_card_id, {
        customerId: aby.square_customer_id
      })
      
      if (linkResponse.result && linkResponse.result.giftCard) {
        const updatedGiftCard = linkResponse.result.giftCard
        console.log('✅ Successfully linked Aby to her gift card!')
        console.log(`   Gift Card ID: ${updatedGiftCard.id}`)
        console.log(`   Balance: $${(updatedGiftCard.balanceMoney?.amount || 0) / 100}`)
        console.log(`   Linked Customers: ${updatedGiftCard.customerIds?.length || 0}`)
        
        if (updatedGiftCard.customerIds && updatedGiftCard.customerIds.includes(aby.square_customer_id)) {
          console.log('   ✅ Verified: Aby\'s customer ID is now in the gift card\'s customerIds list!')
        }
        
        // Verify by retrieving the gift card again
        console.log('\n🔍 Step 3: Verifying the link...')
        const verifyResponse = await giftCardsApi.retrieveGiftCard(aby.gift_card_id)
        const verifyGiftCard = verifyResponse.result.giftCard
        
        if (verifyGiftCard.customerIds && verifyGiftCard.customerIds.includes(aby.square_customer_id)) {
          console.log('✅ Verified! Gift card is now linked to Aby\'s profile!')
          console.log('   You should now be able to see the gift card in Aby\'s Square customer profile.')
        }
        
        console.log('\n✅ Success! Aby\'s gift card is now linked to her customer profile!')
        
      } else {
        console.log('❌ Unexpected response from Square API')
        console.log('Response:', JSON.stringify(linkResponse, null, 2))
      }
      
    } catch (error) {
      console.error('❌ Error linking customer to gift card:', error.message)
      if (error.errors) {
        console.error('   Square API errors:', JSON.stringify(error.errors, null, 2))
      }
      
      // Check if it's already linked
      if (error.message && error.message.includes('already')) {
        console.log('   ℹ️ Gift card might already be linked')
      }
    }
    
  } catch (error) {
    console.error('❌ Error processing Aby:', error.message)
    console.error('Stack:', error.stack)
  }
}

linkAbyGiftCard()
