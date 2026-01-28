#!/usr/bin/env node
/**
 * Test the reconciliation method to find booking_id for orders and payments
 * Tests all 4 matching methods and shows which one works
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function testReconciliation(orderId, paymentId = null) {
  console.log('🧪 Testing Booking Reconciliation Method\n')
  console.log('='.repeat(80))
  console.log(`Order ID (Square): ${orderId}`)
  if (paymentId) {
    console.log(`Payment ID: ${paymentId}`)
  }
  console.log('='.repeat(80) + '\n')

  try {
    // Get order UUID and details
    const orderRecord = await prisma.$queryRaw`
      SELECT id, organization_id, customer_id, location_id, created_at, booking_id
      FROM orders 
      WHERE order_id = ${orderId}
      LIMIT 1
    `
    
    if (!orderRecord || orderRecord.length === 0) {
      console.log(`❌ Order ${orderId} not found in database`)
      return
    }
    
    const orderUuid = orderRecord[0].id
    const organizationId = orderRecord[0].organization_id
    const customerId = orderRecord[0].customer_id
    const locationId = orderRecord[0].location_id
    const orderCreatedAt = orderRecord[0].created_at
    const existingBookingId = orderRecord[0].booking_id
    
    console.log('📦 Order Details:')
    console.log(`   UUID: ${orderUuid}`)
    console.log(`   Customer ID: ${customerId || 'NULL'}`)
    console.log(`   Location ID: ${locationId || 'NULL'}`)
    console.log(`   Created At: ${orderCreatedAt}`)
    console.log(`   Current booking_id: ${existingBookingId || 'NULL'}\n`)
    
    // Check if location is UUID or square_location_id
    let squareLocationId = null
    let locationUuid = null
    if (locationId) {
      if (locationId.length < 36) {
        // It's a square_location_id
        squareLocationId = locationId
        console.log(`   Location Type: Square Location ID`)
        // Get UUID
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
        // It's a UUID
        locationUuid = locationId
        console.log(`   Location Type: UUID`)
        // Get square_location_id
        const loc = await prisma.$queryRaw`
          SELECT square_location_id FROM locations 
          WHERE id = ${locationId}::uuid
          LIMIT 1
        `
        if (loc && loc.length > 0) {
          squareLocationId = loc[0].square_location_id
        }
      }
    }
    
    console.log(`   Square Location ID: ${squareLocationId || 'NULL'}`)
    console.log(`   Location UUID: ${locationUuid || 'NULL'}\n`)

    // Get line items
    const lineItems = await prisma.$queryRaw`
      SELECT id, service_variation_id, booking_id
      FROM order_line_items
      WHERE order_id = ${orderUuid}::uuid
      LIMIT 10
    `
    
    console.log(`📋 Order Line Items: ${lineItems.length}`)
    lineItems.forEach((li, idx) => {
      console.log(`   ${idx + 1}. Service Variation: ${li.service_variation_id || 'NULL'}, booking_id: ${li.booking_id || 'NULL'}`)
    })
    console.log()

    // Get payment details
    let paymentBookingId = null
    if (paymentId) {
      const paymentRecord = await prisma.$queryRaw`
        SELECT id, booking_id, order_id, customer_id
        FROM payments
        WHERE id = ${paymentId}
        LIMIT 1
      `
      
      if (paymentRecord && paymentRecord.length > 0) {
        paymentBookingId = paymentRecord[0].booking_id
        console.log('💳 Payment Details:')
        console.log(`   Payment ID: ${paymentId}`)
        console.log(`   Current booking_id: ${paymentBookingId || 'NULL'}\n`)
      }
    }
    
    // Also check all payments for this order
    const allPayments = await prisma.$queryRaw`
      SELECT id, booking_id, customer_id
      FROM payments
      WHERE order_id = ${orderUuid}::uuid
    `
    
    console.log(`💳 Payments for this order: ${allPayments.length}`)
    allPayments.forEach((p, idx) => {
      console.log(`   ${idx + 1}. Payment ID: ${p.id}, booking_id: ${p.booking_id || 'NULL'}`)
    })
    console.log()

    // ==========================================
    // METHOD 1: Get booking_id from payments
    // ==========================================
    console.log('🔍 Method 1: Get booking_id from payments')
    console.log('-'.repeat(80))
    
    let method1BookingId = null
    if (paymentId) {
      const paymentBooking = await prisma.$queryRaw`
        SELECT booking_id FROM payments
        WHERE id = ${paymentId}
          AND booking_id IS NOT NULL
        LIMIT 1
      `
      if (paymentBooking && paymentBooking.length > 0) {
        method1BookingId = paymentBooking[0].booking_id
        console.log(`   ✅ Found booking_id from payment: ${method1BookingId}`)
      } else {
        console.log(`   ❌ Payment ${paymentId} does not have booking_id`)
      }
    } else {
      console.log(`   ⏭️  No payment ID provided`)
    }
    
    // Try to find any payment with booking_id for this order
    if (!method1BookingId) {
      const paymentWithBooking = await prisma.$queryRaw`
        SELECT booking_id FROM payments
        WHERE order_id = ${orderUuid}::uuid
          AND booking_id IS NOT NULL
        LIMIT 1
      `
      if (paymentWithBooking && paymentWithBooking.length > 0) {
        method1BookingId = paymentWithBooking[0].booking_id
        console.log(`   ✅ Found booking_id from another payment for this order: ${method1BookingId}`)
      } else {
        console.log(`   ❌ No payments for this order have booking_id`)
      }
    }
    console.log()

    // ==========================================
    // METHOD 2: Match by Customer + Location + Service Variation + Time
    // ==========================================
    console.log('🔍 Method 2: Match by Customer + Location + Service Variation + Time')
    console.log('-'.repeat(80))
    
    let method2BookingId = null
    if (customerId && (locationUuid || squareLocationId)) {
      // Get service_variation_id from order line items
      const serviceVariations = await prisma.$queryRaw`
        SELECT DISTINCT service_variation_id
        FROM order_line_items
        WHERE order_id = ${orderUuid}::uuid
          AND service_variation_id IS NOT NULL
        LIMIT 5
      `
      
      console.log(`   Found ${serviceVariations.length} unique service variations in line items`)
      
      if (serviceVariations && serviceVariations.length > 0) {
        // Time window: 7 days before order, 1 day after
        const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
        const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
        
        console.log(`   Time window: ${startWindow.toISOString()} to ${endWindow.toISOString()}`)
        
        for (const sv of serviceVariations) {
          console.log(`   Trying service variation: ${sv.service_variation_id}`)
          
          let matchingBookings = null
          
          if (squareLocationId) {
            // Match using square_location_id
            matchingBookings = await prisma.$queryRaw`
              SELECT b.id, b.booking_id, b.start_at, sv.name as service_name
              FROM bookings b
              INNER JOIN locations l ON l.id::text = b.location_id::text
              INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
              WHERE b.customer_id = ${customerId}
                AND l.square_location_id = ${squareLocationId}
                AND sv.square_variation_id = ${sv.service_variation_id}
                AND b.start_at >= ${startWindow}::timestamp
                AND b.start_at <= ${endWindow}::timestamp
              ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
              LIMIT 5
            `
          } else if (locationUuid) {
            // Match using location UUID
            matchingBookings = await prisma.$queryRaw`
              SELECT b.id, b.booking_id, b.start_at, sv.name as service_name
              FROM bookings b
              INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
              WHERE b.customer_id = ${customerId}
                AND b.location_id::text = ${locationUuid}::text
                AND sv.square_variation_id = ${sv.service_variation_id}
                AND b.start_at >= ${startWindow}::timestamp
                AND b.start_at <= ${endWindow}::timestamp
              ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
              LIMIT 5
            `
          }
          
          if (matchingBookings && matchingBookings.length > 0) {
            console.log(`   ✅ Found ${matchingBookings.length} matching booking(s):`)
            matchingBookings.forEach((b, idx) => {
              const timeDiff = Math.abs(new Date(b.start_at) - orderCreatedAt) / (1000 * 60 * 60)
              console.log(`      ${idx + 1}. Booking ID: ${b.id}, Service: ${b.service_name || 'N/A'}, Time diff: ${timeDiff.toFixed(1)} hours`)
            })
            method2BookingId = matchingBookings[0].id
            console.log(`   ✅ Selected closest booking: ${method2BookingId}`)
            break
          } else {
            console.log(`   ❌ No bookings found for this service variation`)
          }
        }
      } else {
        console.log(`   ⏭️  No service variations found in line items`)
      }
    } else {
      console.log(`   ⏭️  Missing customer_id or location_id`)
    }
    console.log()

    // ==========================================
    // METHOD 3: Fallback - Customer + Location + Time
    // ==========================================
    console.log('🔍 Method 3: Fallback - Customer + Location + Time (no service match)')
    console.log('-'.repeat(80))
    
    let method3BookingId = null
    if (customerId && (locationUuid || squareLocationId) && !method2BookingId) {
      const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
      const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
      
      console.log(`   Time window: ${startWindow.toISOString()} to ${endWindow.toISOString()}`)
      
      let fallbackBookings = null
      if (squareLocationId) {
        fallbackBookings = await prisma.$queryRaw`
          SELECT b.id, b.booking_id, b.start_at, COUNT(*) OVER() as total_count
          FROM bookings b
          INNER JOIN locations l ON l.id::text = b.location_id::text
          WHERE b.customer_id = ${customerId}
            AND l.square_location_id = ${squareLocationId}
            AND b.start_at >= ${startWindow}::timestamp
            AND b.start_at <= ${endWindow}::timestamp
          ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
          LIMIT 5
        `
      } else if (locationUuid) {
        fallbackBookings = await prisma.$queryRaw`
          SELECT b.id, b.booking_id, b.start_at, COUNT(*) OVER() as total_count
          FROM bookings b
          WHERE b.customer_id = ${customerId}
            AND b.location_id::text = ${locationUuid}::text
            AND b.start_at >= ${startWindow}::timestamp
            AND b.start_at <= ${endWindow}::timestamp
          ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
          LIMIT 5
        `
      }
      
      if (fallbackBookings && fallbackBookings.length > 0) {
        console.log(`   ✅ Found ${fallbackBookings.length} matching booking(s):`)
        fallbackBookings.forEach((b, idx) => {
          const timeDiff = Math.abs(new Date(b.start_at) - orderCreatedAt) / (1000 * 60 * 60)
          console.log(`      ${idx + 1}. Booking ID: ${b.id}, Time diff: ${timeDiff.toFixed(1)} hours`)
        })
        method3BookingId = fallbackBookings[0].id
        console.log(`   ✅ Selected closest booking: ${method3BookingId}`)
      } else {
        console.log(`   ❌ No bookings found`)
      }
    } else {
      if (method2BookingId) {
        console.log(`   ⏭️  Skipped (Method 2 already found a match)`)
      } else {
        console.log(`   ⏭️  Missing customer_id or location_id`)
      }
    }
    console.log()

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log('='.repeat(80))
    console.log('📊 RECONCILIATION RESULTS\n')
    
    const finalBookingId = method1BookingId || method2BookingId || method3BookingId
    
    console.log(`Method 1 (Payment booking_id): ${method1BookingId || '❌ Not found'}`)
    console.log(`Method 2 (Service + Time match): ${method2BookingId || '❌ Not found'}`)
    console.log(`Method 3 (Customer + Time fallback): ${method3BookingId || '❌ Not found'}`)
    console.log()
    console.log(`🎯 FINAL RESULT: ${finalBookingId || '❌ NO BOOKING FOUND'}`)
    
    if (finalBookingId) {
      // Get booking details
      const bookingDetails = await prisma.$queryRaw`
        SELECT b.id, b.booking_id, b.start_at, b.status, b.customer_id, b.location_id,
               sv.name as service_name, tm.name as technician_name
        FROM bookings b
        LEFT JOIN service_variation sv ON sv.uuid = b.service_variation_id
        LEFT JOIN team_members tm ON tm.id = b.technician_id
        WHERE b.id = ${finalBookingId}::uuid
        LIMIT 1
      `
      
      if (bookingDetails && bookingDetails.length > 0) {
        const b = bookingDetails[0]
        console.log()
        console.log('📅 Matched Booking Details:')
        console.log(`   Booking ID: ${b.booking_id}`)
        console.log(`   Start At: ${b.start_at}`)
        console.log(`   Status: ${b.status}`)
        console.log(`   Service: ${b.service_name || 'N/A'}`)
        console.log(`   Technician: ${b.technician_name || 'N/A'}`)
      }
    }
    
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 10).join('\n'))
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Get command line arguments
const orderId = process.argv[2]
const paymentId = process.argv[3] || null

if (!orderId) {
  console.error('Usage: node scripts/test-reconciliation-method.js <order_id> [payment_id]')
  console.error('Example: node scripts/test-reconciliation-method.js a3b1f1a7-201f-449f-ab7a-e931ddaa37a1 R2ZxYK3gEQc5ATpF3dqqzh1fvaB')
  process.exit(1)
}

testReconciliation(orderId, paymentId)
  .then(() => {
    console.log('\n✅ Test Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test Failed:', error)
    process.exit(1)
  })



