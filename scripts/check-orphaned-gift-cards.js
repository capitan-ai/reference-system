#!/usr/bin/env node
/**
 * Check for orphaned gift cards - gift cards created but customer record not updated
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkOrphanedGiftCards() {
  console.log('🔍 Checking for orphaned gift cards (created but not linked)...\n')
  
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  
  // Find gift cards created in the last hour using Prisma model
  const recentGiftCards = await prisma.giftCard.findMany({
    where: {
      created_at: {
        gte: oneHourAgo
      },
      reward_type: 'FRIEND_SIGNUP_BONUS'
    },
    include: {
      // We'll join manually via raw query since Prisma doesn't have a direct relation
    },
    orderBy: {
      created_at: 'desc'
    },
    take: 20
  })
  
  // Get customer data for each gift card
  const giftCardsWithCustomers = await Promise.all(
    recentGiftCards.map(async (gc) => {
      const customer = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          got_signup_bonus,
          used_referral_code,
          gift_card_id as customer_gift_card_id,
          first_payment_completed,
          updated_at as customer_updated_at
        FROM square_existing_clients
        WHERE square_customer_id = ${gc.square_customer_id}
        LIMIT 1
      `
      return {
        ...gc,
        customer: customer?.[0] || null
      }
    })
  )
  
  console.log(`📊 Found ${giftCardsWithCustomers.length} friend signup bonus gift card(s) created in last hour:\n`)
  
  if (giftCardsWithCustomers.length === 0) {
    console.log('✅ No gift cards created in the last hour.')
  } else {
    for (const gc of giftCardsWithCustomers) {
      const customer = gc.customer
      if (!customer) {
        console.log(`   ⚠️ ORPHANED Gift Card: ${gc.square_gift_card_id}`)
        console.log(`      Customer ID: ${gc.square_customer_id} (customer not found in database)`)
        console.log(`      Gift Card Created At: ${gc.created_at}`)
        console.log('')
        continue
      }
      
      const isOrphaned = !customer.got_signup_bonus || customer.customer_gift_card_id !== gc.square_gift_card_id
      const status = isOrphaned ? '⚠️ ORPHANED' : '✅ LINKED'
      console.log(`   ${status} Gift Card: ${gc.square_gift_card_id}`)
      console.log(`      Customer: ${customer.given_name || 'Unknown'} ${customer.family_name || ''}`)
      console.log(`      Customer ID: ${gc.square_customer_id}`)
      console.log(`      Customer got_signup_bonus: ${customer.got_signup_bonus || false}`)
      console.log(`      Customer gift_card_id: ${customer.customer_gift_card_id || 'NULL'}`)
      console.log(`      Customer used_referral_code: ${customer.used_referral_code || 'NULL'}`)
      console.log(`      Customer first_payment_completed: ${customer.first_payment_completed || false}`)
      console.log(`      Gift Card Created At: ${gc.created_at}`)
      console.log(`      Customer Updated At: ${customer.customer_updated_at || 'N/A'}`)
      console.log('')
    }
  }
  
  await prisma.$disconnect()
}

checkOrphanedGiftCards().catch(console.error)

