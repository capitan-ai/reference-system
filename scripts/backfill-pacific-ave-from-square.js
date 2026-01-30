#!/usr/bin/env node
/**
 * Direct Backfill Script for Pacific Ave Location
 * 
 * Fetches bookings and payments from Square API and saves them directly to database.
 * This bypasses webhook handlers and saves data directly.
 * 
 * Usage: node scripts/backfill-pacific-ave-from-square.js --begin 2026-01-02T00:00:00Z
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { Client, Environment } = require('square')
const { resolveLocationUuidForSquareLocationId } = require('../lib/location-resolver')

const PACIFIC_AVE_SQUARE_LOCATION_ID = 'LNQKVBTQZN3EZ'
const ORGANIZATION_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'

// Parse CLI args
const args = process.argv.slice(2)
let beginTime = null
let endTime = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--begin' && i + 1 < args.length) {
    beginTime = args[i + 1]
  } else if (args[i].startsWith('--begin=')) {
    beginTime = args[i].split('=')[1]
  }
  if (args[i] === '--end' && i + 1 < args.length) {
    endTime = args[i + 1]
  } else if (args[i].startsWith('--end=')) {
    endTime = args[i].split('=')[1]
  }
}

// Setup Square client
const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
if (!accessToken) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN environment variable')
  process.exit(1)
}

const envName = (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
const squareClient = new Client({ accessToken, environment })

// Helper function to get value from either camelCase or snake_case
function getValue(obj, ...keys) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) {
      return obj[key]
    }
  }
  return null
}

async function getPacificAveLocationUuid() {
  const result = await prisma.$queryRaw`
    SELECT id FROM locations 
    WHERE square_location_id = ${PACIFIC_AVE_SQUARE_LOCATION_ID}
      AND organization_id = ${ORGANIZATION_ID}::uuid
    LIMIT 1
  `
  
  if (!result || result.length === 0) {
    throw new Error(`Pacific Ave location not found (square_location_id: ${PACIFIC_AVE_SQUARE_LOCATION_ID})`)
  }
  
  return result[0].id
}

async function resolveOrganizationId(merchantId) {
  if (!merchantId) return null
  try {
    const org = await prisma.$queryRaw`
      SELECT id FROM organizations 
      WHERE square_merchant_id = ${merchantId}
      LIMIT 1
    `
    return org && org.length > 0 ? org[0].id : null
  } catch (err) {
    console.warn(`⚠️ Could not resolve organization_id from merchant_id: ${err.message}`)
    return null
  }
}

async function ensureLocationExists(squareLocationId, organizationId) {
  return resolveLocationUuidForSquareLocationId(prisma, squareLocationId, organizationId)
}

// Import savePaymentToDatabase logic directly
async function savePaymentFromSquare(payment, pacificAveUuid) {
  try {
    const paymentId = payment.id
    const customerId = getValue(payment, 'customerId', 'customer_id')
    let locationId = getValue(payment, 'locationId', 'location_id')
    const orderId = getValue(payment, 'orderId', 'order_id')
    const merchantId = getValue(payment, 'merchantId', 'merchant_id')

    // Only process Pacific Ave payments
    if (locationId !== PACIFIC_AVE_SQUARE_LOCATION_ID) {
      return { skipped: true, reason: 'not_pacific_ave' }
    }

    // Resolve organization_id
    let organizationId = await resolveOrganizationId(merchantId)
    if (!organizationId) {
      organizationId = ORGANIZATION_ID // Fallback to known org ID
    }

    // Ensure location exists
    const locationUuid = await ensureLocationExists(locationId, organizationId)
    if (!locationUuid || locationUuid !== pacificAveUuid) {
      console.warn(`⚠️ Payment ${paymentId} location mismatch or not found`)
      return { skipped: true, reason: 'location_mismatch' }
    }

    // Check if payment already exists
    const existing = await prisma.$queryRaw`
      SELECT id FROM payments 
      WHERE payment_id = ${paymentId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    if (existing && existing.length > 0) {
      // Update location_id if it's wrong
      if (existing[0].id) {
        await prisma.$executeRaw`
          UPDATE payments
          SET location_id = ${pacificAveUuid}::uuid,
              updated_at = NOW()
          WHERE id = ${existing[0].id}::uuid
            AND (location_id IS NULL OR location_id != ${pacificAveUuid}::uuid)
        `
      }
      return { skipped: true, reason: 'already_exists' }
    }

    // Extract payment data
    const amountMoney = getValue(payment, 'amountMoney', 'amount_money') || {}
    const tipMoney = getValue(payment, 'tipMoney', 'tip_money') || {}
    const totalMoney = getValue(payment, 'totalMoney', 'total_money') || {}
    const approvedMoney = getValue(payment, 'approvedMoney', 'approved_money') || {}
    const cardDetails = getValue(payment, 'cardDetails', 'card_details') || {}
    const processingFees = getValue(payment, 'processingFee', 'processing_fee') || []
    const firstProcessingFee = Array.isArray(processingFees) ? processingFees[0] : processingFees

    // Get order UUID if orderId exists
    let orderUuid = null
    if (orderId) {
      const orderRecord = await prisma.$queryRaw`
        SELECT id FROM orders 
        WHERE order_id = ${orderId}
          AND organization_id = ${organizationId}::uuid
        LIMIT 1
      `
      orderUuid = orderRecord && orderRecord.length > 0 ? orderRecord[0].id : null
    }

    // Save payment
    await prisma.$executeRaw`
      INSERT INTO payments (
        id, organization_id, payment_id, event_type, merchant_id,
        customer_id, location_id, order_id, booking_id,
        amount_money_amount, amount_money_currency,
        tip_money_amount, tip_money_currency,
        total_money_amount, total_money_currency,
        approved_money_amount, approved_money_currency,
        status, source_type, delay_action,
        card_details_card_brand, card_details_card_last_4,
        card_details_entry_method, card_details_status,
        card_payment_timeline_authorized_at, card_payment_timeline_captured_at,
        processing_fee_amount, processing_fee_currency, processing_fee_type,
        application_details_application_id, application_details_square_product,
        device_details_device_id, device_details_device_installation_id,
        created_at, updated_at, raw_json
      ) VALUES (
        gen_random_uuid(),
        ${organizationId}::uuid,
        ${paymentId},
        ${'payment.created'},
        ${merchantId || null},
        ${customerId || null},
        ${pacificAveUuid}::uuid,
        ${orderUuid || null},
        ${null},
        ${amountMoney.amount || 0},
        ${amountMoney.currency || 'USD'},
        ${tipMoney.amount || null},
        ${tipMoney.currency || 'USD'},
        ${totalMoney.amount || 0},
        ${totalMoney.currency || 'USD'},
        ${approvedMoney.amount || null},
        ${approvedMoney.currency || 'USD'},
        ${payment.status || null},
        ${getValue(payment, 'sourceType', 'source_type') || null},
        ${getValue(payment, 'delayAction', 'delay_action') || null},
        ${cardDetails.card?.cardBrand || cardDetails.card?.card_brand || null},
        ${cardDetails.card?.last4 || cardDetails.card?.last_4 || null},
        ${cardDetails.entryMethod || cardDetails.entry_method || null},
        ${cardDetails.status || null},
        ${cardDetails.cardPaymentTimeline?.authorizedAt || cardDetails.card_payment_timeline?.authorized_at ? new Date(cardDetails.cardPaymentTimeline?.authorizedAt || cardDetails.card_payment_timeline?.authorized_at) : null}::timestamptz,
        ${cardDetails.cardPaymentTimeline?.capturedAt || cardDetails.card_payment_timeline?.captured_at ? new Date(cardDetails.cardPaymentTimeline?.capturedAt || cardDetails.card_payment_timeline?.captured_at) : null}::timestamptz,
        ${firstProcessingFee?.amountMoney?.amount || firstProcessingFee?.amount_money?.amount || null},
        ${firstProcessingFee?.amountMoney?.currency || firstProcessingFee?.amount_money?.currency || 'USD'},
        ${firstProcessingFee?.type || null},
        ${getValue(payment, 'applicationDetails', 'application_details')?.applicationId || getValue(payment, 'applicationDetails', 'application_details')?.application_id || null},
        ${getValue(payment, 'applicationDetails', 'application_details')?.squareProduct || getValue(payment, 'applicationDetails', 'application_details')?.square_product || null},
        ${getValue(payment, 'deviceDetails', 'device_details')?.deviceId || getValue(payment, 'deviceDetails', 'device_details')?.device_id || null},
        ${getValue(payment, 'deviceDetails', 'device_details')?.deviceInstallationId || getValue(payment, 'deviceDetails', 'device_details')?.device_installation_id || null},
        ${payment.createdAt ? new Date(payment.createdAt) : new Date()}::timestamptz,
        ${payment.updatedAt ? new Date(payment.updatedAt) : new Date()}::timestamptz,
        ${JSON.stringify(payment, (key, value) => typeof value === 'bigint' ? value.toString() : value)}::jsonb
      )
      ON CONFLICT (organization_id, payment_id) DO UPDATE SET
        location_id = EXCLUDED.location_id,
        updated_at = EXCLUDED.updated_at
    `

    return { saved: true }
  } catch (error) {
    console.error(`❌ Error saving payment ${payment.id}: ${error.message}`)
    return { saved: false, error: error.message }
  }
}

async function saveBookingFromSquare(booking, pacificAveUuid) {
  try {
    const bookingId = booking.id
    
    // Only process Pacific Ave bookings
    const squareLocationId = booking.locationId || booking.location_id
    if (squareLocationId !== PACIFIC_AVE_SQUARE_LOCATION_ID) {
      return { skipped: true, reason: 'not_pacific_ave' }
    }

    const merchantId = booking.merchantId || booking.merchant_id
    let organizationId = await resolveOrganizationId(merchantId)
    if (!organizationId) {
      organizationId = ORGANIZATION_ID
    }

    // Get customer ID
    const customerId = booking.customerId || booking.customer_id || booking.creator_details?.customer_id || booking.creatorDetails?.customerId

    // Ensure location exists and get UUID
    const locationUuid = await ensureLocationExists(squareLocationId, organizationId)
    if (!locationUuid || locationUuid !== pacificAveUuid) {
      return { skipped: true, reason: 'location_mismatch' }
    }

    const segments = booking.appointmentSegments || booking.appointment_segments || []
    
    // Process each segment (multi-service bookings)
    let savedCount = 0
    for (const segment of segments) {
      const segmentBookingId = segments.length > 1 
        ? `${bookingId}-${segment.serviceVariationId || segment.service_variation_id || 'unknown'}`
        : bookingId

      // Check if already exists
      const existing = await prisma.$queryRaw`
        SELECT id FROM bookings
        WHERE booking_id = ${segmentBookingId}
          AND organization_id = ${organizationId}::uuid
        LIMIT 1
      `
      
      if (existing && existing.length > 0) {
        // Update location_id if wrong
        await prisma.$executeRaw`
          UPDATE bookings
          SET location_id = ${pacificAveUuid}::uuid,
              updated_at = NOW()
          WHERE id = ${existing[0].id}::uuid
            AND (location_id IS NULL OR location_id != ${pacificAveUuid}::uuid)
        `
        continue
      }

      const creatorDetails = booking.creatorDetails || booking.creator_details || {}
      const address = booking.address || {}

      // Save booking
      await prisma.$executeRaw`
        INSERT INTO bookings (
          id, organization_id, booking_id, version, customer_id, location_id, location_type, source,
          start_at, status, all_day, transition_time_minutes,
          creator_type, creator_customer_id, administrator_id,
          address_line_1, locality, administrative_district_level_1, postal_code,
          service_variation_id, service_variation_version, duration_minutes,
          intermission_minutes, technician_id, any_team_member,
          merchant_id, created_at, updated_at, raw_json
        ) VALUES (
          gen_random_uuid(),
          ${organizationId}::uuid,
          ${segmentBookingId},
          ${booking.version || 0},
          ${customerId || null},
          ${pacificAveUuid}::uuid,
          ${booking.locationType || booking.location_type || null},
          ${booking.source || null},
          ${booking.startAt || booking.start_at ? new Date(booking.startAt || booking.start_at) : new Date()}::timestamptz,
          ${booking.status || 'ACCEPTED'},
          ${booking.allDay || booking.all_day || false},
          ${booking.transitionTimeMinutes || booking.transition_time_minutes || 0},
          ${creatorDetails.creatorType || creatorDetails.creator_type || null},
          ${creatorDetails.customerId || creatorDetails.customer_id || null},
          ${null}, -- administrator_id (UUID lookup needed - set to null for now)
          ${address.addressLine1 || address.address_line_1 || null},
          ${address.locality || null},
          ${address.administrativeDistrictLevel1 || address.administrative_district_level_1 || null},
          ${address.postalCode || address.postal_code || null},
          ${null}, -- service_variation_id (UUID lookup needed - set to null for now)
          ${segment.serviceVariationVersion || segment.service_variation_version ? BigInt(segment.serviceVariationVersion || segment.service_variation_version) : null},
          ${segment.durationMinutes || segment.duration_minutes || null},
          ${segment.intermissionMinutes || segment.intermission_minutes || 0},
          ${null}, -- technician_id (UUID lookup needed - set to null for now)
          ${segment.anyTeamMember ?? segment.any_team_member ?? false},
          ${merchantId || null},
          ${booking.createdAt || booking.created_at ? new Date(booking.createdAt || booking.created_at) : new Date()}::timestamptz,
          ${booking.updatedAt || booking.updated_at ? new Date(booking.updatedAt || booking.updated_at) : new Date()}::timestamptz,
          ${JSON.stringify(booking, (key, value) => typeof value === 'bigint' ? value.toString() : value)}::jsonb
        )
        ON CONFLICT (organization_id, booking_id) DO UPDATE SET
          location_id = EXCLUDED.location_id,
          updated_at = EXCLUDED.updated_at
      `
      savedCount++
    }

    return { saved: true, count: savedCount }
  } catch (error) {
    console.error(`❌ Error saving booking ${booking.id}: ${error.message}`)
    return { saved: false, error: error.message }
  }
}

async function backfillPayments(pacificAveUuid) {
  console.log('\n🔄 Fetching payments from Square API...')
  let cursor
  let total = 0
  let saved = 0
  let skipped = 0
  let failed = 0

  do {
    try {
      // Payments API expects dates in RFC 3339 format
      // Square SDK uses positional parameters: beginTime, endTime, sortOrder, cursor
      console.log(`   Fetching payments (beginTime: ${beginTime || 'not set'}, cursor: ${cursor ? 'yes' : 'no'})...`)
      
      // Workaround for Square SDK URL encoding bug: Always provide endTime
      // Use a far future date if not specified (1 year from now)
      const effectiveEndTime = endTime || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      
      // Call with or without cursor depending on whether it exists
      const response = cursor 
        ? await squareClient.paymentsApi.listPayments(beginTime, effectiveEndTime, 'ASC', cursor)
        : await squareClient.paymentsApi.listPayments(beginTime, effectiveEndTime, 'ASC')

      const payments = response.result?.payments || []
      cursor = response.result?.cursor
      
      console.log(`   Found ${payments.length} payments in this batch`)

      for (const payment of payments) {
        total++
        const result = await savePaymentFromSquare(payment, pacificAveUuid)
        if (result.saved) {
          saved++
          console.log(`   ✅ Saved payment ${payment.id}`)
        } else if (result.skipped) {
          skipped++
          if (result.reason !== 'not_pacific_ave') {
            console.log(`   ⏭️  Skipped payment ${payment.id} (${result.reason})`)
          }
        } else {
          failed++
        }
      }
    } catch (error) {
      console.error(`❌ Error fetching payments: ${error.message}`)
      if (error.response) {
        console.error(`   Status: ${error.response.statusCode}`)
        console.error(`   Body:`, JSON.stringify(error.response.body, null, 2))
      }
      if (error.errors) {
        console.error(`   Square API errors:`, JSON.stringify(error.errors, null, 2))
      }
      break
    }
  } while (cursor)

  return { total, saved, skipped, failed }
}

async function backfillBookings(pacificAveUuid) {
  console.log('\n🔄 Fetching bookings from Square API...')
  let cursor
  let total = 0
  let saved = 0
  let skipped = 0
  let failed = 0

  do {
    try {
      // Note: Square API listBookings doesn't support locationId filter directly
      // We'll fetch all bookings and filter client-side
      const response = await squareClient.bookingsApi.listBookings(
        100,
        cursor,
        undefined, // customerId
        undefined, // teamMemberId
        undefined, // locationId - not supported in API
        beginTime || undefined,
        endTime || undefined
      )

      const bookings = response.result?.bookings || []
      cursor = response.result?.cursor

      for (const booking of bookings) {
        total++
        const result = await saveBookingFromSquare(booking, pacificAveUuid)
        if (result.saved) {
          saved++
          console.log(`   ✅ Saved booking ${booking.id} (${result.count || 1} segment(s))`)
        } else if (result.skipped) {
          skipped++
          if (result.reason !== 'not_pacific_ave') {
            console.log(`   ⏭️  Skipped booking ${booking.id} (${result.reason})`)
          }
        } else {
          failed++
        }
      }
    } catch (error) {
      console.error(`❌ Error fetching bookings: ${error.message}`)
      break
    }
  } while (cursor)

  return { total, saved, skipped, failed }
}

async function main() {
  console.log('='.repeat(80))
  console.log('🔄 Pacific Ave Data Backfill from Square API')
  console.log('='.repeat(80))
  console.log(`\nBegin time: ${beginTime || 'not specified'}`)
  console.log(`End time: ${endTime || 'not specified'}`)

  try {
    const pacificAveUuid = await getPacificAveLocationUuid()
    console.log(`\n✅ Pacific Ave location UUID: ${pacificAveUuid}`)

    // Backfill bookings first (payments might reference them)
    const bookingResults = await backfillBookings(pacificAveUuid)
    
    // Then backfill payments
    const paymentResults = await backfillPayments(pacificAveUuid)

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('📊 SUMMARY')
    console.log('='.repeat(80))
    console.log('\nBookings:')
    console.log(`   Total fetched: ${bookingResults.total}`)
    console.log(`   ✅ Saved: ${bookingResults.saved}`)
    console.log(`   ⏭️  Skipped: ${bookingResults.skipped}`)
    console.log(`   ❌ Failed: ${bookingResults.failed}`)
    console.log('\nPayments:')
    console.log(`   Total fetched: ${paymentResults.total}`)
    console.log(`   ✅ Saved: ${paymentResults.saved}`)
    console.log(`   ⏭️  Skipped: ${paymentResults.skipped}`)
    console.log(`   ❌ Failed: ${paymentResults.failed}`)

    const totalSaved = bookingResults.saved + paymentResults.saved
    if (totalSaved > 0) {
      console.log(`\n✅ Successfully backfilled ${totalSaved} records!`)
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

