#!/usr/bin/env node

/**
 * Migration script to move gift card data from square_existing_clients
 * to the new normalized gift_cards and gift_card_transactions tables
 * 
 * Usage:
 *   node scripts/migrate-gift-cards-to-new-tables.js
 *   DRY_RUN=true node scripts/migrate-gift-cards-to-new-tables.js  # Preview only
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const DRY_RUN = process.env.DRY_RUN === 'true'

async function migrateGiftCards() {
  console.log('🚀 Starting Gift Card Data Migration')
  console.log('='.repeat(60))
  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n')
  }
  console.log()

  try {
    // Step 1: Find all customers with gift cards
    console.log('📊 Step 1: Finding customers with gift cards...')
    const customersWithGiftCards = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        gift_card_id,
        gift_card_gan,
        gift_card_order_id,
        gift_card_line_item_uid,
        gift_card_delivery_channel,
        gift_card_activation_url,
        gift_card_pass_kit_url,
        gift_card_digital_email,
        got_signup_bonus,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE gift_card_id IS NOT NULL
      ORDER BY created_at DESC
    `

    console.log(`   Found ${customersWithGiftCards.length} customers with gift cards\n`)

    if (customersWithGiftCards.length === 0) {
      console.log('✅ No gift cards to migrate')
      return
    }

    // Step 2: Check which gift cards already exist in new table
    console.log('🔍 Step 2: Checking existing records in gift_cards table...')
    const existingGiftCards = await prisma.giftCard.findMany({
      select: {
        square_gift_card_id: true
      }
    })
    const existingGiftCardIds = new Set(existingGiftCards.map(gc => gc.square_gift_card_id))
    console.log(`   Found ${existingGiftCardIds.size} existing gift cards in new table\n`)

    // Step 3: Migrate gift cards
    console.log('📦 Step 3: Migrating gift card data...\n')
    
    let migrated = 0
    let skipped = 0
    let errors = 0
    const errorDetails = []

    for (let i = 0; i < customersWithGiftCards.length; i++) {
      const customer = customersWithGiftCards[i]
      
      // Skip if already migrated
      if (existingGiftCardIds.has(customer.gift_card_id)) {
        skipped++
        if (i < 10 || i % 100 === 0) {
          console.log(`   ⏭️  Skipped (already exists): ${customer.square_customer_id}`)
        }
        continue
      }

      try {
        // Determine reward type
        // If got_signup_bonus is true, it's likely a friend bonus
        // Otherwise, it's likely a referrer reward
        const rewardType = customer.got_signup_bonus ? 'FRIEND_SIGNUP_BONUS' : 'REFERRER_REWARD'

        if (!DRY_RUN) {
          // Create gift card record
          const giftCard = await prisma.giftCard.create({
            data: {
              square_customer_id: customer.square_customer_id,
              square_gift_card_id: customer.gift_card_id,
              gift_card_gan: customer.gift_card_gan || null,
              reward_type: rewardType,
              initial_amount_cents: null, // We don't have this from old data
              current_balance_cents: null, // Would need to fetch from Square API
              gift_card_order_id: customer.gift_card_order_id || null,
              gift_card_line_item_uid: customer.gift_card_line_item_uid || null,
              delivery_channel: customer.gift_card_delivery_channel || null,
              activation_url: customer.gift_card_activation_url || null,
              pass_kit_url: customer.gift_card_pass_kit_url || null,
              digital_email: customer.gift_card_digital_email || null,
              is_active: true,
              state: null, // Would need to fetch from Square API
              created_at: customer.created_at || new Date(),
              updated_at: customer.updated_at || new Date()
            }
          })

          // Create initial CREATE transaction record if we can
          // This represents the creation of the gift card
          await prisma.giftCardTransaction.create({
            data: {
              gift_card_id: giftCard.id,
              transaction_type: 'CREATE',
              amount_cents: 0,
              balance_before_cents: null,
              balance_after_cents: null,
              square_activity_id: null,
              square_order_id: customer.gift_card_order_id || null,
              square_payment_id: null,
              reason: null,
              context_label: `Migrated from square_existing_clients (reward_type: ${rewardType})`,
              metadata: {
                migration_source: 'square_existing_clients',
                original_created_at: customer.created_at?.toISOString() || null,
                reward_type: rewardType
              },
              created_at: customer.created_at || new Date()
            }
          })

          migrated++
          if (migrated <= 10 || migrated % 50 === 0) {
            console.log(`   ✅ Migrated: ${customer.square_customer_id} (${customer.gift_card_id})`)
          }
        } else {
          // Dry run - just log
          migrated++
          if (migrated <= 10 || migrated % 50 === 0) {
            console.log(`   🔍 Would migrate: ${customer.square_customer_id} (${customer.gift_card_id}) [${rewardType}]`)
          }
        }
      } catch (error) {
        errors++
        const errorDetail = {
          square_customer_id: customer.square_customer_id,
          gift_card_id: customer.gift_card_id,
          error: error.message
        }
        errorDetails.push(errorDetail)
        
        if (errors <= 10) {
          console.error(`   ❌ Error migrating ${customer.square_customer_id}: ${error.message}`)
        }
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('📊 Migration Summary')
    console.log('='.repeat(60))
    console.log(`   Total customers with gift cards: ${customersWithGiftCards.length}`)
    console.log(`   ✅ Migrated: ${migrated}`)
    console.log(`   ⏭️  Skipped (already exists): ${skipped}`)
    console.log(`   ❌ Errors: ${errors}`)
    
    if (DRY_RUN) {
      console.log('\n⚠️  This was a DRY RUN - no changes were made')
      console.log('   Run without DRY_RUN=true to perform the migration')
    }

    if (errors > 0 && errorDetails.length > 0) {
      console.log('\n❌ Error Details (first 10):')
      errorDetails.slice(0, 10).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.square_customer_id}: ${err.error}`)
      })
      if (errors > 10) {
        console.log(`   ... and ${errors - 10} more errors`)
      }
    }

    console.log('\n💡 Next Steps:')
    console.log('   1. Verify the migrated data: SELECT * FROM gift_cards LIMIT 10')
    console.log('   2. Check transactions: SELECT * FROM gift_card_transactions LIMIT 10')
    console.log('   3. Consider fetching current balances from Square API for migrated cards')
    console.log('   4. Update gift card loading code to check gift_cards table first')

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run migration
migrateGiftCards()
  .then(() => {
    console.log('\n✅ Migration script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  })

