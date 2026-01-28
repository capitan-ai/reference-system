#!/usr/bin/env node
/**
 * Replay booking.created webhook events for missing bookings
 * 
 * Uses the same pattern as replay-square-events.js to send webhook payloads
 * to the webhook handler, ensuring all business logic is applied correctly.
 * 
 * Usage:
 *   node scripts/replay-missing-bookings.js [missing-bookings-file.json]
 * 
 * Required environment variables:
 *   SQUARE_ACCESS_TOKEN
 *   SQUARE_WEBHOOK_SIGNATURE_KEY
 *   SQUARE_WEBHOOK_NOTIFICATION_URL (or defaults to http://localhost:3000/api/webhooks/square/referrals)
 */

require('dotenv').config()
const crypto = require('crypto')
const { Client, Environment } = require('square')
const { getSquareEnvironmentName } = require('../lib/utils/square-env')
const fs = require('fs')
const path = require('path')

const squareEnvironmentName = getSquareEnvironmentName()
const environment = squareEnvironmentName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const bookingsApi = square.bookingsApi

const SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim()
const NOTIFICATION_URL = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL || 
  process.env.NEXT_PUBLIC_WEBHOOK_URL ||
  'http://localhost:3000/api/webhooks/square/referrals'

function createSignature(body) {
  if (!SIGNATURE_KEY) {
    console.warn('⚠️  SQUARE_WEBHOOK_SIGNATURE_KEY not set, using dummy signature')
    return 'replay-signature'
  }
  const hmac = crypto.createHmac('sha256', SIGNATURE_KEY)
  hmac.update(body)
  return hmac.digest('base64')
}

function stringifyEvent(payload) {
  return JSON.stringify(payload, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )
}

function buildEventEnvelope({ type, resourceType, resource, merchantId }) {
  return {
    type,
    event_id: `replay-${resource.id}-${Date.now()}`,
    created_at: resource.createdAt || resource.created_at || new Date().toISOString(),
    data: {
      type: resourceType,
      id: resource.id,
      object: {
        [resourceType]: resource
      }
    },
    merchant_id: merchantId
  }
}

async function sendWebhookPayload(eventPayload) {
  const body = stringifyEvent(eventPayload)
  const signature = createSignature(body)
  
  try {
    const fetch = (await import('node-fetch')).default
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
    
    if (response.ok) {
      return { success: true }
    } else {
      return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` }
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function main() {
  const filename = process.argv[2] || 'missing-bookings-2026-01-27.json'
  const filepath = path.join(process.cwd(), filename)
  
  if (!fs.existsSync(filepath)) {
    console.error(`❌ File not found: ${filepath}`)
    console.error(`   Usage: node scripts/replay-missing-bookings.js [filename.json]`)
    process.exit(1)
  }
  
  console.log(`📖 Reading missing bookings from: ${filename}\n`)
  console.log(`📡 Webhook URL: ${NOTIFICATION_URL}`)
  if (!SIGNATURE_KEY) {
    console.warn(`⚠️  SQUARE_WEBHOOK_SIGNATURE_KEY not set - webhook may reject requests\n`)
  }
  
  const missingBookings = JSON.parse(fs.readFileSync(filepath, 'utf8'))
  console.log(`📋 Found ${missingBookings.length} missing bookings to replay\n`)
  
  let successCount = 0
  let errorCount = 0
  
  const merchantId = process.env.SQUARE_MERCHANT_ID || null
  
  // Process in batches to avoid rate limits
  const batchSize = 5
  for (let i = 0; i < missingBookings.length; i += batchSize) {
    const batch = missingBookings.slice(i, i + batchSize)
    
    console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (${i + 1}-${Math.min(i + batchSize, missingBookings.length)} of ${missingBookings.length})...`)
    
    const results = await Promise.allSettled(
      batch.map(async (missingBooking) => {
        const bookingId = missingBooking.bookingId
        
        try {
          // Fetch full booking from Square
          const response = await bookingsApi.retrieveBooking(bookingId)
          const booking = response.result?.booking
          
          if (!booking) {
            console.warn(`   ⚠️  Booking ${bookingId} not found in Square`)
            return { success: false, reason: 'not_found' }
          }
          
          // Build webhook event
          const event = buildEventEnvelope({
            type: 'booking.created',
            resourceType: 'booking',
            resource: booking,
            merchantId,
          })
          event.__metadata = event.__metadata || {}
          if (booking?.locationId || booking?.location_id) {
            event.__metadata.locationId = booking.locationId || booking.location_id
          }
          
          // Replay webhook event
          const result = await sendWebhookPayload(event)
          
          if (result.success) {
            console.log(`   ✅ Replayed booking ${bookingId}`)
            return { success: true }
          } else {
            console.warn(`   ⚠️  Failed to replay booking ${bookingId}: ${result.error}`)
            return { success: false, error: result.error }
          }
        } catch (error) {
          if (error.statusCode === 403 || (error.errors && error.errors.some(e => e.code === 'FORBIDDEN'))) {
            console.warn(`   ⚠️  Access denied for booking ${bookingId}`)
            return { success: false, reason: 'forbidden' }
          }
          if (error.statusCode === 429) {
            console.warn(`   ⚠️  Rate limited for booking ${bookingId}, will retry`)
            throw error // Will be retried
          }
          console.error(`   ❌ Error processing booking ${bookingId}: ${error.message}`)
          return { success: false, error: error.message }
        }
      })
    )
    
    // Count results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const value = result.value
        if (value && value.success) {
          successCount++
        } else {
          errorCount++
        }
      } else {
        errorCount++
        if (result.reason?.statusCode === 429) {
          // Rate limited, wait and retry this batch
          console.log(`   ⏳ Rate limited, waiting 2 seconds...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          i -= batchSize // Retry this batch
          continue
        }
      }
    }
    
    // Small delay between batches
    if (i + batchSize < missingBookings.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log('\n📊 SUMMARY:\n')
  console.log(`   ✅ Successfully replayed: ${successCount}`)
  console.log(`   ❌ Errors: ${errorCount}`)
  console.log(`   📋 Total missing bookings: ${missingBookings.length}`)
  console.log('\n' + '='.repeat(80))
  console.log('\n💡 Next step: Run the check script again to verify:')
  console.log('   node scripts/check-missing-bookings.js "30 days ago"\n')
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { sendWebhookPayload }
