#!/usr/bin/env node

/**
 * Detailed check of gift cards for customers with no referral code stored
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkGiftCardsDetailed() {
  console.log('🔍 Detailed Gift Card Check for Customers with No Referral Code\n')
  console.log('='.repeat(100))

  try {
    // Get friend gift cards with no referral code (excluding Bozhena)
    const giftCards = await prisma.giftCard.findMany({
      where: {
        reward_type: 'FRIEND_SIGNUP_BONUS',
        customer: {
          OR: [
            { used_referral_code: null },
            { used_referral_code: '' }
          ],
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
            phone_number: true,
            created_at: true,
            used_referral_code: true
          }
        },
        transactions: {
          select: {
            id: true,
            transaction_type: true,
            amount_cents: true,
            balance_after_cents: true,
            created_at: true,
            reason: true,
            context_label: true
          },
          orderBy: {
            created_at: 'desc'
          },
          take: 5 // Last 5 transactions
        }
      },
      orderBy: {
        created_at: 'desc'
      },
      take: 20 // Check first 20
    })

    console.log(`\n📊 Found ${giftCards.length} gift cards to check\n`)

    for (let i = 0; i < giftCards.length; i++) {
      const gc = giftCards[i]
      const customer = gc.customer
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'

      console.log(`${'='.repeat(100)}`)
      console.log(`${i + 1}. ${name}`)
      console.log(`${'='.repeat(100)}`)
      
      // Customer Info
      console.log(`\n👤 Customer Info:`)
      console.log(`   ID: ${customer.square_customer_id}`)
      console.log(`   Email: ${customer.email_address || 'N/A'}`)
      console.log(`   Phone: ${customer.phone_number || 'N/A'}`)
      console.log(`   Customer Created: ${customer.created_at}`)
      console.log(`   Used Referral Code: ${customer.used_referral_code || 'NULL ❌'}`)

      // Gift Card Info
      console.log(`\n💳 Gift Card Info:`)
      console.log(`   Database ID: ${gc.id}`)
      console.log(`   Square Gift Card ID: ${gc.square_gift_card_id || 'MISSING ⚠️'}`)
      console.log(`   GAN (Gift Card Number): ${gc.gift_card_gan || 'N/A'}`)
      console.log(`   Initial Amount: $${(gc.initial_amount_cents || 0) / 100}`)
      console.log(`   Current Balance: $${(gc.current_balance_cents || 0) / 100}`)
      console.log(`   State: ${gc.state || 'UNKNOWN'}`)
      console.log(`   Is Active: ${gc.is_active ? '✅ YES' : '❌ NO'}`)
      console.log(`   Delivery Channel: ${gc.delivery_channel || 'N/A'}`)
      console.log(`   Gift Card Created: ${gc.created_at}`)
      console.log(`   Last Balance Check: ${gc.last_balance_check_at || 'Never'}`)

      // Activation/Delivery Info
      if (gc.activation_url || gc.pass_kit_url) {
        console.log(`\n📱 Delivery Info:`)
        if (gc.activation_url) {
          console.log(`   Activation URL: ${gc.activation_url.substring(0, 80)}...`)
        }
        if (gc.pass_kit_url) {
          console.log(`   PassKit (Wallet) URL: ${gc.pass_kit_url.substring(0, 80)}...`)
        }
        if (gc.digital_email) {
          console.log(`   Digital Email: ${gc.digital_email}`)
        }
      }

      // Transactions
      if (gc.transactions && gc.transactions.length > 0) {
        console.log(`\n📝 Recent Transactions (${gc.transactions.length}):`)
        gc.transactions.forEach((tx, idx) => {
          console.log(`   ${idx + 1}. ${tx.transaction_type} - $${(tx.amount_cents || 0) / 100}`)
          console.log(`      Balance After: $${(tx.balance_after_cents || 0) / 100}`)
          console.log(`      Reason: ${tx.reason || 'N/A'}`)
          console.log(`      Date: ${tx.created_at}`)
        })
      } else {
        console.log(`\n📝 Transactions: None found`)
      }

      // Status Summary
      console.log(`\n📊 Status Summary:`)
      if (gc.square_gift_card_id) {
        console.log(`   ✅ Gift card EXISTS in Square`)
      } else {
        console.log(`   ⚠️  No Square gift card ID - may not be real card`)
      }
      
      if (gc.current_balance_cents > 0) {
        console.log(`   ✅ Has balance: $${gc.current_balance_cents / 100}`)
      } else {
        console.log(`   ⚠️  Zero balance`)
      }

      if (gc.state === 'ACTIVE' || gc.is_active) {
        console.log(`   ✅ Card is ACTIVE - Customer CAN use it`)
      } else {
        console.log(`   ⚠️  Card state: ${gc.state || 'UNKNOWN'}`)
      }

      console.log() // Empty line between customers
    }

    // Summary statistics
    const stats = {
      total: giftCards.length,
      hasSquareId: giftCards.filter(gc => gc.square_gift_card_id).length,
      hasBalance: giftCards.filter(gc => (gc.current_balance_cents || 0) > 0).length,
      isActive: giftCards.filter(gc => gc.is_active && (gc.state === 'ACTIVE' || !gc.state)).length,
      hasTransactions: giftCards.filter(gc => gc.transactions && gc.transactions.length > 0).length,
      averageBalance: giftCards.reduce((sum, gc) => sum + (gc.current_balance_cents || 0), 0) / giftCards.length / 100
    }

    console.log(`\n${'='.repeat(100)}`)
    console.log(`📈 Summary Statistics:`)
    console.log(`${'='.repeat(100)}`)
    console.log(`   Total checked: ${stats.total}`)
    console.log(`   Has Square Gift Card ID: ${stats.hasSquareId} (${(stats.hasSquareId/stats.total*100).toFixed(1)}%)`)
    console.log(`   Has balance > $0: ${stats.hasBalance} (${(stats.hasBalance/stats.total*100).toFixed(1)}%)`)
    console.log(`   Is Active: ${stats.isActive} (${(stats.isActive/stats.total*100).toFixed(1)}%)`)
    console.log(`   Has transactions: ${stats.hasTransactions} (${(stats.hasTransactions/stats.total*100).toFixed(1)}%)`)
    console.log(`   Average balance: $${stats.averageBalance.toFixed(2)}`)
    
    // Save detailed data to JSON
    const fs = require('fs')
    const output = {
      checked_at: new Date().toISOString(),
      summary: stats,
      gift_cards: giftCards.map(gc => ({
        customer: {
          id: gc.customer.square_customer_id,
          name: `${gc.customer.given_name || ''} ${gc.customer.family_name || ''}`.trim(),
          email: gc.customer.email_address,
          phone: gc.customer.phone_number,
          created_at: gc.customer.created_at
        },
        gift_card: {
          id: gc.id,
          square_gift_card_id: gc.square_gift_card_id,
          gan: gc.gift_card_gan,
          initial_amount_cents: gc.initial_amount_cents,
          current_balance_cents: gc.current_balance_cents,
          state: gc.state,
          is_active: gc.is_active,
          created_at: gc.created_at,
          last_balance_check_at: gc.last_balance_check_at
        },
        transaction_count: gc.transactions.length
      }))
    }

    fs.writeFileSync(
      'gift-card-details-check.json',
      JSON.stringify(output, null, 2)
    )
    console.log(`\n💾 Full details saved to: gift-card-details-check.json`)

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkGiftCardsDetailed()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { checkGiftCardsDetailed }

