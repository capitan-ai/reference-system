#!/usr/bin/env node
/**
 * Analyze gift cards created and referral codes used in the last N days
 * 
 * Usage: node scripts/analyze-gift-cards-and-referrals.js [--days=14]
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// Parse command line arguments
const args = process.argv.slice(2)
const daysArg = args.find(arg => arg.startsWith('--days='))
const days = daysArg ? parseInt(daysArg.split('=')[1]) || 14 : 14

function formatMoney(cents) {
  if (!cents || !Number.isFinite(cents)) return '$0.00'
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(date) {
  if (!date) return 'N/A'
  return new Date(date).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function analyzeGiftCards(daysBack) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  console.log(`\n🎁 GIFT CARDS CREATED (Last ${daysBack} days)`)
  console.log('='.repeat(80))
  console.log(`Cutoff date: ${formatDate(cutoffDate)}\n`)

  // Get all gift cards created in the period
  const giftCards = await prisma.giftCard.findMany({
    where: {
      created_at: {
        gte: cutoffDate
      }
    },
    include: {
      customer: {
        select: {
          given_name: true,
          family_name: true,
          email_address: true,
          used_referral_code: true,
          got_signup_bonus: true,
          activated_as_referrer: true,
          personal_code: true
        }
      },
      transactions: {
        where: {
          transaction_type: 'CREATE'
        },
        take: 1,
        orderBy: {
          created_at: 'asc'
        }
      }
    },
    orderBy: {
      created_at: 'desc'
    }
  })

  console.log(`Total gift cards created: ${giftCards.length}\n`)

  // Group by reward type
  const byRewardType = {
    FRIEND_SIGNUP_BONUS: [],
    REFERRER_REWARD: []
  }

  let totalInitialAmount = 0
  let totalCurrentBalance = 0

  giftCards.forEach(gc => {
    byRewardType[gc.reward_type].push(gc)
    totalInitialAmount += gc.initial_amount_cents || 0
    totalCurrentBalance += gc.current_balance_cents || 0
  })

  console.log(`📊 Summary by Reward Type:`)
  console.log(`   FRIEND_SIGNUP_BONUS: ${byRewardType.FRIEND_SIGNUP_BONUS.length}`)
  console.log(`   REFERRER_REWARD: ${byRewardType.REFERRER_REWARD.length}`)
  console.log(`\n💰 Total Initial Amount: ${formatMoney(totalInitialAmount)}`)
  console.log(`💰 Total Current Balance: ${formatMoney(totalCurrentBalance)}`)
  console.log(`\n📋 Details:\n`)

  // Show details
  for (let idx = 0; idx < giftCards.length; idx++) {
    const gc = giftCards[idx]
    const customer = gc.customer
    const customerName = `${customer?.given_name || ''} ${customer?.family_name || ''}`.trim() || 'Unknown'
    const email = customer?.email_address || 'N/A'
    let referralCode = customer?.used_referral_code || 'N/A'
    const personalCode = customer?.personal_code || 'N/A'

    // Try to get referral code from customer if not already loaded
    if (referralCode === 'N/A' && customer) {
      try {
        const customerData = await prisma.squareExistingClient.findUnique({
          where: { square_customer_id: gc.square_customer_id },
          select: { used_referral_code: true }
        })
        referralCode = customerData?.used_referral_code || 'N/A'
      } catch (e) {
        // Ignore
      }
    }

    console.log(`${idx + 1}. ${customerName}`)
    console.log(`   Email: ${email}`)
    console.log(`   Gift Card ID: ${gc.square_gift_card_id}`)
    console.log(`   GAN: ${gc.gift_card_gan || 'N/A'}`)
    console.log(`   Reward Type: ${gc.reward_type}`)
    console.log(`   State: ${gc.state || 'N/A'}`)
    console.log(`   Initial Amount: ${formatMoney(gc.initial_amount_cents)}`)
    console.log(`   Current Balance: ${formatMoney(gc.current_balance_cents)}`)
    console.log(`   Used Referral Code: ${referralCode}`)
    console.log(`   Personal Code: ${personalCode}`)
    console.log(`   Created: ${formatDate(gc.created_at)}`)
    console.log('')
  }

  return giftCards
}

async function analyzeReferralCodeUsage(daysBack) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  console.log(`\n🔗 REFERRAL CODES USED (Last ${daysBack} days)`)
  console.log('='.repeat(80))
  console.log(`Cutoff date: ${formatDate(cutoffDate)}\n`)

  // Get customers who used referral codes in the period
  const customersWithReferralCodes = await prisma.$queryRaw`
    SELECT 
      square_customer_id,
      given_name,
      family_name,
      email_address,
      used_referral_code,
      personal_code,
      got_signup_bonus,
      activated_as_referrer,
      created_at,
      updated_at
    FROM square_existing_clients
    WHERE 
      used_referral_code IS NOT NULL
      AND used_referral_code != ''
      AND (
        created_at >= ${cutoffDate}
        OR updated_at >= ${cutoffDate}
      )
    ORDER BY created_at DESC
  `

  console.log(`Total customers who used referral codes: ${customersWithReferralCodes.length}\n`)

  // Group by referral code
  const byReferralCode = {}
  customersWithReferralCodes.forEach(customer => {
    const code = customer.used_referral_code
    if (!byReferralCode[code]) {
      byReferralCode[code] = []
    }
    byReferralCode[code].push(customer)
  })

  console.log(`📊 Summary by Referral Code:`)
  const codeEntries = Object.entries(byReferralCode).sort((a, b) => b[1].length - a[1].length)
  codeEntries.forEach(([code, users]) => {
    console.log(`   ${code}: ${users.length} user(s)`)
  })

  console.log(`\n📋 Details:\n`)

  customersWithReferralCodes.forEach((customer, idx) => {
    const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
    console.log(`${idx + 1}. ${customerName}`)
    console.log(`   Email: ${customer.email_address || 'N/A'}`)
    console.log(`   Customer ID: ${customer.square_customer_id}`)
    console.log(`   Used Referral Code: ${customer.used_referral_code}`)
    console.log(`   Personal Code: ${customer.personal_code || 'N/A'}`)
    console.log(`   Got Signup Bonus: ${customer.got_signup_bonus ? 'Yes' : 'No'}`)
    console.log(`   Activated as Referrer: ${customer.activated_as_referrer ? 'Yes' : 'No'}`)
    console.log(`   Created: ${formatDate(customer.created_at)}`)
    console.log('')
  })

  return customersWithReferralCodes
}

async function analyzeRefClicks(daysBack) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  console.log(`\n👆 REFERRAL LINK CLICKS (Last ${daysBack} days)`)
  console.log('='.repeat(80))
  console.log(`Cutoff date: ${formatDate(cutoffDate)}\n`)

  let refClicks = []
  try {
    refClicks = await prisma.refClick.findMany({
      where: {
        firstSeenAt: {
          gte: cutoffDate
        }
      },
      include: {
        customer: {
          select: {
            given_name: true,
            family_name: true,
            email_address: true
          }
        }
      },
      orderBy: {
        firstSeenAt: 'desc'
      }
    })
  } catch (error) {
    if (error.code === 'P2021') {
      console.log('⚠️  ref_clicks table does not exist - skipping referral click analysis\n')
      return []
    }
    throw error
  }

  console.log(`Total referral link clicks: ${refClicks.length}\n`)

  // Group by referral code
  const byRefCode = {}
  refClicks.forEach(click => {
    const code = click.refCode
    if (!byRefCode[code]) {
      byRefCode[code] = []
    }
    byRefCode[code].push(click)
  })

  console.log(`📊 Summary by Referral Code:`)
  const codeEntries = Object.entries(byRefCode).sort((a, b) => b[1].length - a[1].length)
  codeEntries.forEach(([code, clicks]) => {
    const matched = clicks.filter(c => c.matched).length
    console.log(`   ${code}: ${clicks.length} click(s), ${matched} matched`)
  })

  console.log(`\n📋 Recent Clicks (showing first 20):\n`)

  refClicks.slice(0, 20).forEach((click, idx) => {
    const customer = click.customer
    const customerName = customer 
      ? `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
      : 'Not matched'
    
    console.log(`${idx + 1}. Referral Code: ${click.refCode}`)
    console.log(`   Customer: ${customerName}`)
    console.log(`   Matched: ${click.matched ? 'Yes' : 'No'}`)
    console.log(`   First Seen: ${formatDate(click.firstSeenAt)}`)
    if (click.landingUrl) {
      console.log(`   Landing URL: ${click.landingUrl.substring(0, 60)}...`)
    }
    console.log('')
  })

  return refClicks
}

async function crossReference(giftCards, customersWithReferralCodes) {
  console.log(`\n🔗 CROSS-REFERENCE ANALYSIS`)
  console.log('='.repeat(80))
  console.log('')

  // Find customers who used referral codes AND got gift cards
  const customersWithBoth = []
  const customersWithCodeButNoGiftCard = []
  const customersWithGiftCardButNoCode = []

  // Build a map of customer IDs to gift cards
  const giftCardMap = new Map()
  giftCards.forEach(gc => {
    if (!giftCardMap.has(gc.square_customer_id)) {
      giftCardMap.set(gc.square_customer_id, [])
    }
    giftCardMap.get(gc.square_customer_id).push(gc)
  })

  // Build a map of customer IDs to referral code usage
  const referralCodeMap = new Map()
  customersWithReferralCodes.forEach(customer => {
    referralCodeMap.set(customer.square_customer_id, customer)
  })

  // Analyze
  customersWithReferralCodes.forEach(customer => {
    const giftCardsForCustomer = giftCardMap.get(customer.square_customer_id) || []
    if (giftCardsForCustomer.length > 0) {
      customersWithBoth.push({
        customer,
        giftCards: giftCardsForCustomer
      })
    } else {
      customersWithCodeButNoGiftCard.push(customer)
    }
  })

  giftCards.forEach(gc => {
    if (!referralCodeMap.has(gc.square_customer_id)) {
      customersWithGiftCardButNoCode.push(gc)
    }
  })

  console.log(`📊 Cross-Reference Summary:`)
  console.log(`   Customers with referral code AND gift card: ${customersWithBoth.length}`)
  console.log(`   Customers with referral code but NO gift card: ${customersWithCodeButNoGiftCard.length}`)
  console.log(`   Gift cards for customers with NO referral code: ${customersWithGiftCardButNoCode.length}`)
  console.log('')

  if (customersWithCodeButNoGiftCard.length > 0) {
    console.log(`\n⚠️  Customers who used referral codes but have NO gift cards:`)
    customersWithCodeButNoGiftCard.slice(0, 10).forEach((customer, idx) => {
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
      console.log(`   ${idx + 1}. ${name} (${customer.email_address || 'N/A'}) - Code: ${customer.used_referral_code}`)
    })
    if (customersWithCodeButNoGiftCard.length > 10) {
      console.log(`   ... and ${customersWithCodeButNoGiftCard.length - 10} more`)
    }
    console.log('')
  }

  if (customersWithGiftCardButNoCode.length > 0) {
    console.log(`\n⚠️  Gift cards for customers with NO referral code:`)
    customersWithGiftCardButNoCode.slice(0, 10).forEach((gc, idx) => {
      const customer = gc.customer
      const name = `${customer?.given_name || ''} ${customer?.family_name || ''}`.trim() || 'Unknown'
      console.log(`   ${idx + 1}. ${name} (${customer?.email_address || 'N/A'}) - ${gc.reward_type}`)
    })
    if (customersWithGiftCardButNoCode.length > 10) {
      console.log(`   ... and ${customersWithGiftCardButNoCode.length - 10} more`)
    }
    console.log('')
  }
}

async function main() {
  console.log('📊 GIFT CARDS & REFERRAL CODE ANALYSIS')
  console.log('='.repeat(80))
  console.log(`Analyzing data for the last ${days} days\n`)

  try {
    // Analyze gift cards
    const giftCards = await analyzeGiftCards(days)

    // Analyze referral code usage
    const customersWithReferralCodes = await analyzeReferralCodeUsage(days)

    // Analyze referral link clicks
    const refClicks = await analyzeRefClicks(days)

    // Cross-reference
    await crossReference(giftCards, customersWithReferralCodes)

    console.log('\n' + '='.repeat(80))
    console.log('✅ Analysis complete!')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('\n❌ Error during analysis:', error)
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

module.exports = { main, analyzeGiftCards, analyzeReferralCodeUsage, analyzeRefClicks }

