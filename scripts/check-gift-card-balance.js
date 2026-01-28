#!/usr/bin/env node
/**
 * Check why a gift card has $0 balance
 * 
 * Usage: node scripts/check-gift-card-balance.js <customer_id_or_gift_card_id>
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

async function checkGiftCard(customerIdOrGiftCardId) {
  console.log(`🔍 Checking Gift Card for: ${customerIdOrGiftCardId}\n`)
  console.log('='.repeat(80))

  // Try to find by customer ID first
  let customer = null
  let giftCard = null

  // Check if it's a customer ID
  const customerData = await prisma.squareExistingClient.findUnique({
    where: { square_customer_id: customerIdOrGiftCardId },
    include: {
      giftCards: {
        include: {
          transactions: {
            orderBy: {
              created_at: 'desc'
            }
          }
        }
      }
    }
  })

  if (customerData) {
    customer = customerData
    if (customerData.giftCards && customerData.giftCards.length > 0) {
      giftCard = customerData.giftCards[0] // Get first gift card
    }
  } else {
    // Try to find by gift card ID
    const gc = await prisma.giftCard.findUnique({
      where: { square_gift_card_id: customerIdOrGiftCardId },
      include: {
        customer: true,
        transactions: {
          orderBy: {
            created_at: 'desc'
          }
        }
      }
    })
    if (gc) {
      giftCard = gc
      customer = gc.customer
    }
  }

  if (!giftCard) {
    console.log('❌ Gift card not found in database')
    process.exit(1)
  }

  if (!customer) {
    console.log('❌ Customer not found')
    process.exit(1)
  }

  console.log(`\n📋 Customer Information:`)
  console.log(`   Name: ${customer.given_name || ''} ${customer.family_name || ''}`.trim())
  console.log(`   Email: ${customer.email_address || 'N/A'}`)
  console.log(`   Customer ID: ${customer.square_customer_id}`)

  console.log(`\n🎁 Gift Card Information:`)
  console.log(`   Gift Card ID: ${giftCard.square_gift_card_id}`)
  console.log(`   GAN: ${giftCard.gift_card_gan || 'N/A'}`)
  console.log(`   Reward Type: ${giftCard.reward_type}`)
  console.log(`   State: ${giftCard.state || 'N/A'}`)
  console.log(`   Initial Amount: $${((giftCard.initial_amount_cents || 0) / 100).toFixed(2)}`)
  console.log(`   Current Balance (DB): $${((giftCard.current_balance_cents || 0) / 100).toFixed(2)}`)
  console.log(`   Created: ${new Date(giftCard.created_at).toLocaleString()}`)
  console.log(`   Last Balance Check: ${giftCard.last_balance_check_at ? new Date(giftCard.last_balance_check_at).toLocaleString() : 'Never'}`)

  // Check Square API for current balance and activities
  console.log(`\n🔍 Fetching current balance from Square API...`)
  try {
    const squareGiftCard = await giftCardsApi.retrieveGiftCard(giftCard.square_gift_card_id)
    const squareCard = squareGiftCard.result?.giftCard
    if (squareCard) {
      const balanceAmount = squareCard.balanceMoney?.amount
      const balanceCents = typeof balanceAmount === 'bigint' 
        ? Number(balanceAmount) 
        : (balanceAmount || 0)
      console.log(`   ✅ Square API Balance: $${(balanceCents / 100).toFixed(2)}`)
      console.log(`   Square State: ${squareCard.state || 'N/A'}`)
      console.log(`   GAN: ${squareCard.gan || 'N/A'}`)
      
      if (balanceCents !== (giftCard.current_balance_cents || 0)) {
        console.log(`   ⚠️  Balance mismatch! DB shows $${((giftCard.current_balance_cents || 0) / 100).toFixed(2)} but Square shows $${(balanceCents / 100).toFixed(2)}`)
      }
    }
  } catch (error) {
    console.log(`   ❌ Error fetching from Square: ${error.message}`)
  }

  // Check Square activities using the correct API
  console.log(`\n🔍 Checking Square Gift Card Activities...`)
  try {
    const giftCardActivitiesApi = squareClient.giftCardActivitiesApi
    const activitiesResponse = await giftCardActivitiesApi.listGiftCardActivities(giftCard.square_gift_card_id)
    const activities = activitiesResponse.result?.giftCardActivities || []
    
    if (activities.length === 0) {
      console.log(`   ℹ️  No activities found in Square`)
    } else {
      console.log(`   ✅ Found ${activities.length} activity/activities in Square:\n`)
      
      activities.forEach((activity, idx) => {
        const type = activity.type
        const createdAt = activity.createdAt
        const status = activity.status || 'N/A'
        
        let amount = '$0.00'
        let balanceAfter = '$0.00'
        let details = ''
        
        if (activity.activateActivityDetails) {
          const amt = activity.activateActivityDetails.amountMoney
          if (amt) {
            const cents = typeof amt.amount === 'bigint' ? Number(amt.amount) : (amt.amount || 0)
            amount = `+$${(cents / 100).toFixed(2)}`
          }
          if (activity.activateActivityDetails.orderId) {
            details += ` Order: ${activity.activateActivityDetails.orderId}`
          }
        }
        
        if (activity.loadActivityDetails) {
          const amt = activity.loadActivityDetails.amountMoney
          if (amt) {
            const cents = typeof amt.amount === 'bigint' ? Number(amt.amount) : (amt.amount || 0)
            amount = `+$${(cents / 100).toFixed(2)}`
          }
        }
        
        if (activity.redeemActivityDetails) {
          const amt = activity.redeemActivityDetails.amountMoney
          if (amt) {
            const cents = typeof amt.amount === 'bigint' ? Number(amt.amount) : (amt.amount || 0)
            amount = `-$${(cents / 100).toFixed(2)}`
          }
          if (activity.redeemActivityDetails.paymentId) {
            details += ` Payment: ${activity.redeemActivityDetails.paymentId}`
          }
          if (activity.redeemActivityDetails.orderId) {
            details += ` Order: ${activity.redeemActivityDetails.orderId}`
          }
        }
        
        if (activity.adjustIncrementActivityDetails) {
          const amt = activity.adjustIncrementActivityDetails.amountMoney
          if (amt) {
            const cents = typeof amt.amount === 'bigint' ? Number(amt.amount) : (amt.amount || 0)
            amount = `+$${(cents / 100).toFixed(2)}`
          }
        }
        
        if (activity.giftCardBalanceMoney) {
          const amt = activity.giftCardBalanceMoney
          const cents = typeof amt.amount === 'bigint' ? Number(amt.amount) : (amt.amount || 0)
          balanceAfter = `$${(cents / 100).toFixed(2)}`
        }
        
        console.log(`   ${idx + 1}. ${type} (${status})`)
        console.log(`      Amount: ${amount}`)
        console.log(`      Balance After: ${balanceAfter}`)
        console.log(`      Created: ${new Date(createdAt).toLocaleString()}`)
        console.log(`      Activity ID: ${activity.id}`)
        if (activity.locationId) {
          console.log(`      Location: ${activity.locationId}`)
        }
        if (details) {
          console.log(`      Details:${details}`)
        }
        console.log('')
      })
      
      // Check for REDEEM activities
      const redeems = activities.filter(a => a.type === 'REDEEM')
      if (redeems.length > 0) {
        const totalRedeemed = redeems.reduce((sum, a) => {
          const details = a.redeemActivityDetails
          if (details && details.amountMoney) {
            const cents = typeof details.amountMoney.amount === 'bigint' 
              ? Number(details.amountMoney.amount) 
              : (details.amountMoney.amount || 0)
            return sum + cents
          }
          return sum
        }, 0)
        console.log(`\n   💸 Total Redeemed from Square: $${(totalRedeemed / 100).toFixed(2)}`)
      }
      
      // Check for ACTIVATE activities
      const activates = activities.filter(a => a.type === 'ACTIVATE')
      if (activates.length > 0) {
        const totalActivated = activates.reduce((sum, a) => {
          const details = a.activateActivityDetails
          if (details && details.amountMoney) {
            const cents = typeof details.amountMoney.amount === 'bigint' 
              ? Number(details.amountMoney.amount) 
              : (details.amountMoney.amount || 0)
            return sum + cents
          }
          return sum
        }, 0)
        if (totalActivated > 0) {
          console.log(`   💰 Total Activated: $${(totalActivated / 100).toFixed(2)}`)
        }
      }
    }
  } catch (error) {
    console.log(`   ❌ Error fetching activities: ${error.message}`)
    if (error.errors) {
      console.log(`   Errors: ${JSON.stringify(error.errors, null, 2)}`)
    }
  }

  // Check transactions
  console.log(`\n📜 Gift Card Transactions (${giftCard.transactions.length} total):`)
  if (giftCard.transactions.length === 0) {
    console.log(`   ⚠️  No transactions found in database`)
  } else {
    giftCard.transactions.forEach((tx, idx) => {
      console.log(`\n   ${idx + 1}. ${tx.transaction_type}`)
      console.log(`      Amount: $${((tx.amount_cents || 0) / 100).toFixed(2)}`)
      console.log(`      Balance Before: $${((tx.balance_before_cents || 0) / 100).toFixed(2)}`)
      console.log(`      Balance After: $${((tx.balance_after_cents || 0) / 100).toFixed(2)}`)
      console.log(`      Context: ${tx.context_label || 'N/A'}`)
      console.log(`      Created: ${new Date(tx.created_at).toLocaleString()}`)
      if (tx.square_activity_id) {
        console.log(`      Square Activity ID: ${tx.square_activity_id}`)
      }
      if (tx.square_order_id) {
        console.log(`      Square Order ID: ${tx.square_order_id}`)
      }
      if (tx.metadata) {
        console.log(`      Metadata: ${JSON.stringify(tx.metadata, null, 2)}`)
      }
    })

    // Analyze balance changes
    const creates = giftCard.transactions.filter(tx => tx.transaction_type === 'CREATE')
    const loads = giftCard.transactions.filter(tx => tx.transaction_type === 'LOAD')
    const redeems = giftCard.transactions.filter(tx => tx.transaction_type === 'REDEEM')
    const refunds = giftCard.transactions.filter(tx => tx.transaction_type === 'REFUND')

    console.log(`\n📊 Transaction Summary:`)
    console.log(`   CREATE: ${creates.length}`)
    console.log(`   LOAD: ${loads.length}`)
    console.log(`   REDEEM: ${redeems.length}`)
    console.log(`   REFUND: ${refunds.length}`)

    if (redeems.length > 0) {
      const totalRedeemed = redeems.reduce((sum, tx) => sum + (tx.amount_cents || 0), 0)
      console.log(`\n   💸 Total Redeemed: $${(totalRedeemed / 100).toFixed(2)}`)
    }

    if (loads.length > 0) {
      const totalLoaded = loads.reduce((sum, tx) => sum + (tx.amount_cents || 0), 0)
      console.log(`   💰 Total Loaded: $${(totalLoaded / 100).toFixed(2)}`)
    }
  }

  // Check if initial amount was 0
  if ((giftCard.initial_amount_cents || 0) === 0) {
    console.log(`\n⚠️  WARNING: Initial amount is $0.00`)
    console.log(`   This suggests the gift card was never activated or loaded with funds`)
  }

  // Check if balance went from positive to 0
  if ((giftCard.initial_amount_cents || 0) > 0 && (giftCard.current_balance_cents || 0) === 0) {
    console.log(`\n💡 Analysis: Gift card had initial amount but is now $0`)
    console.log(`   This likely means the gift card was used/redeemed`)
  }

  console.log(`\n${'='.repeat(80)}`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.log('Usage: node scripts/check-gift-card-balance.js <customer_id_or_gift_card_id>')
    console.log('Example: node scripts/check-gift-card-balance.js RPYQ4PHVGK1E2HPRGJFH215P4C')
    process.exit(1)
  }

  const identifier = args[0]

  try {
    await checkGiftCard(identifier)
  } catch (error) {
    console.error('\n❌ Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
}

module.exports = { checkGiftCard }
