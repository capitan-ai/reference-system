#!/usr/bin/env node

/**
 * Check Square directly for actual gift card balances
 * Compares Square balances with database records
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

async function checkSquareBalances() {
  console.log('🔍 Checking Square Gift Card Balances\n')
  console.log('='.repeat(100))

  try {
    const giftCardsApi = getGiftCardsApi()

    // Get friend gift cards with $0 or NULL balance (excluding Bozhena)
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
            email_address: true,
            used_referral_code: true
          }
        },
        transactions: {
          select: {
            transaction_type: true,
            amount_cents: true,
            balance_after_cents: true,
            created_at: true
          },
          orderBy: {
            created_at: 'asc'
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      take: 20 // Check first 20
    })

    console.log(`📊 Found ${giftCards.length} gift cards to check in Square\n`)

    const results = {
      total: giftCards.length,
      foundInSquare: 0,
      notFoundInSquare: 0,
      hasBalanceInSquare: 0,
      zeroBalanceInSquare: 0,
      databaseMatchesSquare: 0,
      databaseMismatchesSquare: 0,
      errors: []
    }

    console.log('='.repeat(100))
    
    for (let i = 0; i < giftCards.length; i++) {
      const gc = giftCards[i]
      const customer = gc.customer
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
      const dbBalance = gc.current_balance_cents || 0

      console.log(`\n${i + 1}. ${name} (${customer.square_customer_id})`)
      console.log(`${'='.repeat(100)}`)
      console.log(`   Database Balance: $${dbBalance / 100}`)
      console.log(`   Square Gift Card ID: ${gc.square_gift_card_id}`)
      
      try {
        // Query Square API directly
        const squareResponse = await giftCardsApi.retrieveGiftCard(gc.square_gift_card_id)
        const squareCard = squareResponse.result?.giftCard
        
        if (!squareCard) {
          console.log(`   ❌ Gift card NOT FOUND in Square`)
          results.notFoundInSquare++
          results.errors.push({
            customerId: customer.square_customer_id,
            giftCardId: gc.square_gift_card_id,
            error: 'Card not found in Square'
          })
          continue
        }

        results.foundInSquare++
        
        const squareBalance = squareCard.balanceMoney?.amount
        const squareBalanceNumber = typeof squareBalance === 'bigint' 
          ? Number(squareBalance) 
          : (squareBalance || 0)
        
        console.log(`   ✅ Found in Square:`)
        console.log(`      State: ${squareCard.state || 'UNKNOWN'}`)
        console.log(`      Square Balance: $${squareBalanceNumber / 100}`)
        console.log(`      GAN: ${squareCard.gan || 'N/A'}`)
        
        if (squareBalanceNumber > 0) {
          results.hasBalanceInSquare++
          console.log(`   💰 HAS BALANCE IN SQUARE!`)
          
          if (dbBalance === squareBalanceNumber) {
            console.log(`   ✅ Database matches Square`)
            results.databaseMatchesSquare++
          } else {
            console.log(`   ⚠️  MISMATCH: Database shows $${dbBalance / 100}, Square shows $${squareBalanceNumber / 100}`)
            results.databaseMismatchesSquare++
            
            // Store mismatch for reporting
            results.errors.push({
              customerId: customer.square_customer_id,
              giftCardId: gc.square_gift_card_id,
              databaseBalance: dbBalance,
              squareBalance: squareBalanceNumber,
              mismatch: true
            })
          }
        } else {
          results.zeroBalanceInSquare++
          console.log(`   ⚠️  Zero balance in Square (matches database)`)
        }

        // Check if card state is different
        if (squareCard.state && squareCard.state !== gc.state) {
          console.log(`   ⚠️  State mismatch: Database=${gc.state || 'NULL'}, Square=${squareCard.state}`)
        }

      } catch (error) {
        console.log(`   ❌ Error checking Square: ${error.message}`)
        if (error.errors) {
          console.log(`      Square API errors: ${JSON.stringify(error.errors)}`)
        }
        results.errors.push({
          customerId: customer.square_customer_id,
          giftCardId: gc.square_gift_card_id,
          error: error.message
        })
      }
    }

    // Summary
    console.log(`\n${'='.repeat(100)}`)
    console.log(`📈 Summary:`)
    console.log(`${'='.repeat(100)}`)
    console.log(`   Total cards checked: ${results.total}`)
    console.log(`   ✅ Found in Square: ${results.foundInSquare}`)
    console.log(`   ❌ Not found in Square: ${results.notFoundInSquare}`)
    console.log(`   💰 Cards with balance in Square: ${results.hasBalanceInSquare}`)
    console.log(`   ⚠️  Cards with zero balance in Square: ${results.zeroBalanceInSquare}`)
    console.log(`   ✅ Database matches Square: ${results.databaseMatchesSquare}`)
    console.log(`   ⚠️  Database mismatches Square: ${results.databaseMismatchesSquare}`)

    if (results.hasBalanceInSquare > 0) {
      console.log(`\n${'='.repeat(100)}`)
      console.log(`🎯 KEY FINDING:`)
      console.log(`${'='.repeat(100)}`)
      console.log(`   ${results.hasBalanceInSquare} gift card(s) HAVE BALANCE IN SQUARE!`)
      console.log(`   The database shows $0, but Square shows they have money.`)
      console.log(`   These cards can be used by customers even though the database is wrong.`)
      console.log(`\n💡 Recommendation:`)
      console.log(`   1. Update database records to match Square balances`)
      console.log(`   2. These customers CAN use their gift cards (they have money in Square)`)
      console.log(`   3. Fix the database sync issue going forward`)
    }

    if (results.databaseMismatchesSquare > 0) {
      console.log(`\n${'='.repeat(100)}`)
      console.log(`⚠️  Cards with Balance Mismatches:`)
      console.log(`${'='.repeat(100)}`)
      results.errors
        .filter(e => e.mismatch)
        .forEach((error, idx) => {
          console.log(`   ${idx + 1}. Gift Card: ${error.giftCardId}`)
          console.log(`      Customer: ${error.customerId}`)
          console.log(`      Database: $${(error.databaseBalance || 0) / 100}`)
          console.log(`      Square: $${(error.squareBalance || 0) / 100}`)
        })
    }

    if (results.zeroBalanceInSquare === results.total && results.hasBalanceInSquare === 0) {
      console.log(`\n${'='.repeat(100)}`)
      console.log(`❌ CRITICAL FINDING:`)
      console.log(`${'='.repeat(100)}`)
      console.log(`   ALL checked gift cards have $0 balance in Square.`)
      console.log(`   These customers received gift cards but they were NEVER funded with $10.`)
      console.log(`   The gift cards exist in Square but are unusable (no money).`)
      console.log(`\n💡 Recommendation:`)
      console.log(`   1. These gift cards need to be manually activated/loaded`)
      console.log(`   2. Use ADJUST_INCREMENT to add $10 to each card`)
      console.log(`   3. Investigate why activation failed during original creation`)
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkSquareBalances()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { checkSquareBalances }



