#!/usr/bin/env node
/**
 * Investigate why customers who used referral codes don't have gift cards
 * 
 * Usage: node scripts/investigate-missing-gift-cards.js
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function investigateCustomer(customerId, customerName, usedCode) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`Investigating: ${customerName} (${customerId})`)
  console.log(`Used Referral Code: ${usedCode}`)
  console.log('='.repeat(80))

  // Get customer data
  const customer = await prisma.squareExistingClient.findUnique({
    where: { square_customer_id: customerId },
    include: {
      giftCards: true,
      referralProfile: true
    }
  })

  if (!customer) {
    console.log('❌ Customer not found in database')
    return
  }

  console.log(`\n📋 Customer Details:`)
  console.log(`   Name: ${customer.given_name || ''} ${customer.family_name || ''}`.trim())
  console.log(`   Email: ${customer.email_address || 'N/A'}`)
  console.log(`   Personal Code: ${customer.personal_code || 'N/A'}`)
  console.log(`   Used Referral Code: ${customer.used_referral_code || 'N/A'}`)
  console.log(`   Got Signup Bonus: ${customer.got_signup_bonus ? 'Yes' : 'No'}`)
  console.log(`   Activated as Referrer: ${customer.activated_as_referrer ? 'Yes' : 'No'}`)
  console.log(`   First Payment Completed: ${customer.first_payment_completed ? 'Yes' : 'No'}`)
  console.log(`   Gift Card ID (in square_existing_clients): ${customer.gift_card_id || 'N/A'}`)
  console.log(`   Created: ${customer.created_at ? new Date(customer.created_at).toLocaleString() : 'N/A'}`)
  console.log(`   Updated: ${customer.updated_at ? new Date(customer.updated_at).toLocaleString() : 'N/A'}`)

  // Check if they used their own code
  if (customer.personal_code && customer.used_referral_code) {
    if (customer.personal_code === customer.used_referral_code) {
      console.log(`\n⚠️  ISSUE: Customer used their OWN referral code!`)
      console.log(`   Personal Code: ${customer.personal_code}`)
      console.log(`   Used Code: ${customer.used_referral_code}`)
      console.log(`   This is why they don't have a gift card - self-referral is not allowed.`)
      return { reason: 'self_referral', customer }
    }
  }

  // Check gift cards
  console.log(`\n🎁 Gift Cards in Database:`)
  if (customer.giftCards && customer.giftCards.length > 0) {
    customer.giftCards.forEach((gc, idx) => {
      console.log(`   ${idx + 1}. Gift Card ID: ${gc.square_gift_card_id}`)
      console.log(`      Reward Type: ${gc.reward_type}`)
      console.log(`      State: ${gc.state || 'N/A'}`)
      console.log(`      Balance: $${((gc.current_balance_cents || 0) / 100).toFixed(2)}`)
      console.log(`      Created: ${new Date(gc.created_at).toLocaleString()}`)
    })
  } else {
    console.log(`   ❌ No gift cards found in gift_cards table`)
  }

  // Check if gift_card_id exists but no gift card record
  if (customer.gift_card_id && (!customer.giftCards || customer.giftCards.length === 0)) {
    console.log(`\n⚠️  ISSUE: Customer has gift_card_id (${customer.gift_card_id}) but no record in gift_cards table`)
    console.log(`   This needs to be backfilled from Square API`)
    return { reason: 'missing_gift_card_record', customer, gift_card_id: customer.gift_card_id }
  }

  // Check who owns the referral code they used
  if (customer.used_referral_code) {
    console.log(`\n🔍 Checking Referral Code Owner:`)
    const referrer = await prisma.squareExistingClient.findFirst({
      where: {
        OR: [
          { personal_code: customer.used_referral_code },
          { referral_code: customer.used_referral_code }
        ]
      },
      select: {
        square_customer_id: true,
        given_name: true,
        family_name: true,
        email_address: true,
        personal_code: true,
        activated_as_referrer: true
      }
    })

    if (referrer) {
      console.log(`   ✅ Found referrer:`)
      console.log(`      Name: ${referrer.given_name || ''} ${referrer.family_name || ''}`.trim())
      console.log(`      Email: ${referrer.email_address || 'N/A'}`)
      console.log(`      Customer ID: ${referrer.square_customer_id}`)
      console.log(`      Personal Code: ${referrer.personal_code || 'N/A'}`)
      console.log(`      Activated as Referrer: ${referrer.activated_as_referrer ? 'Yes' : 'No'}`)
      
      if (referrer.square_customer_id === customer.square_customer_id) {
        console.log(`\n⚠️  ISSUE: Customer used their OWN referral code!`)
        return { reason: 'self_referral', customer, referrer }
      }
    } else {
      console.log(`   ⚠️  Referral code owner not found in database`)
      console.log(`   Code: ${customer.used_referral_code}`)
      return { reason: 'referrer_not_found', customer, code: customer.used_referral_code }
    }
  }

  // Check if they got signup bonus but no gift card
  if (customer.got_signup_bonus && (!customer.giftCards || customer.giftCards.length === 0)) {
    console.log(`\n⚠️  ISSUE: Customer has got_signup_bonus=true but no gift card`)
    return { reason: 'signup_bonus_flag_but_no_gift_card', customer }
  }

  // Check if first payment was completed
  if (!customer.first_payment_completed) {
    console.log(`\nℹ️  Note: First payment not completed yet`)
    console.log(`   Friend gift card should be created when booking is made`)
    console.log(`   Referrer gift card should be created when friend's first payment is completed`)
  }

  return { reason: 'unknown', customer }
}

async function main() {
  console.log('🔍 INVESTIGATING MISSING GIFT CARDS')
  console.log('='.repeat(80))

  // Customers to investigate (excluding Umit - test account)
  const customersToCheck = [
    {
      customerId: 'RPYQ4PHVGK1E2HPRGJFH215P4C',
      name: 'Laura Craciun',
      usedCode: 'KATHLEEN9248'
    },
    {
      customerId: 'WGKFCXD42JE1QPFBNX5DS2D0NG',
      name: 'Kate Rodgers',
      usedCode: 'KATE1520'
    },
    {
      customerId: 'V90JS9Z5CCW3EWM9Q0ET6NCQG0',
      name: 'Estefany Maldonado',
      usedCode: 'LIZBETH6068'
    }
  ]

  const results = []

  for (const customerInfo of customersToCheck) {
    const result = await investigateCustomer(
      customerInfo.customerId,
      customerInfo.name,
      customerInfo.usedCode
    )
    results.push({ ...customerInfo, result })
  }

  // Summary
  console.log(`\n\n${'='.repeat(80)}`)
  console.log('📊 SUMMARY')
  console.log('='.repeat(80))

  const byReason = {}
  results.forEach(({ name, result }) => {
    const reason = result?.reason || 'unknown'
    if (!byReason[reason]) {
      byReason[reason] = []
    }
    byReason[reason].push(name)
  })

  Object.entries(byReason).forEach(([reason, names]) => {
    console.log(`\n${reason}: ${names.length} customer(s)`)
    names.forEach(name => console.log(`   - ${name}`))
  })

  console.log(`\n${'='.repeat(80)}`)
  console.log('✅ Investigation complete!')
  console.log('='.repeat(80))
}

// Run the script
if (require.main === module) {
  main()
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
    .finally(() => {
      prisma.$disconnect()
    })
}

module.exports = { main, investigateCustomer }



