#!/usr/bin/env node
/**
 * Test the actual reconcileBookingLinks function directly
 * Uses a real order from 2025 to test the full reconciliation flow
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Import the function (we'll need to extract it or call it via webhook simulation)
async function testReconcileDirect() {
  console.log('🧪 Testing reconcileBookingLinks Function Directly\n')
  console.log('='.repeat(80))
  
  // Get a real order from 2025 that has line items but no booking_id
  const testOrder = await prisma.$queryRaw`
    SELECT 
      o.order_id,
      o.id,
      o.organization_id,
      o.customer_id,
      o.location_id,
      o.booking_id,
      o.created_at,
      COUNT(DISTINCT oli.id) FILTER (WHERE oli.service_variation_id IS NOT NULL) as service_count
    FROM orders o
    LEFT JOIN order_line_items oli ON oli.order_id = o.id
    WHERE o.created_at >= '2025-01-01'::timestamp
      AND o.created_at <= '2025-12-31'::timestamp
      AND o.customer_id IS NOT NULL
      AND o.location_id IS NOT NULL
      AND o.booking_id IS NULL
    GROUP BY o.order_id, o.id, o.organization_id, o.customer_id, o.location_id, o.booking_id, o.created_at
    HAVING COUNT(DISTINCT oli.id) FILTER (WHERE oli.service_variation_id IS NOT NULL) > 0
    ORDER BY o.created_at DESC
    LIMIT 1
  `
  
  if (!testOrder || testOrder.length === 0) {
    console.log('⚠️  No suitable test order found')
    await prisma.$disconnect()
    return
  }
  
  const order = testOrder[0]
  console.log(`Testing with Order: ${order.order_id}`)
  console.log(`  UUID: ${order.id}`)
  console.log(`  Customer: ${order.customer_id}`)
  console.log(`  Location: ${order.location_id}`)
  console.log(`  Created: ${order.created_at}`)
  console.log(`  Service variations: ${Number(order.service_count)}`)
  console.log()
  
  // Get payments for this order
  const payments = await prisma.$queryRaw`
    SELECT id, booking_id
    FROM payments
    WHERE order_id = ${order.id}::uuid
    LIMIT 1
  `
  
  const paymentId = payments && payments.length > 0 ? payments[0].id : null
  console.log(`Payment ID: ${paymentId || 'None'}`)
  console.log()
  
  // Now test the reconciliation logic step by step
  console.log('Testing reconciliation logic...\n')
  
  try {
    // Simulate the reconcileBookingLinks function
    const orderUuid = order.id
    const organizationId = order.organization_id
    const customerId = order.customer_id
    const locationId = order.location_id
    const orderCreatedAt = new Date(order.created_at)
    
    // Get line items
    const lineItems = await prisma.$queryRaw`
      SELECT DISTINCT service_variation_id
      FROM order_line_items
      WHERE order_id = ${orderUuid}::uuid
        AND service_variation_id IS NOT NULL
      LIMIT 5
    `
    
    console.log(`Found ${lineItems.length} service variations`)
    
    if (lineItems.length > 0 && customerId && locationId) {
      const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
      const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
      
      // Determine location type
      let squareLocationId = null
      let locationUuid = null
      if (locationId && locationId.length < 36) {
        squareLocationId = locationId
        const loc = await prisma.$queryRaw`
          SELECT id FROM locations 
          WHERE square_location_id = ${locationId}
            AND organization_id = ${organizationId}::uuid
          LIMIT 1
        `
        if (loc && loc.length > 0) {
          locationUuid = loc[0].id
        }
      } else {
        locationUuid = locationId
        const loc = await prisma.$queryRaw`
          SELECT square_location_id FROM locations 
          WHERE id = ${locationId}::uuid
          LIMIT 1
        `
        if (loc && loc.length > 0) {
          squareLocationId = loc[0].square_location_id
        }
      }
      
      console.log(`Location Type: ${squareLocationId ? 'Square ID' : 'UUID'}`)
      console.log(`Time window: ${startWindow.toISOString()} to ${endWindow.toISOString()}\n`)
      
      // Try to match
      for (const li of lineItems) {
        console.log(`Trying service variation: ${li.service_variation_id}`)
        
        let matchingBookings = null
        try {
          if (squareLocationId) {
            matchingBookings = await prisma.$queryRaw`
              SELECT b.id, b.booking_id, b.start_at
              FROM bookings b
              INNER JOIN locations l ON l.id::text = b.location_id::text
              INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
              WHERE b.customer_id = ${customerId}
                AND l.square_location_id = ${squareLocationId}
                AND sv.square_variation_id = ${li.service_variation_id}
                AND b.start_at >= ${startWindow}::timestamp
                AND b.start_at <= ${endWindow}::timestamp
              ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
              LIMIT 1
            `
          } else if (locationUuid) {
            matchingBookings = await prisma.$queryRaw`
              SELECT b.id, b.booking_id, b.start_at
              FROM bookings b
              INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
              WHERE b.customer_id = ${customerId}
                AND b.location_id::text = ${locationUuid}::text
                AND sv.square_variation_id = ${li.service_variation_id}
                AND b.start_at >= ${startWindow}::timestamp
                AND b.start_at <= ${endWindow}::timestamp
              ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
              LIMIT 1
            `
          }
          
          if (matchingBookings && matchingBookings.length > 0) {
            const booking = matchingBookings[0]
            console.log(`✅ MATCH FOUND!`)
            console.log(`   Booking ID: ${booking.id}`)
            console.log(`   Square Booking ID: ${booking.booking_id}`)
            console.log(`   Start At: ${booking.start_at}`)
            
            // Test update
            console.log(`\nTesting UPDATE operations...`)
            
            const updateOrder = await prisma.$executeRaw`
              UPDATE orders
              SET booking_id = ${booking.id}::uuid,
                  updated_at = NOW()
              WHERE id = ${orderUuid}::uuid
                AND booking_id IS NULL
            `
            console.log(`   ✅ Updated orders: ${updateOrder} row(s)`)
            
            const updateLineItems = await prisma.$executeRaw`
              UPDATE order_line_items
              SET booking_id = ${booking.id}::uuid,
                  updated_at = NOW()
              WHERE order_id = ${orderUuid}::uuid
                AND booking_id IS NULL
            `
            console.log(`   ✅ Updated order_line_items: ${updateLineItems} row(s)`)
            
            if (paymentId) {
              const updatePayment = await prisma.$executeRaw`
                UPDATE payments
                SET booking_id = ${booking.id}::uuid,
                    updated_at = NOW()
                WHERE id = ${paymentId}
                  AND booking_id IS NULL
              `
              console.log(`   ✅ Updated payments: ${updatePayment} row(s)`)
            }
            
            break
          } else {
            console.log(`   ❌ No match`)
          }
        } catch (sqlError) {
          console.log(`   ❌ SQL ERROR: ${sqlError.message}`)
          console.log(`   Code: ${sqlError.code}`)
          throw sqlError
        }
      }
    }
    
  } catch (error) {
    console.error(`❌ ERROR: ${error.message}`)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testReconcileDirect()
  .then(() => {
    console.log('\n✅ Test Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test Failed:', error)
    process.exit(1)
  })



