#!/usr/bin/env node
/**
 * Revert self-referral bonuses
 * This script attempts to reverse gift cards and bonuses given to customers
 * who used their own referral codes
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { Client, Environment } = require('square')
const { getSquareEnvironmentName } = require('../lib/utils/square-env')

const squareEnvironmentName = getSquareEnvironmentName()
const environment = squareEnvironmentName === 'sandbox' ? Environment.Sandbox : Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const giftCardsApi = squareClient.giftCardsApi
const giftCardActivitiesApi = squareClient.giftCardActivitiesApi

async function checkGiftCardBalance(giftCardId) {
  try {
    if (!giftCardId) return null
    const response = await giftCardsApi.retrieveGiftCard(giftCardId)
    const giftCard = response.result?.giftCard
    if (giftCard) {
      const balanceAmount = giftCard.balanceMoney?.amount || 0
      const balance = typeof balanceAmount === 'bigint' 
        ? Number(balanceAmount) 
        : Number(balanceAmount)
      
      return {
        id: giftCard.id,
        gan: giftCard.gan,
        state: giftCard.state,
        balance: balance,
        currency: giftCard.balanceMoney?.currency || 'USD'
      }
    }
    return null
  } catch (error) {
    console.error(`   ❌ Error checking gift card ${giftCardId}:`, error.message)
    return null
  }
}

async function deactivateGiftCard(giftCardId, reason = 'Self-referral reversal', mode = 'database_only') {
  try {
    const cardInfo = await checkGiftCardBalance(giftCardId)
    if (!cardInfo) {
      return { success: false, error: 'Could not retrieve card info' }
    }
    
    if (cardInfo.balance === 0) {
      return { success: true, message: 'Card already has $0 balance (may have been used)', cardInfo }
    }
    
    // IMPORTANT: We have two modes:
    // 1. 'database_only' - Just mark in database, don't touch the card (RECOMMENDED - no money loss)
    // 2. 'redeem' - Actually redeem the card (money is lost, not returned)
    
    if (mode === 'database_only') {
      // Don't touch the card - just return info
      // The database will be updated separately to remove references
      return { 
        success: true, 
        message: `Card balance: $${(cardInfo.balance / 100).toFixed(2)} - marked in database only (card not touched)`,
        cardInfo,
        mode: 'database_only'
      }
    }
    
    // Mode: 'redeem' - Actually redeem the card (WARNING: Money is lost!)
    if (mode === 'redeem') {
      const locationId = process.env.SQUARE_LOCATION_ID?.trim()
      if (!locationId) {
        return { success: false, error: 'SQUARE_LOCATION_ID not set' }
      }
      
      try {
        // WARNING: REDEEM activity will zero out the balance but money is NOT returned!
        // This means you lose the money permanently
        const redeemActivity = {
          idempotencyKey: `revert-self-ref-${giftCardId}-${Date.now()}`,
          giftCardActivity: {
            type: 'REDEEM',
            giftCardId: giftCardId,
            redeemActivityDetails: {
              amountMoney: {
                amount: cardInfo.balance,
                currency: cardInfo.currency
              }
            },
            locationId: locationId
          }
        }
        
        const response = await giftCardActivitiesApi.createGiftCardActivity(redeemActivity)
        if (response.result?.giftCardActivity) {
          return { 
            success: true, 
            message: `⚠️ REDEEMED $${(cardInfo.balance / 100).toFixed(2)} from card (money is LOST, not returned!)`,
            cardInfo,
            activity: response.result.giftCardActivity,
            mode: 'redeem'
          }
        }
      } catch (activityError) {
        return { 
          success: false, 
          error: `Could not redeem card: ${activityError.message}`,
          cardInfo 
        }
      }
    }
    
    return { success: false, error: 'Unknown error' }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function saveReclaimedCard(cardInfo, customerData) {
  const fs = require('fs').promises
  const path = require('path')
  
  const reclaimedCardsFile = path.join(__dirname, '..', 'reclaimed-gift-cards.json')
  
  try {
    let reclaimedCards = []
    try {
      const data = await fs.readFile(reclaimedCardsFile, 'utf8')
      reclaimedCards = JSON.parse(data)
    } catch (e) {
      // File doesn't exist yet, start with empty array
    }
    
    const reclaimedCard = {
      giftCardId: cardInfo.id,
      gan: cardInfo.gan,
      balance: cardInfo.balance,
      currency: cardInfo.currency,
      state: cardInfo.state,
      customerId: customerData.square_customer_id,
      customerName: `${customerData.given_name || ''} ${customerData.family_name || ''}`.trim(),
      customerEmail: customerData.email_address,
      usedCode: customerData.used_referral_code,
      personalCode: customerData.personal_code,
      reclaimedAt: new Date().toISOString(),
      reason: 'Self-referral reversal'
    }
    
    reclaimedCards.push(reclaimedCard)
    
    await fs.writeFile(reclaimedCardsFile, JSON.stringify(reclaimedCards, null, 2), 'utf8')
    
    return reclaimedCard
  } catch (error) {
    console.error(`   ⚠️  Error saving reclaimed card: ${error.message}`)
    return null
  }
}

async function revertSelfReferral(customerId, dryRun = false) {
  try {
    console.log(`\n🔄 Processing self-referral reversal for: ${customerId}`)
    
    // Get customer data
    const customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        used_referral_code,
        personal_code,
        first_payment_completed,
        got_signup_bonus,
        gift_card_id,
        gift_card_gan,
        gift_card_order_id,
        gift_card_line_item_uid,
        gift_card_delivery_channel,
        gift_card_activation_url,
        gift_card_pass_kit_url,
        gift_card_digital_email,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE square_customer_id = ${customerId}
    `
    
    if (!customer || customer.length === 0) {
      return { success: false, error: 'Customer not found' }
    }
    
    const customerData = customer[0]
    const customerName = `${customerData.given_name || ''} ${customerData.family_name || ''}`.trim()
    
    console.log(`   Customer: ${customerName}`)
    console.log(`   Used code: ${customerData.used_referral_code}`)
    console.log(`   Personal code: ${customerData.personal_code}`)
    console.log(`   Got signup bonus: ${customerData.got_signup_bonus ? '✅ Yes' : '❌ No'}`)
    console.log(`   Gift card ID: ${customerData.gift_card_id || 'N/A'}`)
    
    if (!customerData.gift_card_id) {
      console.log(`   ⚠️  No gift card to revert`)
      // Still update database to remove the self-referral flag
      if (!dryRun) {
        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET 
            used_referral_code = NULL,
            got_signup_bonus = FALSE,
            updated_at = NOW()
          WHERE square_customer_id = ${customerId}
        `
        console.log(`   ✅ Updated database: removed self-referral flags`)
      }
      return { success: true, message: 'No gift card to revert, database updated' }
    }
    
    // Check gift card balance
    console.log(`   💳 Checking gift card balance...`)
    const cardInfo = await checkGiftCardBalance(customerData.gift_card_id)
    
    if (!cardInfo) {
      return { success: false, error: 'Could not retrieve gift card information' }
    }
    
    console.log(`   Balance: $${(cardInfo.balance / 100).toFixed(2)} ${cardInfo.currency}`)
    console.log(`   State: ${cardInfo.state}`)
    
    if (cardInfo.balance === 0) {
      console.log(`   ⚠️  Card already has $0 balance (may have been used)`)
      // Still update database
      if (!dryRun) {
        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET 
            used_referral_code = NULL,
            got_signup_bonus = FALSE,
            gift_card_id = NULL,
            gift_card_gan = NULL,
            gift_card_order_id = NULL,
            gift_card_line_item_uid = NULL,
            gift_card_delivery_channel = NULL,
            gift_card_activation_url = NULL,
            gift_card_pass_kit_url = NULL,
            gift_card_digital_email = NULL,
            updated_at = NOW()
          WHERE square_customer_id = ${customerId}
        `
        console.log(`   ✅ Updated database: removed self-referral flags`)
      }
      return { success: true, message: 'Card already at $0, database updated' }
    }
    
    if (cardInfo.state !== 'ACTIVE') {
      return { success: false, error: `Card is not ACTIVE (state: ${cardInfo.state}), cannot revert` }
    }
    
    if (!dryRun) {
      // Step 1: Save old card information for future use
      console.log(`   💾 Saving old card information...`)
      const savedCard = await saveReclaimedCard(cardInfo, customerData)
      if (savedCard) {
        console.log(`   ✅ Saved card to reclaimed-gift-cards.json`)
        console.log(`      Card ID: ${savedCard.giftCardId}`)
        console.log(`      Balance: $${(savedCard.balance / 100).toFixed(2)}`)
        console.log(`      GAN: ${savedCard.gan}`)
      }
      
      // Step 2: Create new empty gift card for customer
      console.log(`   🆕 Creating new empty gift card for customer...`)
      const { createGiftCard } = require('../lib/webhooks/giftcard-processors')
      
      const newCard = await createGiftCard(
        customerId,
        customerName,
        0, // $0 balance - empty card
        false, // not a referrer card
        {
          idempotencyKeySeed: `revert-replacement-${customerId}-${Date.now()}`
        }
      )
      
      if (!newCard || !newCard.giftCardId) {
        return { success: false, error: 'Failed to create new empty gift card' }
      }
      
      console.log(`   ✅ Created new empty gift card: ${newCard.giftCardId}`)
      
      // Step 3: Update database - remove old card, set new empty card, remove self-referral flags
      await prisma.$executeRaw`
        UPDATE square_existing_clients
        SET 
          used_referral_code = NULL,
          got_signup_bonus = FALSE,
          gift_card_id = ${newCard.giftCardId},
          gift_card_gan = ${newCard.giftCardGan ?? null},
          gift_card_order_id = ${newCard.orderId ?? null},
          gift_card_line_item_uid = ${newCard.lineItemUid ?? null},
          gift_card_delivery_channel = ${newCard.activationChannel ?? null},
          gift_card_activation_url = ${newCard.activationUrl ?? null},
          gift_card_pass_kit_url = ${newCard.passKitUrl ?? null},
          gift_card_digital_email = ${newCard.digitalEmail ?? null},
          updated_at = NOW()
        WHERE square_customer_id = ${customerId}
      `
      console.log(`   ✅ Updated database:`)
      console.log(`      - Removed self-referral flags`)
      console.log(`      - Removed old card references`)
      console.log(`      - Set new empty card (${newCard.giftCardId})`)
      
      return { 
        success: true, 
        message: `Replaced old card with new empty card. Old card saved for future use.`,
        oldCard: cardInfo,
        newCard: newCard,
        savedCard: savedCard
      }
    } else {
      console.log(`   🔍 DRY RUN: Would:`)
      console.log(`      1. Save old card (ID: ${cardInfo.id}, Balance: $${(cardInfo.balance / 100).toFixed(2)}) to reclaimed-gift-cards.json`)
      console.log(`      2. Create new empty gift card for customer`)
      console.log(`      3. Update database to remove self-referral flags and replace card`)
      return { success: true, message: 'Dry run - would revert', cardInfo }
    }
    
  } catch (error) {
    console.error(`   ❌ Error reverting self-referral:`, error.message)
    return { success: false, error: error.message }
  }
}

async function revertAllSelfReferrals(dryRun = false) {
  console.log('🔄 Reverting Self-Referral Bonuses\n')
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n')
  }
  console.log('='.repeat(80))
  
  try {
    // Find all self-referrals
    const selfReferrals = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        used_referral_code,
        personal_code,
        first_payment_completed,
        got_signup_bonus,
        gift_card_id
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
        AND UPPER(TRIM(used_referral_code)) = UPPER(TRIM(personal_code))
        AND got_signup_bonus = TRUE
    `
    
    if (!selfReferrals || selfReferrals.length === 0) {
      console.log('\n✅ No self-referrals with bonuses found.')
      return { reverted: 0, failed: 0, skipped: 0 }
    }
    
    console.log(`\n📋 Found ${selfReferrals.length} self-referrals with bonuses:\n`)
    
    let reverted = 0
    let failed = 0
    const results = []
    
    for (const customer of selfReferrals) {
      const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim()
      console.log(`\n${'='.repeat(80)}`)
      console.log(`\n📋 ${customerName} (${customer.square_customer_id})`)
      
      const result = await revertSelfReferral(customer.square_customer_id, dryRun)
      
      if (result.success) {
        reverted++
        results.push({ customer, result: 'success', message: result.message })
      } else {
        failed++
        results.push({ customer, result: 'failed', error: result.error })
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    console.log(`\n${'='.repeat(80)}`)
    console.log(`\n📊 Summary:`)
    console.log(`   ✅ Successfully reverted: ${reverted}`)
    console.log(`   ❌ Failed: ${failed}`)
    console.log(`   📋 Total processed: ${selfReferrals.length}`)
    
    if (failed > 0) {
      console.log(`\n⚠️  Failed reversals:`)
      results.filter(r => r.result === 'failed').forEach((item, idx) => {
        const name = `${item.customer.given_name || ''} ${item.customer.family_name || ''}`.trim()
        console.log(`   ${idx + 1}. ${name}: ${item.error}`)
      })
    }
    
    return { reverted, failed, skipped: 0, results }
    
  } catch (error) {
    console.error('\n❌ Error reverting self-referrals:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-d')
  
  revertAllSelfReferrals(dryRun)
    .then(({ reverted, failed, skipped }) => {
      if (dryRun) {
        console.log(`\n✅ Dry run complete. Would revert ${skipped} self-referrals.`)
        console.log(`\n💡 Run without --dry-run to actually revert`)
      } else {
        console.log(`\n✅ Complete. Reverted ${reverted} self-referrals, ${failed} failed.`)
      }
      process.exit(failed > 0 ? 1 : 0)
    })
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { revertAllSelfReferrals, revertSelfReferral }

