#!/usr/bin/env node

/**
 * Investigate why gift cards have $0 balance
 * Checks if activation failed due to missing locationId or other issues
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function investigateZeroBalance() {
  console.log('🔍 Investigating Gift Cards with $0 Balance\n')
  console.log('='.repeat(100))

  try {
    // Check environment variables
    console.log('\n📋 Environment Check:')
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    console.log(`   SQUARE_LOCATION_ID: ${locationId ? '✅ SET' : '❌ MISSING'}`)
    if (!locationId) {
      console.log(`   ⚠️  WARNING: SQUARE_LOCATION_ID is missing - this would prevent activation!`)
    }

    // Get friend gift cards with $0 or NULL balance (excluding Bozhena)
    const giftCardsWithRelations = await prisma.giftCard.findMany({
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
            used_referral_code: true,
            created_at: true
          }
        },
        transactions: {
          select: {
            transaction_type: true,
            amount_cents: true,
            balance_after_cents: true,
            square_activity_id: true,
            created_at: true,
            reason: true,
            context_label: true
          },
          orderBy: {
            created_at: 'asc'
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      take: 10 // Check first 10
    })

    console.log(`\n📊 Found ${giftCardsWithRelations.length} gift cards with $0 balance to investigate\n`)

    // Analyze patterns
    const analysis = {
      total: giftCardsWithRelations.length,
      hasInitialAmount: 0,
      hasActivationTransaction: 0,
      hasAdjustTransaction: 0,
      missingLocationIdImpact: 0,
      createdRecently: 0,
      stateUnknown: 0
    }

    for (let i = 0; i < giftCardsWithRelations.length; i++) {
      const gc = giftCardsWithRelations[i]
      const customer = gc.customer
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'

      console.log(`${'='.repeat(100)}`)
      console.log(`${i + 1}. ${name} (${customer.square_customer_id})`)
      console.log(`${'='.repeat(100)}`)
      
      console.log(`\n💳 Gift Card:`)
      console.log(`   Square ID: ${gc.square_gift_card_id}`)
      console.log(`   Initial Amount: $${(gc.initial_amount_cents || 0) / 100}`)
      console.log(`   Current Balance: $${(gc.current_balance_cents || 0) / 100}`)
      console.log(`   State: ${gc.state || 'UNKNOWN'}`)
      console.log(`   Created: ${gc.created_at}`)
      console.log(`   Delivery Channel: ${gc.delivery_channel || 'N/A'}`)

      if (gc.initial_amount_cents > 0) {
        analysis.hasInitialAmount++
        console.log(`   ✅ Had intended amount: $${gc.initial_amount_cents / 100}`)
      } else {
        console.log(`   ❌ Initial amount was $0 - card was created with no money intended!`)
      }

      console.log(`\n📝 Transactions (${gc.transactions.length}):`)
      if (gc.transactions.length === 0) {
        console.log(`   ❌ NO TRANSACTIONS FOUND`)
      } else {
        gc.transactions.forEach((tx, idx) => {
          console.log(`   ${idx + 1}. ${tx.transaction_type}`)
          console.log(`      Amount: $${(tx.amount_cents || 0) / 100}`)
          console.log(`      Balance After: $${(tx.balance_after_cents || 0) / 100}`)
          console.log(`      Square Activity ID: ${tx.square_activity_id || 'N/A'}`)
          console.log(`      Reason: ${tx.reason || 'N/A'}`)
          console.log(`      Context: ${tx.context_label || 'N/A'}`)
          console.log(`      Date: ${tx.created_at}`)
          
          if (tx.transaction_type === 'ACTIVATE') {
            analysis.hasActivationTransaction++
          }
          if (tx.transaction_type === 'ADJUST_INCREMENT') {
            analysis.hasAdjustTransaction++
          }
        })
      }

      // Check for activation patterns
      console.log(`\n🔍 Analysis:`)
      const initialAmount = gc.initial_amount_cents || 0
      const currentBalance = gc.current_balance_cents || 0
      
      if (initialAmount === null) {
        console.log(`   ❌ CRITICAL: initial_amount_cents is NULL - card was saved incorrectly!`)
      }
      if (currentBalance === null) {
        console.log(`   ❌ CRITICAL: current_balance_cents is NULL - balance was never set!`)
      }
      
      if (initialAmount > 0 && currentBalance === 0) {
        console.log(`   ⚠️  PROBLEM: Card was supposed to have $${initialAmount / 100} but has $0`)
        console.log(`   ⚠️  This means activation/loading FAILED`)
        
        const hasActivateOrAdjust = gc.transactions.some(tx => 
          tx.transaction_type === 'ACTIVATE' || tx.transaction_type === 'ADJUST_INCREMENT'
        )
        
        if (!hasActivateOrAdjust) {
          console.log(`   ❌ ROOT CAUSE: No ACTIVATE or ADJUST_INCREMENT transaction found!`)
          console.log(`   ❌ Possible reasons:`)
          if (!locationId) {
            console.log(`      - SQUARE_LOCATION_ID was missing (would prevent activation)`)
            analysis.missingLocationIdImpact++
          } else {
            console.log(`      - Square API activation call failed silently`)
            console.log(`      - Error occurred but wasn't saved to database`)
            console.log(`      - Gift card was created but activation step was skipped`)
          }
        }
      }

      if (!gc.state || gc.state === 'UNKNOWN') {
        analysis.stateUnknown++
        console.log(`   ⚠️  Card state is unknown - may not have been properly created`)
      }

      // Check if created recently (when locationId might have been missing)
      const daysAgo = (Date.now() - new Date(gc.created_at).getTime()) / (1000 * 60 * 60 * 24)
      if (daysAgo < 30) {
        analysis.createdRecently++
        console.log(`   📅 Created ${daysAgo.toFixed(1)} days ago`)
      }

      console.log()
    }

    // Summary
    console.log(`\n${'='.repeat(100)}`)
    console.log(`📈 Analysis Summary:`)
    console.log(`${'='.repeat(100)}`)
    console.log(`   Total cards checked: ${analysis.total}`)
    console.log(`   Cards with initial amount > $0: ${analysis.hasInitialAmount}`)
    console.log(`   Cards with ACTIVATE transaction: ${analysis.hasActivationTransaction}`)
    console.log(`   Cards with ADJUST_INCREMENT transaction: ${analysis.hasAdjustTransaction}`)
    console.log(`   Cards affected by missing locationId: ${analysis.missingLocationIdImpact}`)
    console.log(`   Cards created in last 30 days: ${analysis.createdRecently}`)
    console.log(`   Cards with unknown state: ${analysis.stateUnknown}`)

    // Root cause analysis
    console.log(`\n${'='.repeat(100)}`)
    console.log(`🎯 Root Cause Analysis:`)
    console.log(`${'='.repeat(100)}`)
    
    if (!locationId) {
      console.log(`\n❌ PRIMARY ISSUE: SQUARE_LOCATION_ID is missing!`)
      console.log(`   This would prevent ALL gift card activations from working.`)
      console.log(`   The code requires locationId to activate gift cards:`)
      console.log(`   - Line 1163: if (!giftCardActivity && locationId && amountMoney.amount > 0)`)
      console.log(`   - Line 1206: if (!giftCardActivity && locationId && amountMoney.amount > 0)`)
      console.log(`   If locationId is missing, activation is SKIPPED entirely!`)
    }

    const noActivationTransactions = analysis.total - analysis.hasActivationTransaction - analysis.hasAdjustTransaction
    if (noActivationTransactions > 0) {
      console.log(`\n❌ SECONDARY ISSUE: ${noActivationTransactions} cards have no activation transactions`)
      console.log(`   These cards were created but never activated/loaded with money.`)
      console.log(`   Possible causes:`)
      console.log(`   1. SQUARE_LOCATION_ID was missing when card was created`)
      console.log(`   2. Square API activation call failed but error was silently caught`)
      console.log(`   3. Card creation succeeded but activation step was skipped`)
    }

    if (analysis.hasInitialAmount > 0) {
      console.log(`\n✅ GOOD NEWS: ${analysis.hasInitialAmount} cards had intended amount > $0`)
      console.log(`   This means the code intended to give $10, but activation failed.`)
      console.log(`   These cards CAN be fixed by manually activating them.`)
    }

    console.log(`\n💡 Recommendation:`)
    console.log(`   1. Check if SQUARE_LOCATION_ID was missing when these cards were created`)
    console.log(`   2. Manually activate cards that have initial_amount_cents > 0 but balance = 0`)
    console.log(`   3. Use ADJUST_INCREMENT to add $10 to these cards`)
    console.log(`   4. Ensure SQUARE_LOCATION_ID is always set in production`)

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  investigateZeroBalance()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { investigateZeroBalance }

