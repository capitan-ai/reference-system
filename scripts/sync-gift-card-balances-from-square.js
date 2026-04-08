#!/usr/bin/env node

/**
 * Sync gift card balances from Square to database
 * Updates database records to match actual Square balances
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

// Import Square API helper from the codebase
function getSquareApis() {
  const { Client, Environment } = require('square')
  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (!accessToken) {
    throw new Error('SQUARE_ACCESS_TOKEN is not set')
  }
  
  const client = new Client({
    accessToken,
    environment: Environment.Production
  })
  
  return {
    giftCardsApi: client.giftCardsApi
  }
}

const getGiftCardsApi = () => getSquareApis().giftCardsApi

const DRY_RUN = process.env.DRY_RUN === 'true'

async function syncGiftCardBalances() {
  console.log('🔄 Syncing Gift Card Balances from Square to Database\n')
  console.log('='.repeat(100))
  
  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n')
  }

  try {
    const giftCardsApi = getGiftCardsApi()

    // Get gift cards with $0 or NULL balance in database (excluding Bozhena)
    const giftCards = await prisma.giftCard.findMany({
      where: {
        reward_type: 'FRIEND_SIGNUP_BONUS',
        OR: [
          { current_balance_cents: 0 },
          { current_balance_cents: null }
        ],
        customer: {
          square_customer_id: {
            not: '5XSV6VT86R5CYWCJC4QK7FW0E0' // Exclude Bozhena
          }
        }
      },
      include: {
        customer: {
          select: {
            square_customer_id: true,
            given_name: true,
            family_name: true,
            email_address: true
          }
        }
      }
    })

    console.log(`📊 Found ${giftCards.length} gift cards to check\n`)

    const results = {
      total: 0,
      synced: 0,
      alreadySynced: 0,
      errors: [],
      skipped: []
    }

    for (let i = 0; i < giftCards.length; i++) {
      const gc = giftCards[i]
      const customer = gc.customer
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
      const dbBalance = gc.current_balance_cents || 0

      console.log(`\n${i + 1}. ${name} (${customer.square_customer_id})`)
      console.log(`${'='.repeat(100)}`)
      console.log(`   Gift Card ID: ${gc.square_gift_card_id}`)
      console.log(`   Database Balance: $${dbBalance / 100}`)
      
      results.total++

      try {
        // Query Square API directly
        const squareResponse = await giftCardsApi.retrieveGiftCard(gc.square_gift_card_id)
        const squareCard = squareResponse.result?.giftCard
        
        if (!squareCard) {
          console.log(`   ❌ Gift card NOT FOUND in Square - skipping`)
          results.skipped.push({
            giftCardId: gc.square_gift_card_id,
            reason: 'Not found in Square'
          })
          continue
        }

        const squareBalance = squareCard.balanceMoney?.amount
        const squareBalanceNumber = typeof squareBalance === 'bigint' 
          ? Number(squareBalance) 
          : (squareBalance || 0)
        const squareState = squareCard.state || null

        console.log(`   Square Balance: $${squareBalanceNumber / 100}`)
        console.log(`   Square State: ${squareState || 'UNKNOWN'}`)
        console.log(`   Database State: ${gc.state || 'NULL'}`)

        // Check if sync is needed
        if (dbBalance === squareBalanceNumber && gc.state === squareState) {
          console.log(`   ✅ Already synced - no update needed`)
          results.alreadySynced++
          continue
        }

        // Check if Square has balance but database shows $0
        if (squareBalanceNumber > 0 && dbBalance === 0) {
          console.log(`   💰 Found balance in Square that needs syncing!`)
          
          if (DRY_RUN) {
            console.log(`   🔍 DRY RUN: Would update:`)
            console.log(`      - current_balance_cents: ${dbBalance} → ${squareBalanceNumber}`)
            console.log(`      - state: ${gc.state || 'NULL'} → ${squareState || 'ACTIVE'}`)
            console.log(`      - last_balance_check_at: ${new Date().toISOString()}`)
          } else {
            // Update the gift card record
            await prisma.giftCard.update({
              where: { id: gc.id },
              data: {
                current_balance_cents: squareBalanceNumber,
                initial_amount_cents: squareBalanceNumber, // Update initial amount too if it was 0
                state: squareState || 'ACTIVE',
                last_balance_check_at: new Date(),
                updated_at: new Date()
              }
            })

            // Check if we need to create an ACTIVATE transaction
            const existingActivateTx = await prisma.giftCardTransaction.findFirst({
              where: {
                gift_card_id: gc.id,
                transaction_type: { in: ['ACTIVATE', 'ADJUST_INCREMENT'] }
              }
            })

            if (!existingActivateTx) {
              // Create an ACTIVATE transaction to record the balance
              await prisma.giftCardTransaction.create({
                data: {
                  gift_card_id: gc.id,
                  transaction_type: squareState === 'ACTIVE' ? 'ACTIVATE' : 'ADJUST_INCREMENT',
                  amount_cents: squareBalanceNumber,
                  balance_before_cents: 0,
                  balance_after_cents: squareBalanceNumber,
                  reason: 'FRIEND_BONUS',
                  context_label: 'Synced from Square - balance correction',
                  metadata: {
                    synced_at: new Date().toISOString(),
                    source: 'square_balance_sync',
                    square_state: squareState
                  }
                }
              })
              console.log(`   ✅ Created transaction record`)
            }

            console.log(`   ✅ Updated database to match Square balance`)
            results.synced++
          }
        } else if (squareBalanceNumber === 0 && dbBalance === 0) {
          console.log(`   ℹ️  Both Square and database show $0 - no sync needed`)
          results.alreadySynced++
          
          // Still update state if different
          if (squareState && gc.state !== squareState && !DRY_RUN) {
            await prisma.giftCard.update({
              where: { id: gc.id },
              data: {
                state: squareState,
                last_balance_check_at: new Date(),
                updated_at: new Date()
              }
            })
            console.log(`   ✅ Updated state from ${gc.state || 'NULL'} to ${squareState}`)
          }
        } else {
          console.log(`   ⚠️  Unexpected scenario - database: $${dbBalance / 100}, Square: $${squareBalanceNumber / 100}`)
        }

      } catch (error) {
        console.log(`   ❌ Error syncing: ${error.message}`)
        if (error.errors) {
          console.log(`      Square API errors: ${JSON.stringify(error.errors)}`)
        }
        results.errors.push({
          giftCardId: gc.square_gift_card_id,
          customerId: customer.square_customer_id,
          error: error.message
        })
      }
    }

    // Summary
    console.log(`\n${'='.repeat(100)}`)
    console.log(`📈 Sync Summary:`)
    console.log(`${'='.repeat(100)}`)
    console.log(`   Total cards checked: ${results.total}`)
    console.log(`   ✅ Synced (updated): ${results.synced}`)
    console.log(`   ✅ Already synced: ${results.alreadySynced}`)
    console.log(`   ⏭️  Skipped: ${results.skipped.length}`)
    console.log(`   ❌ Errors: ${results.errors.length}`)

    if (results.synced > 0 && !DRY_RUN) {
      console.log(`\n${'='.repeat(100)}`)
      console.log(`✅ Successfully synced ${results.synced} gift card(s) from Square!`)
      console.log(`   The database now accurately reflects Square balances.`)
    }

    if (results.errors.length > 0) {
      console.log(`\n${'='.repeat(100)}`)
      console.log(`⚠️  Errors encountered:`)
      results.errors.forEach((error, idx) => {
        console.log(`   ${idx + 1}. ${error.giftCardId}: ${error.error}`)
      })
    }

    if (results.skipped.length > 0) {
      console.log(`\n${'='.repeat(100)}`)
      console.log(`⏭️  Skipped cards:`)
      results.skipped.forEach((skip, idx) => {
        console.log(`   ${idx + 1}. ${skip.giftCardId}: ${skip.reason}`)
      })
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  syncGiftCardBalances()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { syncGiftCardBalances }



