#!/usr/bin/env node

/**
 * Find payments (including updated events) for a given Square customer ID.
 *
 * Usage:
 *   node scripts/find-payments-by-customer.js CUSTOMER_ID [--begin ISO_DATE] [--end ISO_DATE]
 *
 * Requirements:
 *   SQUARE_ACCESS_TOKEN
 *   SQUARE_ENVIRONMENT (optional, defaults to 'production')
 */

const path = require('path')
const fs = require('fs')

try {
  // Allow local .env for convenience
  const dotenvPath = process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath })
  }
} catch (error) {
  // dotenv is optional; ignore if not installed
}

const { Client, Environment } = require('square')

function usage() {
  console.log('Usage: node scripts/find-payments-by-customer.js CUSTOMER_ID [--begin ISO_DATE] [--end ISO_DATE]')
  process.exit(1)
}

function parseArgs(argv) {
  const args = {}
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args[key] = next
        i += 1
      } else {
        args[key] = true
      }
    } else if (token.startsWith('-')) {
      const key = token.slice(1)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args[key] = next
        i += 1
      } else {
        args[key] = true
      }
    } else {
      positional.push(token)
    }
  }
  return { args, positional }
}

async function main() {
  const { args, positional } = parseArgs(process.argv.slice(2))
  if (positional.length === 0) {
    usage()
  }

  const customerId = positional[0]
  const beginTime = args.begin || null
  const endTime = args.end || null

  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (!accessToken) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN environment variable.')
    process.exit(1)
  }

  const environmentName = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase()
  const environment = environmentName === 'sandbox' ? Environment.Sandbox : Environment.Production

  const client = new Client({
    accessToken,
    environment,
  })

  console.log('🔍 Searching payments for customer:', customerId)
  if (beginTime) console.log('   ▸ beginTime:', beginTime)
  if (endTime) console.log('   ▸ endTime:', endTime)
  console.log('   ▸ Environment:', environmentName)

  let cursor
  let total = 0
  const matches = []

  do {
    const response = await client.paymentsApi.listPayments(
      beginTime || undefined,
      endTime || undefined,
      'ASC',
      cursor
    )

    const payments = response.result?.payments || []
    cursor = response.result?.cursor

    for (const payment of payments) {
      if (payment.customerId === customerId || payment.customer_id === customerId) {
        matches.push(payment)
        total += 1
      }
    }
  } while (cursor)

  if (matches.length === 0) {
    console.log('ℹ️ No payments found for this customer in the specified window.')
    return
  }

  console.log(`✅ Found ${matches.length} payment(s) for customer ${customerId}`)
  for (const payment of matches) {
    console.log('-----------------------------')
    console.log(`Payment ID: ${payment.id}`)
    console.log(`Status: ${payment.status}`)
    console.log(`Amount: ${payment.totalMoney?.amount} ${payment.totalMoney?.currency}`)
    console.log(`Created: ${payment.createdAt}`)
    console.log(`Updated: ${payment.updatedAt}`)
    console.log(`Location: ${payment.locationId}`)
    if (payment.orderId) {
      console.log(`Order ID: ${payment.orderId}`)
    }
    if (payment.cardDetails?.card?.cardBrand) {
      console.log(`Card Brand: ${payment.cardDetails.card.cardBrand}`)
    }
  }

  console.log('-----------------------------')
  console.log('Tip: Use the replay script if you need to simulate payment.updated webhook deliveries.')
}

main().catch(error => {
  console.error('❌ Error fetching payments:', error.message)
  if (error.errors) {
    console.error(JSON.stringify(error.errors, null, 2))
  }
  process.exit(1)
})

