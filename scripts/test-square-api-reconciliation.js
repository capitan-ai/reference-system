#!/usr/bin/env node
/**
 * Test the new Square API-based booking reconciliation
 * Tests: 1) Square API (primary) → 2) Database fallback
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

// Initialize Square client
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENVIRONMENT === 'production' 
    ? Environment.Production 
    : Environment.Sandbox
})

const ordersApi = squareClient.ordersApi
const bookingsApi = squareClient.bookingsApi

async function testReconciliation() {
  console.log('🧪 Testing Square API-based Booking Reconciliation\n')
  console.log('='.repeat(70))
  
  // Test order ID - use one from recent orders without booking
  const testOrderId = 'f7lEZnGgdf6xpOFxKM0NJ7EbgbTZY'
  
  console.log(`\nTest Order: ${testOrderId}`)
  
  // Step 1: Get order from database
  console.log('\n📋 Step 1: Get order from database...')
  const orderRecord = await prisma.$queryRaw`
    SELECT id, organization_id, customer_id, location_id, created_at, booking_id
    FROM orders 
    WHERE order_id = ${testOrderId}
    LIMIT 1
  `
  
  if (!orderRecord || orderRecord.length === 0) {
    console.log('❌ Order not found in database')
    return
  }
  
  const order = orderRecord[0]
  console.log(`   UUID: ${order.id}`)
  console.log(`   Customer: ${order.customer_id}`)
  console.log(`   Location: ${order.location_id}`)
  console.log(`   Created: ${order.created_at}`)
  console.log(`   Current booking_id: ${order.booking_id || 'NULL'}`)
  
  // Step 2: Call Square Orders API
  console.log('\n📡 Step 2: Call Square Orders API...')
  try {
    const orderResponse = await ordersApi.retrieveOrder(testOrderId)
    const squareOrder = orderResponse.result?.order
    
    if (!squareOrder) {
      console.log('❌ Order not found in Square')
      return
    }
    
    console.log(`   ✅ Got order from Square`)
    console.log(`   State: ${squareOrder.state}`)
    console.log(`   Customer: ${squareOrder.customerId}`)
    console.log(`   Location: ${squareOrder.locationId}`)
    console.log(`   Line items: ${squareOrder.lineItems?.length || 0}`)
    
    // Extract service variation IDs
    const serviceVariationIds = []
    if (squareOrder.lineItems) {
      for (const item of squareOrder.lineItems) {
        if (item.catalogObjectId) {
          serviceVariationIds.push(item.catalogObjectId)
          console.log(`   - Item: ${item.name} (${item.catalogObjectId})`)
        }
      }
    }
    
    // Step 3: Call Square Bookings API
    console.log('\n📡 Step 3: Call Square Bookings API (listBookings)...')
    
    const orderCreatedAt = new Date(squareOrder.createdAt)
    const startAtMin = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const startAtMax = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString()
    
    console.log(`   Filters:`)
    console.log(`   - Customer: ${squareOrder.customerId}`)
    console.log(`   - Location: ${squareOrder.locationId}`)
    console.log(`   - Time: ${startAtMin} to ${startAtMax}`)
    
    const bookingsResponse = await bookingsApi.listBookings({
      locationId: squareOrder.locationId,
      startAtMin,
      startAtMax
    })
    
    const bookings = bookingsResponse.result?.bookings || []
    console.log(`   ✅ Found ${bookings.length} bookings in time window`)
    
    // Filter by customer
    const customerBookings = bookings.filter(b => b.customerId === squareOrder.customerId)
    console.log(`   Filtered to customer: ${customerBookings.length} bookings`)
    
    // Step 4: Match by service variation
    console.log('\n🔍 Step 4: Match by service_variation_id...')
    
    let matchedBooking = null
    for (const booking of customerBookings) {
      console.log(`   Checking booking: ${booking.id}`)
      console.log(`      Start: ${booking.startAt}`)
      console.log(`      Status: ${booking.status}`)
      
      // Get service variation from booking
      const appointmentSegments = booking.appointmentSegments || []
      for (const segment of appointmentSegments) {
        console.log(`      Service: ${segment.serviceVariationId}`)
        if (serviceVariationIds.includes(segment.serviceVariationId)) {
          console.log(`      ✅ MATCH! Service variation matches order line item`)
          matchedBooking = booking
          break
        }
      }
      if (matchedBooking) break
    }
    
    // Step 5: Result
    console.log('\n' + '='.repeat(70))
    if (matchedBooking) {
      console.log(`✅ SUCCESS: Found matching booking!`)
      console.log(`   Booking ID: ${matchedBooking.id}`)
      console.log(`   Start: ${matchedBooking.startAt}`)
      console.log(`   Status: ${matchedBooking.status}`)
      console.log(`   Source: square_api`)
      console.log(`   Confidence: high`)
      
      // Check if booking exists in our database
      const dbBooking = await prisma.$queryRaw`
        SELECT id FROM bookings WHERE booking_id = ${matchedBooking.id} LIMIT 1
      `
      if (dbBooking && dbBooking.length > 0) {
        console.log(`\n   📦 Booking exists in DB: ${dbBooking[0].id}`)
      } else {
        console.log(`\n   ⚠️ Booking NOT in DB - would need to create it`)
      }
    } else if (customerBookings.length > 0) {
      console.log(`⚠️ PARTIAL: Found customer bookings but no service match`)
      console.log(`   Would use closest by time as fallback`)
      const closest = customerBookings[0]
      console.log(`   Closest booking: ${closest.id}`)
      console.log(`   Source: square_api_time_fallback`)
      console.log(`   Confidence: medium`)
    } else {
      console.log(`❌ Square API found no matching booking`)
      console.log(`   Will try database fallback...`)
      
      // Database fallback
      console.log('\n📋 Step 5b: Database fallback (customer + location + time)...')
      const startWindow = new Date(order.created_at.getTime() - 7 * 24 * 60 * 60 * 1000)
      const endWindow = new Date(order.created_at.getTime() + 1 * 24 * 60 * 60 * 1000)
      
      const fallbackBookings = await prisma.$queryRaw`
        SELECT b.id, b.booking_id, b.start_at
        FROM bookings b
        INNER JOIN locations l ON l.id::text = b.location_id::text
        WHERE b.customer_id = ${order.customer_id}
          AND l.square_location_id = ${order.location_id}
          AND b.start_at >= ${startWindow}::timestamp
          AND b.start_at <= ${endWindow}::timestamp
        ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${order.created_at}::timestamp)))
        LIMIT 1
      `
      
      if (fallbackBookings && fallbackBookings.length > 0) {
        console.log(`   ✅ Database fallback found booking: ${fallbackBookings[0].id}`)
        console.log(`   Source: database_fallback`)
        console.log(`   Confidence: medium`)
      } else {
        console.log(`   ❌ Database fallback also found no booking`)
        console.log(`   Source: no_match`)
        console.log(`   Confidence: none`)
      }
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`)
    if (error.errors) {
      error.errors.forEach(e => console.error(`   - ${e.category}: ${e.detail}`))
    }
  }
  
  await prisma.$disconnect()
}

testReconciliation()
  .then(() => {
    console.log('\n✅ Test complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })

