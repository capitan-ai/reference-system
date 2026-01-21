#!/usr/bin/env node

/**
 * Fetch activity history for a Square gift card by GAN (gift card account number) or gift card ID.
 *
 * Usage:
 *   node scripts/get-gift-card-activity.js 7783327275110349
 *   node scripts/get-gift-card-activity.js --id GIFT_CARD_ID
 *
 * Requirements:
 *   SQUARE_ACCESS_TOKEN
 *   (optional) SQUARE_ENVIRONMENT (defaults to 'production')
 */

const path = require('path')
const fs = require('fs')

try {
  const dotenvPath = process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env')
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath })
  }
} catch (error) {
  // noop – dotenv optional
}

function usage() {
  console.log('Usage: node scripts/get-gift-card-activity.js <GAN> [--limit N] [--cursor CURSOR]')
  console.log('   or: node scripts/get-gift-card-activity.js --id <GIFT_CARD_ID>')
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

function formatMoney(money) {
  if (!money) return '0'
  const amount = typeof money.amount === 'bigint' ? Number(money.amount) : money.amount
  return `${(amount || 0) / 100} ${money.currency || 'USD'}`
}

async function listActivities({ baseUrl, accessToken, giftCardId, giftCardGan, limit, cursor }) {
  const descriptor = giftCardId ? `gift card ${giftCardId}` : `gift card GAN ${giftCardGan}`
  console.log(`📜 Fetching activities for ${descriptor}`)

  const body = {
    limit,
  }

  if (cursor) {
    body.cursor = cursor
  }

  if (giftCardId) {
    body.gift_card_id = giftCardId
  } else if (giftCardGan) {
    body.gift_card_gan = giftCardGan
  } else {
    throw new Error('Either gift card ID or GAN must be provided.')
  }

  const response = await fetch(`${baseUrl}/gift-card-activities/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': '2025-10-16',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Request failed [${response.status}] ${text}`)
  }

  const json = await response.json()
  const activities = json.gift_card_activities || []
  if (activities.length === 0) {
    console.log('ℹ️ No activities found for this card.')
    return
  }

  for (const activity of activities) {
    const balance = formatMoney(activity.gift_card_balance_money)
    const details = activity.activate_activity_details ||
      activity.load_activity_details ||
      activity.adjust_increment_activity_details ||
      activity.adjust_decrement_activity_details ||
      activity.redeem_activity_details ||
      activity.clear_balance_activity_details ||
      {}
    const amount = formatMoney(details.amount_money)

    console.log('-----------------------------')
    console.log(`Activity ID: ${activity.id}`)
    console.log(`Type: ${activity.type}`)
    console.log(`Status: ${activity.status}`)
    console.log(`Location: ${activity.location_id || 'N/A'}`)
    console.log(`Created at: ${activity.created_at}`)
    console.log(`Amount: ${amount}`)
    console.log(`Balance after activity: ${balance}`)

    if (activity.type === 'REDEEM' && details.order_id) {
      console.log(`Redeem order ID: ${details.order_id}`)
    }

    if (activity.metadata) {
      console.log(`Metadata: ${JSON.stringify(activity.metadata)}`)
    }
  }

  if (json.cursor) {
    console.log('-----------------------------')
    console.log(`More activities available. Next cursor: ${json.cursor}`)
  }
}

async function main() {
  const { args, positional } = parseArgs(process.argv.slice(2))
  const limit = args.limit ? Number(args.limit) : 50
  const cursor = args.cursor || null
  let giftCardId = args.id || null

  if (!giftCardId && positional.length === 0) {
    usage()
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (!accessToken) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN environment variable.')
    process.exit(1)
  }

  const environmentName = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase()
  const environment = environmentName === 'sandbox' ? Environment.Sandbox : Environment.Production

  let gan = null
  if (!giftCardId) {
    gan = positional[0]
  }

  console.log(`⚙️  Environment: ${environmentName}`)
  if (giftCardId) console.log(`   Gift card ID: ${giftCardId}`)
  if (gan) console.log(`   GAN: ${gan}`)
  console.log(`   Limit: ${limit}`)
  if (cursor) console.log(`   Cursor: ${cursor}`)

  const baseUrl =
    environmentName === 'sandbox'
      ? 'https://connect.squareupsandbox.com/v2'
      : 'https://connect.squareup.com/v2'

  await listActivities({
    baseUrl,
    accessToken,
    giftCardId,
    giftCardGan: gan,
    limit,
    cursor,
  })
}

main().catch(error => {
  console.error('❌ Failed to fetch gift card activity:', error.message)
  if (error.errors) {
    console.error(JSON.stringify(error.errors, null, 2))
  }
  process.exit(1)
})

