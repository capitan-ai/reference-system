#!/usr/bin/env node
/**
 * Test if we can automatically find booking_id from orders
 * Tests multiple methods:
 * 1. From order.reference_id
 * 2. From payment.booking_id (if payment exists)
 * 3. From customer + location + recent booking match
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function testBookingIdFromOrders() {
  console.log('🧪 Testing Booking ID Lookup from Orders\n')
  console.log('='.repeat(60))

  try {
    // Test 1: Check orders with reference_id
    console.log('\n📝 TEST 1: Orders with reference_id\n')
    
    const ordersWithReference = await prisma.$queryRaw`
      SELECT o.order_id, o.reference_id, o.customer_id, o.location_id,
             l.square_location_id
      FROM orders o
      LEFT JOIN locations l ON l.id::text = o.location_id::text
      WHERE o.reference_id IS NOT NULL
      ORDER BY o.created_at DESC
      LIMIT 10
    `
    
    console.log(`Found ${ordersWithReference.length} orders with reference_id:\n`)
    
    for (const order of ordersWithReference) {
      console.log(`Order: ${order.order_id}`)
      console.log(`  Reference ID: ${order.reference_id}`)
      console.log(`  Customer ID: ${order.customer_id || 'N/A'}`)
      console.log(`  Location: ${order.square_location_id || 'N/A'}`)
      
      // Check if reference_id looks like a booking ID
      const refId = order.reference_id
      const looksLikeBookingId = refId && (
        refId.match(/^AS[A-Z0-9]+$/) || // Square booking ID format
        refId.length >= 20 // Long IDs might be booking IDs
      )
      
      if (looksLikeBookingId) {
        console.log(`  ✅ Reference ID looks like booking ID`)
        
        // Try to find booking
        const booking = await prisma.$queryRaw`
          SELECT id, booking_id, customer_id, start_at
          FROM bookings
          WHERE booking_id = ${refId}
          LIMIT 1
        `
        
        if (booking && booking.length > 0) {
          console.log(`  ✅ FOUND booking: ${booking[0].booking_id} (UUID: ${booking[0].id})`)
        } else {
          console.log(`  ❌ No booking found with booking_id = ${refId}`)
        }
      } else {
        console.log(`  ⚠️  Reference ID doesn't look like booking ID`)
      }
      console.log('')
    }

    // Test 2: Check orders with payments that have booking_id
    console.log('='.repeat(60))
    console.log('\n💳 TEST 2: Orders with Payments that have booking_id\n')
    
    const ordersWithPaymentBooking = await prisma.$queryRaw`
      SELECT DISTINCT o.order_id, o.created_at,
             p.booking_id as payment_booking_id, p.payment_id
      FROM orders o
      INNER JOIN payments p ON p.order_id = o.id
      WHERE p.booking_id IS NOT NULL
      ORDER BY o.created_at DESC
      LIMIT 10
    `
    
    console.log(`Found ${ordersWithPaymentBooking.length} orders with payments that have booking_id:\n`)
    
    for (const order of ordersWithPaymentBooking) {
      console.log(`Order: ${order.order_id}`)
      console.log(`  Payment booking_id: ${order.payment_booking_id || 'NULL'}`)
      console.log(`  Payment ID: ${order.payment_id}`)
      console.log(`  ✅ Payment has booking_id - could copy to order and line items`)
      console.log('')
    }

    // Test 3: Check orders without booking_id but with customer_id
    console.log('='.repeat(60))
    console.log('\n👤 TEST 3: Orders without booking_id but with customer_id\n')
    
    const ordersWithoutBooking = await prisma.$queryRaw`
      SELECT o.order_id, o.customer_id, o.location_id, o.created_at,
             l.square_location_id
      FROM orders o
      LEFT JOIN locations l ON l.id::text = o.location_id::text
      WHERE o.customer_id IS NOT NULL
        AND o.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY o.created_at DESC
      LIMIT 10
    `
    
    console.log(`Found ${ordersWithoutBooking.length} recent orders without booking_id:\n`)
    
    let matchedCount = 0
    
    for (const order of ordersWithoutBooking) {
      console.log(`Order: ${order.order_id}`)
      console.log(`  Customer ID: ${order.customer_id}`)
      console.log(`  Location: ${order.square_location_id || 'N/A'}`)
      console.log(`  Created: ${order.created_at}`)
      
      if (order.location_id) {
        // Try to find recent booking for this customer at this location
        const orderDate = new Date(order.created_at)
        const startWindow = new Date(orderDate.getTime() - 7 * 24 * 60 * 60 * 1000)
        const endWindow = new Date(orderDate.getTime() + 1 * 24 * 60 * 60 * 1000)
        
        // Try to match location_id (could be UUID or Square location ID)
        let recentBooking = null
        try {
          // First try as UUID
          recentBooking = await prisma.$queryRaw`
            SELECT b.id, b.booking_id, b.start_at, b.customer_id
            FROM bookings b
            WHERE b.customer_id = ${order.customer_id}
              AND b.location_id::text = ${order.location_id}::text
              AND b.start_at >= ${startWindow}::timestamp
              AND b.start_at <= ${endWindow}::timestamp
            ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${order.created_at}::timestamp)))
            LIMIT 1
          `
        } catch (err) {
          // If that fails, location_id might not be a valid UUID
          console.log(`  ⚠️  Could not match location: ${err.message}`)
        }
        
        if (recentBooking && recentBooking.length > 0) {
          const booking = recentBooking[0]
          const timeDiff = Math.abs(new Date(booking.start_at) - new Date(order.created_at))
          const hoursDiff = timeDiff / (1000 * 60 * 60)
          
          console.log(`  ✅ FOUND potential booking:`)
          console.log(`     Booking ID: ${booking.booking_id}`)
          console.log(`     Booking UUID: ${booking.id}`)
          console.log(`     Booking start: ${booking.start_at}`)
          console.log(`     Time difference: ${hoursDiff.toFixed(1)} hours`)
          
          if (hoursDiff <= 24) {
            console.log(`     ✅ Within 24 hours - GOOD MATCH`)
            matchedCount++
          } else {
            console.log(`     ⚠️  More than 24 hours apart - might not be related`)
          }
        } else {
          console.log(`  ❌ No recent booking found for this customer/location`)
        }
      } else {
        console.log(`  ⚠️  No location_id - cannot match`)
      }
      console.log('')
    }
    
    console.log(`\n📊 Summary: ${matchedCount}/${ordersWithoutBooking.length} orders could be matched to bookings`)

    // Test 4: Check line items without booking_id
    console.log('='.repeat(60))
    console.log('\n📦 TEST 4: Order Line Items without booking_id\n')
    
    const totalLineItems = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items oli
      INNER JOIN orders o ON o.id = oli.order_id
      WHERE o.created_at >= NOW() - INTERVAL '7 days'
    `
    
    const total = parseInt(totalLineItems[0].count)
    
    console.log(`Recent line items (last 7 days):`)
    console.log(`  Total: ${total}`)
    console.log(`  Note: booking_id column doesn't exist yet - all would need it`)

    // Test 5: Sample orders that could benefit from booking_id
    console.log('='.repeat(60))
    console.log('\n🎯 TEST 5: Sample Orders That Need booking_id\n')
    
    const sampleOrders = await prisma.$queryRaw`
      SELECT o.order_id, o.customer_id, o.location_id, o.created_at,
             COUNT(oli.id) as line_item_count,
             COUNT(CASE WHEN oli.technician_id IS NULL THEN 1 END) as line_items_without_technician
      FROM orders o
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      WHERE o.customer_id IS NOT NULL
        AND o.created_at >= NOW() - INTERVAL '7 days'
      GROUP BY o.order_id, o.customer_id, o.location_id, o.created_at
      HAVING COUNT(CASE WHEN oli.technician_id IS NULL THEN 1 END) > 0
      ORDER BY o.created_at DESC
      LIMIT 5
    `
    
    console.log(`Found ${sampleOrders.length} orders without booking_id that have line items without technician_id:\n`)
    
    for (const order of sampleOrders) {
      console.log(`Order: ${order.order_id}`)
      console.log(`  Line items: ${order.line_item_count}`)
      console.log(`  Without technician_id: ${order.line_items_without_technician}`)
      
      // Check if payment has booking_id
      const payment = await prisma.$queryRaw`
        SELECT p.booking_id, p.payment_id
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        WHERE o.order_id = ${order.order_id}
          AND p.booking_id IS NOT NULL
        LIMIT 1
      `
      
      if (payment && payment.length > 0) {
        console.log(`  ✅ Payment has booking_id: ${payment[0].booking_id}`)
        console.log(`     → Could update order and line items with this booking_id`)
      } else {
        console.log(`  ❌ Payment doesn't have booking_id`)
      }
      console.log('')
    }

    console.log('='.repeat(60))
    console.log('\n✅ Test Complete\n')
    
    console.log('📋 Summary:')
    console.log('  1. Check if reference_id contains booking IDs')
    console.log('  2. Check if payments have booking_id that can be copied to orders')
    console.log('  3. Check if customer/location matching can find bookings')
    console.log('  4. Count how many line items need booking_id')
    console.log('  5. Sample orders that would benefit from booking_id')

  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testBookingIdFromOrders()
  .then(() => {
    console.log('✅ All tests complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })

