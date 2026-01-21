#!/usr/bin/env node

/**
 * Replay recent Square events by re-sending webhook-style payloads
 * to the production webhook handler. Useful for backfilling events
 * that previously failed signature verification.
 *
 * Usage examples:
 *   node scripts/replay-square-events.js --begin 2025-11-08T00:00:00Z --end 2025-11-10T00:00:00Z --types customer.created,payment.updated
 *
 * Required environment variables:
 *   SQUARE_ACCESS_TOKEN
 *   SQUARE_WEBHOOK_SIGNATURE_KEY
 *   SQUARE_WEBHOOK_NOTIFICATION_URL
 *
 * Optional environment variables:
 *   SQUARE_ENVIRONMENT (defaults to 'production')
 *   SQUARE_MERCHANT_ID (if omitted the script will fetch the first merchant)
 */

const crypto = require('crypto')
const path = require('path')

// Attempt to load local .env if present
try {
  require('dotenv').config({
    path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env'),
  })
} catch (err) {
  // dotenv is optional; ignore if not installed
}

const { Client, Environment } = require('square')

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.trim()
const SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim()
const NOTIFICATION_URL = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL?.trim()
const SQUARE_ENV = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase()

if (!ACCESS_TOKEN || !SIGNATURE_KEY || !NOTIFICATION_URL) {
  console.error('❌ Missing required Square environment variables.')
  console.error('Ensure SQUARE_ACCESS_TOKEN, SQUARE_WEBHOOK_SIGNATURE_KEY, and SQUARE_WEBHOOK_NOTIFICATION_URL are set.')
  process.exit(1)
}

const env =
  SQUARE_ENV === 'sandbox'
    ? Environment.Sandbox
    : Environment.Production

const squareClient = new Client({
  accessToken: ACCESS_TOKEN,
  environment: env,
})

function parseCliArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('-')) continue

    let key = token.replace(/^-+/, '')
    let value = true

    const next = argv[i + 1]
    if (next && !next.startsWith('-')) {
      value = next
      i += 1
    }

    if (key.includes('=')) {
      const [k, v] = key.split('=')
      key = k
      value = v
    }

    result[key] = value
  }
  return result
}

const cliArgs = parseCliArgs(process.argv.slice(2))

const beginTime = cliArgs.begin || cliArgs.b || null
const endTime = cliArgs.end || cliArgs.e || null
const requestedTypes = ((cliArgs.types || cliArgs.t) || 'customer.created,booking.created,payment.created,payment.updated')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

function logConfig() {
  console.log('⚙️  Replay configuration:')
  console.log(`   ▸ Environment: ${SQUARE_ENV}`)
  console.log(`   ▸ Notification URL: ${NOTIFICATION_URL}`)
  console.log(`   ▸ Signature key length: ${SIGNATURE_KEY.length}`)
  console.log(`   ▸ Begin time: ${beginTime || '(none - using API defaults)'}`)
  console.log(`   ▸ End time: ${endTime || '(none - using API defaults)'}`)
  console.log(`   ▸ Event types: ${requestedTypes.join(', ')}`)
}

function createSignature(body) {
  return crypto
    .createHmac('sha256', SIGNATURE_KEY)
    .update(`${NOTIFICATION_URL}${body}`)
    .digest('base64')
}

function stringifyEvent(payload) {
  return JSON.stringify(payload, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )
}

async function sendWebhookPayload(eventPayload) {
  const body = stringifyEvent(eventPayload)
  const signature = createSignature(body)

  const response = await fetch(NOTIFICATION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-square-hmacsha256-signature': signature,
      'square-replay': 'true',
    },
    body,
  })

  const text = await response.text()
  const preview = text.slice(0, 200)

  if (response.ok) {
    console.log(`✅ Replay succeeded for ${eventPayload.type} (${eventPayload.data.id}) [${response.status}]`)
  } else {
    console.error(`❌ Replay failed for ${eventPayload.type} (${eventPayload.data.id}) [${response.status}]`)
    console.error(`   Response preview: ${preview}`)
  }
}

function buildEventEnvelope({ type, resourceType, resource, merchantId }) {
  return {
    merchant_id: merchantId || null,
    type,
    event_id: `replay-${resourceType}-${resource.id}`,
    created_at: resource.updatedAt || resource.createdAt || new Date().toISOString(),
    data: {
      type: resourceType,
      id: resource.id,
      object: {
        [resourceType]: resource,
      },
    },
  }
}

async function replayCustomers(merchantId) {
  console.log('🔄 Fetching customers for replay...')
  let cursor
  let total = 0

  do {
    const response = await squareClient.customersApi.listCustomers(cursor)
    const customers = response.result?.customers || []
    cursor = response.result?.cursor

    for (const customer of customers) {
      if (beginTime && customer.createdAt && customer.createdAt < beginTime) {
        continue
      }
      if (endTime && customer.createdAt && customer.createdAt > endTime) {
        continue
      }

      const event = buildEventEnvelope({
        type: 'customer.created',
        resourceType: 'customer',
        resource: customer,
        merchantId,
      })
      await sendWebhookPayload(event)
      total += 1
    }
  } while (cursor)

  console.log(`✔️  Replayed ${total} customer.created events`)
}

async function replayBookings(merchantId) {
  console.log('🔄 Fetching bookings for replay...')
  let cursor
  let total = 0

  do {
    const response = await squareClient.bookingsApi.listBookings(
      100, // limit
      cursor,
      undefined, // customerId
      undefined, // teamMemberId
      undefined, // locationId
      beginTime || undefined,
      endTime || undefined
    )

    const bookings = response.result?.bookings || []
    cursor = response.result?.cursor

    for (const booking of bookings) {
      const event = buildEventEnvelope({
        type: 'booking.created',
        resourceType: 'booking',
        resource: booking,
        merchantId,
      })
      event.__metadata = event.__metadata || {}
      if (booking?.locationId) {
        event.__metadata.locationId = booking.locationId
      }
      await sendWebhookPayload(event)
      total += 1
    }
  } while (cursor)

  console.log(`✔️  Replayed ${total} booking.created events`)
}

async function replayPayments(merchantId, eventType) {
  console.log(`🔄 Fetching payments for ${eventType} replay...`)
  let cursor
  let total = 0

  do {
    const response = await squareClient.paymentsApi.listPayments(
      beginTime || undefined,
      endTime || undefined,
      'ASC',
      cursor
    )

    const payments = response.result?.payments || []
    cursor = response.result?.cursor

    for (const payment of payments) {
      const event = buildEventEnvelope({
        type: eventType,
        resourceType: 'payment',
        resource: payment,
        merchantId,
      })
      event.__metadata = event.__metadata || {}
      if (payment?.locationId) {
        event.__metadata.locationId = payment.locationId
      }
      await sendWebhookPayload(event)
      total += 1
    }
  } while (cursor)

  console.log(`✔️  Replayed ${total} ${eventType} events`)
}

async function getMerchantId() {
  if (process.env.SQUARE_MERCHANT_ID?.trim()) {
    return process.env.SQUARE_MERCHANT_ID.trim()
  }

  const response = await squareClient.merchantsApi.listMerchants()
  const merchant = response.result?.merchants?.[0]
  if (!merchant) {
    throw new Error('Unable to determine merchant_id. Set SQUARE_MERCHANT_ID in the environment.')
  }
  return merchant.id
}

async function main() {
  logConfig()
  const merchantId = await getMerchantId()
  console.log(`   ▸ Using merchant_id: ${merchantId}`)

  if (requestedTypes.includes('customer.created')) {
    await replayCustomers(merchantId)
  }

  if (requestedTypes.includes('booking.created')) {
    await replayBookings(merchantId)
  }

  if (requestedTypes.includes('payment.created')) {
    await replayPayments(merchantId, 'payment.created')
  }

  if (requestedTypes.includes('payment.updated')) {
    await replayPayments(merchantId, 'payment.updated')
  }

  console.log('✅ Replay complete')
}

main().catch(error => {
  console.error('❌ Replay failed with error:', error.message)
  console.error(error)
  process.exit(1)
})

