/**
 * Reconcile Customer Merges from Square
 *
 * Square merges duplicate customer profiles, changing customer_ids on orders/bookings.
 * Our DB retains old IDs, breaking booking-order linkage.
 *
 * This script:
 * 1. Finds completed service orders without bookings
 * 2. Calls Square Orders API to get the current (post-merge) customer_id
 * 3. Updates DB customer_id if it differs (on orders + square_existing_clients)
 * 4. Searches Square Bookings API with the correct customer_id
 * 5. Links the booking to the order + cascades to payments/line items
 *
 * Usage:
 *   DRY_RUN=true node scripts/reconcile-customer-merges.js   # preview only
 *   node scripts/reconcile-customer-merges.js                  # apply fixes
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { getOrdersApi, getBookingsApi } = require('../lib/utils/square-client')

const prisma = new PrismaClient()
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
const DRY_RUN = process.env.DRY_RUN === 'true'
const BATCH_SIZE = 50
const API_DELAY_MS = 200 // rate limiting delay between API calls

// Square location IDs to UUID mapping
const LOCATIONS = {
  'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380',
  'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'
}

const stats = {
  totalProcessed: 0,
  customerIdUpdated: 0,
  bookingLinked: 0,
  bookingNotFound: 0,
  squareOrderNotFound: 0,
  customerIdSame: 0,
  apiErrors: 0,
  paymentsUpdated: 0,
  lineItemsUpdated: 0
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Get unlinked service orders (have line items with service_variation_id, no booking)
 * orders.customer_id stores the Square customer ID as a string
 */
async function getUnlinkedServiceOrders(offset, limit) {
  const orders = await prisma.$queryRaw`
    SELECT DISTINCT ON (o.id)
      o.id,
      o.order_id as square_order_id,
      o.customer_id,
      o.location_id,
      o.created_at
    FROM orders o
    JOIN order_line_items oli ON oli.order_id = o.id
    WHERE o.organization_id = ${ORG_ID}::uuid
      AND o.booking_id IS NULL
      AND o.state = 'COMPLETED'
      AND o.customer_id IS NOT NULL
      AND (oli.item_type IS NULL OR oli.item_type NOT IN ('GIFT_CARD', 'CUSTOM_AMOUNT'))
    ORDER BY o.id, o.created_at DESC
    OFFSET ${offset}
    LIMIT ${limit}
  `
  return orders
}

/**
 * Count total unlinked service orders
 */
async function countUnlinkedServiceOrders() {
  const result = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT o.id) as count
    FROM orders o
    JOIN order_line_items oli ON oli.order_id = o.id
    WHERE o.organization_id = ${ORG_ID}::uuid
      AND o.booking_id IS NULL
      AND o.state = 'COMPLETED'
      AND o.customer_id IS NOT NULL
      AND (oli.item_type IS NULL OR oli.item_type NOT IN ('GIFT_CARD', 'CUSTOM_AMOUNT'))
  `
  return Number(result[0].count)
}

/**
 * Get current order from Square API (has post-merge customer_id)
 */
async function withTimeout(promise, ms = 15000) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('API timeout')), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

async function getSquareOrder(squareOrderId) {
  try {
    const ordersApi = getOrdersApi()
    const response = await withTimeout(ordersApi.retrieveOrder(squareOrderId))
    return response.result?.order || null
  } catch (err) {
    if (err.statusCode === 404) return null
    throw err
  }
}

/**
 * Find matching booking from Square Bookings API
 */
async function findBookingFromSquare(customerId, locationSquareId, orderCreatedAt, serviceVariationIds) {
  const bookingsApi = getBookingsApi()

  // Search window: previous day through end of order day
  const startOfWindow = new Date(orderCreatedAt)
  startOfWindow.setDate(startOfWindow.getDate() - 1)
  startOfWindow.setHours(0, 0, 0, 0)

  const endOfWindow = new Date(orderCreatedAt)
  endOfWindow.setHours(23, 59, 59, 999)

  let allBookings = []
  let cursor = null
  let pageCount = 0

  do {
    try {
      const response = await withTimeout(bookingsApi.listBookings(
        100,
        cursor || undefined,
        customerId,
        undefined,
        locationSquareId,
        startOfWindow.toISOString(),
        endOfWindow.toISOString()
      ))
      const bookings = response.result?.bookings || []
      allBookings = allBookings.concat(bookings)
      cursor = response.result?.cursor
      pageCount++
    } catch (err) {
      console.error(`  ❌ Bookings API error: ${err.message}`)
      return null
    }
  } while (cursor && pageCount < 5)

  if (allBookings.length === 0) return null

  // Match by service_variation_id overlap
  const matched = []
  for (const booking of allBookings) {
    const segments = booking.appointmentSegments || []
    const bookingServiceIds = segments.map(s => s.serviceVariationId).filter(Boolean)
    const hasOverlap = serviceVariationIds.some(id => bookingServiceIds.includes(id))

    if (hasOverlap) {
      const bookingStart = booking.startAt ? new Date(booking.startAt) : null
      const timeDiff = bookingStart ? Math.abs(orderCreatedAt - bookingStart) : Infinity
      matched.push({ booking, timeDiff, segments })
    }
  }

  if (matched.length === 0) return null

  // Return closest match
  matched.sort((a, b) => a.timeDiff - b.timeDiff)
  return matched[0]
}

/**
 * Get the Square location ID from our DB location UUID
 */
function getSquareLocationId(locationUuid) {
  for (const [sqId, uuid] of Object.entries(LOCATIONS)) {
    if (uuid === locationUuid) return sqId
  }
  return null
}

/**
 * Update the square_existing_clients record if customer was merged
 */
async function updateClientCustomerId(oldSquareCustomerId, newSquareCustomerId) {
  // Check if a client with the new square_customer_id already exists
  const existing = await prisma.$queryRaw`
    SELECT id FROM square_existing_clients
    WHERE square_customer_id = ${newSquareCustomerId}
      AND organization_id = ${ORG_ID}::uuid
    LIMIT 1
  `

  if (existing && existing.length > 0) {
    // New customer ID already has a record — no update needed
    return
  }

  // Update existing client record with new Square customer ID
  if (!DRY_RUN) {
    await prisma.$executeRaw`
      UPDATE square_existing_clients
      SET square_customer_id = ${newSquareCustomerId},
          updated_at = NOW()
      WHERE square_customer_id = ${oldSquareCustomerId}
        AND organization_id = ${ORG_ID}::uuid
    `
  }
}

/**
 * Link booking to order and cascade to payments/line items
 */
async function linkBookingToOrder(orderUuid, squareBookingId) {
  // Find booking in our DB first (FK safety)
  const dbBooking = await prisma.$queryRaw`
    SELECT id, technician_id FROM bookings
    WHERE booking_id = ${squareBookingId}
      AND organization_id = ${ORG_ID}::uuid
    LIMIT 1
  `

  if (!dbBooking || dbBooking.length === 0) {
    return { linked: false, reason: 'booking_not_in_db' }
  }

  const bookingUuid = dbBooking[0].id
  const technicianId = dbBooking[0].technician_id

  if (DRY_RUN) {
    return { linked: true, bookingUuid, technicianId, dryRun: true }
  }

  // Update order
  await prisma.$executeRaw`
    UPDATE orders
    SET booking_id = ${bookingUuid}::uuid,
        technician_id = COALESCE(technician_id, ${technicianId}::uuid),
        updated_at = NOW()
    WHERE id = ${orderUuid}::uuid
  `

  // Cascade to payments
  const payResult = await prisma.$executeRaw`
    UPDATE payments
    SET booking_id = COALESCE(booking_id, ${bookingUuid}::uuid),
        technician_id = COALESCE(technician_id, ${technicianId}::uuid),
        updated_at = NOW()
    WHERE order_id = ${orderUuid}::uuid
      AND booking_id IS NULL
  `
  stats.paymentsUpdated += payResult

  // Cascade to order_line_items
  const oliResult = await prisma.$executeRaw`
    UPDATE order_line_items
    SET booking_id = COALESCE(booking_id, ${bookingUuid}::uuid),
        technician_id = COALESCE(technician_id, ${technicianId}::uuid),
        updated_at = NOW()
    WHERE order_id = ${orderUuid}::uuid
      AND booking_id IS NULL
  `
  stats.lineItemsUpdated += oliResult

  return { linked: true, bookingUuid, technicianId }
}

/**
 * Process a single order
 */
async function processOrder(order) {
  const { id: orderUuid, square_order_id, customer_id: dbSquareCustomerId, location_id, created_at } = order

  console.log(`\n📦 Order ${square_order_id} (${new Date(created_at).toISOString().slice(0, 10)})`)

  // Step 1: Get current order from Square API
  const squareOrder = await getSquareOrder(square_order_id)
  await sleep(API_DELAY_MS)

  if (!squareOrder) {
    console.log(`  ⚠️ Not found in Square API`)
    stats.squareOrderNotFound++
    return
  }

  const currentSquareCustomerId = squareOrder.customerId
  if (!currentSquareCustomerId) {
    console.log(`  ⚠️ No customer_id in Square order`)
    stats.squareOrderNotFound++
    return
  }

  // Step 2: Check if customer_id differs (merge happened)
  const customerMerged = currentSquareCustomerId !== dbSquareCustomerId
  if (customerMerged) {
    console.log(`  🔄 Customer merged: ${dbSquareCustomerId} → ${currentSquareCustomerId}`)
    stats.customerIdUpdated++

    // Update order's customer_id to the new Square customer ID
    if (!DRY_RUN) {
      await prisma.$executeRaw`
        UPDATE orders
        SET customer_id = ${currentSquareCustomerId},
            updated_at = NOW()
        WHERE id = ${orderUuid}::uuid
      `
    }

    // Update the square_existing_clients record
    await updateClientCustomerId(dbSquareCustomerId, currentSquareCustomerId)
  } else {
    console.log(`  ✅ Customer ID matches: ${dbSquareCustomerId}`)
    stats.customerIdSame++
  }

  // Step 3: Get service variation IDs from order line items (or from Square order)
  const lineItems = await prisma.$queryRaw`
    SELECT DISTINCT service_variation_id
    FROM order_line_items
    WHERE order_id = ${orderUuid}::uuid
      AND service_variation_id IS NOT NULL
  `
  let serviceVariationIds = lineItems.map(li => li.service_variation_id).filter(Boolean)

  // If no service_variation_ids in DB, get them from the Square order we already fetched
  if (serviceVariationIds.length === 0 && squareOrder.lineItems) {
    serviceVariationIds = squareOrder.lineItems
      .map(li => li.catalogObjectId)
      .filter(id => id && !id.startsWith('CUSTOM_AMOUNT'))
    if (serviceVariationIds.length > 0) {
      console.log(`  📋 Using catalog IDs from Square: ${serviceVariationIds.join(', ')}`)
    }
  }

  if (serviceVariationIds.length === 0) {
    console.log(`  ⚠️ No service variation IDs — skipping booking search`)
    stats.bookingNotFound++
    return
  }

  // Step 4: Search for booking
  // Square's listBookings indexes by ORIGINAL customer ID, not the merged one
  // So we search with the DB's customer_id first, then try the new ID if merged
  const squareLocationId = getSquareLocationId(location_id)
  if (!squareLocationId) {
    console.log(`  ⚠️ Unknown location: ${location_id}`)
    stats.bookingNotFound++
    return
  }

  let match = await findBookingFromSquare(
    dbSquareCustomerId,
    squareLocationId,
    new Date(created_at),
    serviceVariationIds
  )
  await sleep(API_DELAY_MS)

  // If not found and customer was merged, try with the new customer ID
  if (!match && customerMerged) {
    console.log(`  🔍 Retrying with new customer ID: ${currentSquareCustomerId}`)
    match = await findBookingFromSquare(
      currentSquareCustomerId,
      squareLocationId,
      new Date(created_at),
      serviceVariationIds
    )
    await sleep(API_DELAY_MS)
  }

  if (!match) {
    console.log(`  ❌ No matching booking found in Square`)
    stats.bookingNotFound++
    return
  }

  const { booking } = match
  console.log(`  🎯 Found booking: ${booking.id} (${booking.startAt?.slice(0, 10)})`)

  // Step 5: Link the booking
  const result = await linkBookingToOrder(orderUuid, booking.id)

  if (result.linked) {
    console.log(`  ✅ Linked! booking_uuid=${result.bookingUuid}, technician=${result.technicianId}${DRY_RUN ? ' (DRY RUN)' : ''}`)
    stats.bookingLinked++
  } else {
    console.log(`  ⚠️ Booking ${booking.id} not in our DB (${result.reason}) — need to sync booking first`)
    stats.bookingNotFound++
  }
}

/**
 * Main
 */
async function main() {
  console.log('='.repeat(80))
  console.log(`🔄 RECONCILE CUSTOMER MERGES FROM SQUARE`)
  console.log(`   Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '⚡ LIVE (will update DB)'}`)
  console.log('='.repeat(80))

  const total = await countUnlinkedServiceOrders()
  console.log(`\n📊 Found ${total} unlinked service orders to process`)

  if (total === 0) {
    console.log('Nothing to do!')
    return
  }

  let offset = 0

  while (offset < total) {
    const batch = await getUnlinkedServiceOrders(offset, BATCH_SIZE)
    if (batch.length === 0) break

    console.log(`\n${'─'.repeat(80)}`)
    console.log(`📦 Batch ${Math.floor(offset / BATCH_SIZE) + 1}: orders ${offset + 1}–${offset + batch.length} of ${total}`)
    console.log('─'.repeat(80))

    for (const order of batch) {
      try {
        await processOrder(order)
        stats.totalProcessed++
      } catch (err) {
        console.error(`  ❌ Error processing ${order.square_order_id}: ${err.message || err}`)
        stats.apiErrors++
      }
    }

    offset += BATCH_SIZE

    // Progress summary every batch
    console.log(`\n📈 Progress: ${stats.totalProcessed}/${total} processed`)
    console.log(`   Customer IDs updated: ${stats.customerIdUpdated}`)
    console.log(`   Bookings linked: ${stats.bookingLinked}`)
    console.log(`   Not found: ${stats.bookingNotFound}`)
  }

  // Final summary
  console.log('\n' + '='.repeat(80))
  console.log('📋 FINAL SUMMARY')
  console.log('='.repeat(80))
  console.log(`Total processed:       ${stats.totalProcessed}`)
  console.log(`Customer IDs updated:  ${stats.customerIdUpdated} (merges detected)`)
  console.log(`Customer IDs same:     ${stats.customerIdSame} (no merge)`)
  console.log(`Bookings linked:       ${stats.bookingLinked}`)
  console.log(`Bookings not found:    ${stats.bookingNotFound}`)
  console.log(`Square order missing:  ${stats.squareOrderNotFound}`)
  console.log(`Payments updated:      ${stats.paymentsUpdated}`)
  console.log(`Line items updated:    ${stats.lineItemsUpdated}`)
  console.log(`API errors:            ${stats.apiErrors}`)
  if (DRY_RUN) {
    console.log(`\n⚠️  DRY RUN — no changes were made. Run without DRY_RUN=true to apply.`)
  }
}

main()
  .catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
