#!/usr/bin/env node
/**
 * Backfill missing gift card records from Square API
 * 
 * This script:
 * 1. Finds customers with gift_card_id in square_existing_clients but missing in gift_cards table
 * 2. Queries Square API for those gift cards
 * 3. Saves them to the database
 * 
 * Usage: node scripts/backfill-missing-gift-cards.js [--days=7] [--dry-run]
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
const giftCardActivitiesApi = squareClient.giftCardActivitiesApi

// Parse command line arguments
const args = process.argv.slice(2)
const daysArg = args.find(arg => arg.startsWith('--days='))
const days = daysArg ? parseInt(daysArg.split('=')[1]) || 7 : 7
const isDryRun = args.includes('--dry-run')

async function getOrganizationId(merchantId) {
  if (!merchantId) {
    // Try to get from environment
    merchantId = process.env.SQUARE_MERCHANT_ID?.trim()
  }
  
  if (!merchantId) {
    console.warn('⚠️ No merchant_id provided and SQUARE_MERCHANT_ID not set')
    return null
  }
  
  try {
    const org = await prisma.organization.findFirst({
      where: { square_merchant_id: merchantId },
      select: { id: true }
    })
    return org?.id || null
  } catch (error) {
    console.error(`Error finding organization for merchant ${merchantId}:`, error.message)
    return null
  }
}

async function saveGiftCardToDatabase(giftCardData) {
  const {
    square_customer_id,
    square_gift_card_id,
    gift_card_gan,
    reward_type,
    initial_amount_cents,
    current_balance_cents,
    gift_card_order_id,
    gift_card_line_item_uid,
    delivery_channel,
    activation_url,
    pass_kit_url,
    digital_email,
    state,
    organization_id
  } = giftCardData

  try {
    // Get organization_id if not provided
    let orgId = organization_id
    if (!orgId) {
      orgId = await getOrganizationId()
      if (!orgId) {
        console.error(`⚠️ Could not resolve organization_id for gift card ${square_gift_card_id}`)
        // Try to get the first organization as fallback
        try {
          const firstOrg = await prisma.organization.findFirst({
            select: { id: true }
          })
          if (firstOrg) {
            console.log(`   ⚠️ Using first organization as fallback: ${firstOrg.id}`)
            orgId = firstOrg.id
          } else {
            return null
          }
        } catch (fallbackError) {
          console.error(`   ❌ Fallback organization lookup failed:`, fallbackError.message)
          return null
        }
      }
    }

    // Upsert gift card record
    const giftCard = await prisma.giftCard.upsert({
      where: { square_gift_card_id },
      update: {
        current_balance_cents,
        delivery_channel,
        activation_url,
        pass_kit_url,
        digital_email,
        state,
        last_balance_check_at: new Date(),
        updated_at: new Date()
      },
      create: {
        organization_id: orgId,
        square_customer_id,
        square_gift_card_id,
        gift_card_gan,
        reward_type,
        initial_amount_cents: initial_amount_cents || 0,
        current_balance_cents: current_balance_cents || 0,
        gift_card_order_id,
        gift_card_line_item_uid,
        delivery_channel,
        activation_url,
        pass_kit_url,
        digital_email,
        state: state || 'PENDING',
        is_active: true
      }
    })

    return giftCard
  } catch (error) {
    console.error('Error saving gift card to database:', error.message)
    throw error
  }
}

async function getGiftCardActivities(giftCardId) {
  // Skip activities for now - we'll use current balance as initial amount fallback
  // The Square SDK API signature is complex and varies by version
  return []
}

async function determineRewardType(customer) {
  // Try to infer reward type from customer data
  if (customer.activated_as_referrer) {
    return 'REFERRER_REWARD'
  }
  if (customer.got_signup_bonus) {
    return 'FRIEND_SIGNUP_BONUS'
  }
  // Default to FRIEND_SIGNUP_BONUS if unclear
  return 'FRIEND_SIGNUP_BONUS'
}

async function findMissingGiftCards(daysBack = 7) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  console.log(`🔍 Finding customers with gift cards created in the last ${daysBack} days...`)
  console.log(`   Cutoff date: ${cutoffDate.toISOString()}\n`)

  // Find customers with gift_card_id but no corresponding gift_cards record
  const customers = await prisma.$queryRaw`
    SELECT 
      sec.square_customer_id,
      sec.given_name,
      sec.family_name,
      sec.email_address,
      sec.gift_card_id,
      sec.gift_card_gan,
      sec.got_signup_bonus,
      sec.activated_as_referrer,
      sec.used_referral_code,
      sec.created_at,
      gc.id as gift_card_db_id
    FROM square_existing_clients sec
    LEFT JOIN gift_cards gc ON gc.square_gift_card_id = sec.gift_card_id
    WHERE 
      sec.gift_card_id IS NOT NULL
      AND sec.gift_card_id != ''
      AND gc.id IS NULL
      AND sec.created_at >= ${cutoffDate}
    ORDER BY sec.created_at DESC
  `

  return customers
}

async function fetchGiftCardFromSquare(giftCardId) {
  try {
    const response = await giftCardsApi.retrieveGiftCard(giftCardId)
    return response.result?.giftCard || null
  } catch (error) {
    console.error(`❌ Failed to fetch gift card ${giftCardId} from Square:`, error.message)
    return null
  }
}

async function processGiftCard(customer) {
  const giftCardId = customer.gift_card_id
  console.log(`\n📦 Processing gift card ${giftCardId} for customer ${customer.square_customer_id}`)
  console.log(`   Customer: ${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown')

  // Fetch from Square
  const squareGiftCard = await fetchGiftCardFromSquare(giftCardId)
  if (!squareGiftCard) {
    console.log(`   ❌ Could not fetch gift card from Square`)
    return { success: false, reason: 'not_found_in_square' }
  }

  // Get activities to determine initial amount
  const activities = await getGiftCardActivities(giftCardId)
  
  // Find CREATE or ACTIVATE activity to get initial amount
  let initialAmountCents = 0
  const createActivity = activities.find(a => a.type === 'CREATE' || a.type === 'ACTIVATE')
  if (createActivity) {
    const amount = createActivity.activateActivityDetails?.amountMoney?.amount ||
                   createActivity.adjustIncrementActivityDetails?.amountMoney?.amount
    if (amount) {
      initialAmountCents = typeof amount === 'bigint' ? Number(amount) : (amount || 0)
    }
  }

  // Get current balance
  const balanceAmount = squareGiftCard.balanceMoney?.amount
  const currentBalanceCents = typeof balanceAmount === 'bigint' 
    ? Number(balanceAmount) 
    : (balanceAmount || 0)

  // If we don't have initial amount from activities, use current balance as fallback
  if (initialAmountCents === 0 && currentBalanceCents > 0) {
    initialAmountCents = currentBalanceCents
  }

  // Determine reward type
  const rewardType = await determineRewardType(customer)

  // Prepare gift card data
  const giftCardData = {
    square_customer_id: customer.square_customer_id,
    square_gift_card_id: giftCardId,
    gift_card_gan: squareGiftCard.gan || customer.gift_card_gan || null,
    reward_type: rewardType,
    initial_amount_cents: initialAmountCents,
    current_balance_cents: currentBalanceCents,
    state: squareGiftCard.state || 'PENDING',
    is_active: squareGiftCard.state === 'ACTIVE'
  }

  console.log(`   ✅ Fetched from Square:`)
  console.log(`      - State: ${giftCardData.state}`)
  console.log(`      - GAN: ${giftCardData.gift_card_gan || 'N/A'}`)
  console.log(`      - Current Balance: $${(giftCardData.current_balance_cents / 100).toFixed(2)}`)
  console.log(`      - Initial Amount: $${(giftCardData.initial_amount_cents / 100).toFixed(2)}`)
  console.log(`      - Reward Type: ${giftCardData.reward_type}`)

  if (isDryRun) {
    console.log(`   🔍 [DRY RUN] Would save to database`)
    return { success: true, reason: 'dry_run', data: giftCardData }
  }

  // Save to database
  try {
    const savedGiftCard = await saveGiftCardToDatabase(giftCardData)
    if (savedGiftCard) {
      console.log(`   ✅ Saved to database (ID: ${savedGiftCard.id})`)
      return { success: true, reason: 'saved', data: savedGiftCard }
    } else {
      console.log(`   ❌ Failed to save to database`)
      return { success: false, reason: 'save_failed' }
    }
  } catch (error) {
    console.error(`   ❌ Error saving to database:`, error.message)
    return { success: false, reason: 'save_error', error: error.message }
  }
}

async function main() {
  console.log('🎁 Backfilling Missing Gift Cards')
  console.log('='.repeat(60))
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will save to database)'}`)
  console.log(`Looking back: ${days} days\n`)

  try {
    // Find missing gift cards
    const customers = await findMissingGiftCards(days)

    if (!customers || customers.length === 0) {
      console.log('✅ No missing gift cards found!')
      return
    }

    console.log(`📊 Found ${customers.length} customer(s) with missing gift card records\n`)

    const results = {
      total: customers.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    }

    // Process each customer
    for (const customer of customers) {
      try {
        const result = await processGiftCard(customer)
        if (result.success) {
          results.success++
        } else if (result.reason === 'not_found_in_square') {
          results.skipped++
        } else {
          results.failed++
          results.errors.push({
            customer_id: customer.square_customer_id,
            gift_card_id: customer.gift_card_id,
            reason: result.reason,
            error: result.error
          })
        }
      } catch (error) {
        results.failed++
        results.errors.push({
          customer_id: customer.square_customer_id,
          gift_card_id: customer.gift_card_id,
          reason: 'exception',
          error: error.message
        })
        console.error(`   ❌ Exception:`, error.message)
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 Summary')
    console.log('='.repeat(60))
    console.log(`Total processed: ${results.total}`)
    console.log(`✅ Success: ${results.success}`)
    console.log(`❌ Failed: ${results.failed}`)
    console.log(`⏭️  Skipped: ${results.skipped}`)

    if (results.errors.length > 0) {
      console.log('\n❌ Errors:')
      results.errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. Customer ${err.customer_id}, Gift Card ${err.gift_card_id}`)
        console.log(`      Reason: ${err.reason}`)
        if (err.error) {
          console.log(`      Error: ${err.error}`)
        }
      })
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

module.exports = { main, findMissingGiftCards, processGiftCard }

