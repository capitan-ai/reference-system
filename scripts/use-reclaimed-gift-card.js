#!/usr/bin/env node
/**
 * Use a reclaimed gift card for a referrer reward
 * This script allows you to use cards that were reclaimed from self-referrals
 */

require('dotenv').config()
const fs = require('fs').promises
const path = require('path')
const prisma = require('../lib/prisma-client')
const { loadGiftCard } = require('../lib/webhooks/giftcard-processors')

async function listReclaimedCards() {
  const reclaimedCardsFile = path.join(__dirname, '..', 'reclaimed-gift-cards.json')
  
  try {
    const data = await fs.readFile(reclaimedCardsFile, 'utf8')
    const cards = JSON.parse(data)
    return cards.filter(card => card.balance > 0) // Only cards with balance
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function useReclaimedCardForReferrer(referrerCustomerId, reclaimedCardId) {
  try {
    const reclaimedCardsFile = path.join(__dirname, '..', 'reclaimed-gift-cards.json')
    const data = await fs.readFile(reclaimedCardsFile, 'utf8')
    const cards = JSON.parse(data)
    
    const card = cards.find(c => c.giftCardId === reclaimedCardId)
    if (!card) {
      return { success: false, error: 'Reclaimed card not found' }
    }
    
    if (card.balance === 0) {
      return { success: false, error: 'Card has $0 balance' }
    }
    
    // Get referrer info
    const referrer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        gift_card_id,
        total_referrals,
        total_rewards
      FROM square_existing_clients
      WHERE square_customer_id = ${referrerCustomerId}
    `
    
    if (!referrer || referrer.length === 0) {
      return { success: false, error: 'Referrer not found' }
    }
    
    const referrerData = referrer[0]
    const referrerName = `${referrerData.given_name || ''} ${referrerData.family_name || ''}`.trim()
    
    console.log(`\n💰 Using reclaimed card for referrer reward`)
    console.log(`   Referrer: ${referrerName} (${referrerCustomerId})`)
    console.log(`   Reclaimed card: ${card.giftCardId}`)
    console.log(`   Card balance: $${(card.balance / 100).toFixed(2)}`)
    console.log(`   Card GAN: ${card.gan}`)
    
    if (!referrerData.gift_card_id) {
      // Referrer doesn't have a card - we can't use the reclaimed card directly
      // We need to load the balance onto a new card or existing card
      // For now, we'll create a new card and load the balance
      console.log(`   ⚠️  Referrer doesn't have a gift card yet`)
      console.log(`   💡 You need to create a gift card first, then load the reclaimed balance`)
      return { success: false, error: 'Referrer needs a gift card first' }
    }
    
    // Load the reclaimed card balance onto referrer's existing card
    console.log(`   🔄 Loading $${(card.balance / 100).toFixed(2)} onto referrer's card...`)
    const loadResult = await loadGiftCard(
      referrerData.gift_card_id,
      card.balance,
      referrerCustomerId,
      `Reclaimed gift card from self-referral (${card.customerName})`,
      { idempotencyKeySeed: `reclaimed-${reclaimedCardId}-${Date.now()}` }
    )
    
    if (loadResult.success) {
      // Update referrer stats
      await prisma.$executeRaw`
        UPDATE square_existing_clients
        SET 
          total_rewards = COALESCE(total_rewards, 0) + ${card.balance},
          gift_card_gan = ${loadResult.giftCardGan ?? referrerData.gift_card_gan ?? null},
          gift_card_delivery_channel = ${loadResult.deliveryChannel ?? null},
          gift_card_activation_url = ${loadResult.activationUrl ?? null},
          gift_card_pass_kit_url = ${loadResult.passKitUrl ?? null},
          gift_card_digital_email = ${loadResult.digitalEmail ?? null},
          updated_at = NOW()
        WHERE square_customer_id = ${referrerCustomerId}
      `
      
      // Mark card as used
      card.used = true
      card.usedAt = new Date().toISOString()
      card.usedForReferrer = referrerCustomerId
      card.usedForReferrerName = referrerName
      
      await fs.writeFile(reclaimedCardsFile, JSON.stringify(cards, null, 2), 'utf8')
      
      console.log(`   ✅ Successfully loaded $${(card.balance / 100).toFixed(2)} onto referrer's card`)
      console.log(`   ✅ Updated referrer rewards: +$${(card.balance / 100).toFixed(2)}`)
      console.log(`   ✅ Marked reclaimed card as used`)
      
      return { success: true, loadResult, card }
    } else {
      return { success: false, error: loadResult.error || 'Failed to load gift card' }
    }
    
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function showReclaimedCards() {
  console.log('📋 Reclaimed Gift Cards\n')
  console.log('='.repeat(80))
  
  const cards = await listReclaimedCards()
  
  if (cards.length === 0) {
    console.log('No reclaimed cards available.')
    return
  }
  
  const availableCards = cards.filter(c => !c.used && c.balance > 0)
  const usedCards = cards.filter(c => c.used)
  
  console.log(`\n✅ Available cards: ${availableCards.length}`)
  console.log(`📦 Total balance available: $${(availableCards.reduce((sum, c) => sum + c.balance, 0) / 100).toFixed(2)}`)
  
  if (availableCards.length > 0) {
    console.log(`\n📋 Available Cards:\n`)
    availableCards.forEach((card, idx) => {
      console.log(`${idx + 1}. Card ID: ${card.giftCardId}`)
      console.log(`   GAN: ${card.gan}`)
      console.log(`   Balance: $${(card.balance / 100).toFixed(2)}`)
      console.log(`   From: ${card.customerName} (${card.customerEmail})`)
      console.log(`   Reclaimed: ${card.reclaimedAt}`)
      console.log(`   Reason: ${card.reason}`)
      console.log('')
    })
  }
  
  if (usedCards.length > 0) {
    console.log(`\n📋 Used Cards: ${usedCards.length}\n`)
    usedCards.forEach((card, idx) => {
      console.log(`${idx + 1}. Card ID: ${card.giftCardId}`)
      console.log(`   Balance was: $${(card.balance / 100).toFixed(2)}`)
      console.log(`   Used for: ${card.usedForReferrerName || card.usedForReferrer}`)
      console.log(`   Used at: ${card.usedAt}`)
      console.log('')
    })
  }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  
  if (args[0] === 'list' || args.length === 0) {
    showReclaimedCards()
      .then(() => process.exit(0))
      .catch(error => {
        console.error('Error:', error)
        process.exit(1)
      })
  } else if (args[0] === 'use' && args.length >= 3) {
    const referrerId = args[1]
    const cardId = args[2]
    
    useReclaimedCardForReferrer(referrerId, cardId)
      .then(result => {
        if (result.success) {
          console.log('\n✅ Success!')
          process.exit(0)
        } else {
          console.error(`\n❌ Error: ${result.error}`)
          process.exit(1)
        }
      })
      .catch(error => {
        console.error('Fatal error:', error)
        process.exit(1)
      })
  } else {
    console.log('Usage:')
    console.log('  node scripts/use-reclaimed-gift-card.js list')
    console.log('  node scripts/use-reclaimed-gift-card.js use <referrer_customer_id> <reclaimed_card_id>')
    process.exit(1)
  }
}

module.exports = { listReclaimedCards, useReclaimedCardForReferrer, showReclaimedCards }





