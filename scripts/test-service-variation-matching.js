#!/usr/bin/env node
/**
 * Test matching orders to bookings using:
 * Customer + Location + Service Variation + Time
 * 
 * This is more specific than customer + location + time alone
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function testServiceVariationMatching() {
  console.log('🧪 Testing Service Variation + Customer + Location + Time Matching\n')
  console.log('='.repeat(60))

  try {
    // Find an order with line items that have service_variation_id
    console.log('\n📝 Step 1: Finding an order with service_variation_id...\n')
    
    const testOrder = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id as square_order_id,
        o.customer_id,
        o.location_id,
        o.created_at,
        o.organization_id,
        l.square_location_id,
        l.id as location_uuid
      FROM orders o
      LEFT JOIN locations l ON l.id::text = o.location_id::text
      WHERE o.booking_id IS NULL
        AND o.customer_id IS NOT NULL
        AND o.location_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM order_line_items oli
          WHERE oli.order_id = o.id
            AND oli.service_variation_id IS NOT NULL
        )
        AND EXISTS (
          SELECT 1 FROM bookings b 
          WHERE b.customer_id = o.customer_id
        )
      ORDER BY o.created_at DESC
      LIMIT 1
    `
    
    if (!testOrder || testOrder.length === 0) {
      console.log('❌ No orders found with service_variation_id and customer with bookings')
      return
    }
    
    const order = testOrder[0]
    const locationUuid = order.location_uuid || order.location_id
    
    console.log(`✅ Found test order:`)
    console.log(`   Order ID (Square): ${order.square_order_id}`)
    console.log(`   Order UUID: ${order.id}`)
    console.log(`   Customer ID: ${order.customer_id}`)
    console.log(`   Location: ${locationUuid}`)
    console.log(`   Created At: ${order.created_at}`)
    
    // Get line items with service_variation_id
    const lineItems = await prisma.$queryRaw`
      SELECT 
        oli.id,
        oli.uid,
        oli.service_variation_id,
        oli.name,
        oli.variation_name
      FROM order_line_items oli
      WHERE oli.order_id = ${order.id}::uuid
        AND oli.service_variation_id IS NOT NULL
      LIMIT 5
    `
    
    console.log(`\n📦 Found ${lineItems.length} line item(s) with service_variation_id:`)
    lineItems.forEach((item, idx) => {
      console.log(`   ${idx + 1}. ${item.name || 'N/A'} - ${item.variation_name || 'N/A'}`)
      console.log(`      Service Variation ID: ${item.service_variation_id}`)
    })
    
    if (lineItems.length === 0) {
      console.log('❌ No line items with service_variation_id found')
      return
    }
    
    // Test matching for each line item
    const orderCreatedAt = new Date(order.created_at)
    const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000) // 7 days before
    const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000) // 1 day after
    
    console.log('\n' + '='.repeat(60))
    console.log('\n🔍 Step 2: Matching each line item to bookings...\n')
    
    for (const lineItem of lineItems) {
      console.log(`\n📋 Line Item: ${lineItem.name || 'N/A'}`)
      console.log(`   Service Variation ID: ${lineItem.service_variation_id}`)
      
      // Try to match by customer + location + service_variation + time
      // Check if location_id is a Square location ID (not UUID) - Square IDs are typically < 36 chars
      let matchingBookings = null
      
      if (order.location_id && order.location_id.length < 36) {
        // Square location ID - match via locations table
        matchingBookings = await prisma.$queryRaw`
          SELECT 
            b.id,
            b.booking_id as square_booking_id,
            b.customer_id,
            b.location_id,
            b.start_at,
            b.technician_id,
            b.service_variation_id,
            EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)) as time_diff_seconds
          FROM bookings b
          INNER JOIN locations l ON l.id::text = b.location_id::text
          WHERE b.customer_id = ${order.customer_id}
            AND l.square_location_id = ${order.location_id}
            AND b.service_variation_id = ${lineItem.service_variation_id}
            AND b.start_at >= ${startWindow}::timestamp
            AND b.start_at <= ${endWindow}::timestamp
          ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
          LIMIT 5
        `
      } else {
        // UUID - match directly
        matchingBookings = await prisma.$queryRaw`
          SELECT 
            b.id,
            b.booking_id as square_booking_id,
            b.customer_id,
            b.location_id,
            b.start_at,
            b.technician_id,
            b.service_variation_id,
            EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)) as time_diff_seconds
          FROM bookings b
          WHERE b.customer_id = ${order.customer_id}
            AND b.location_id::text = ${locationUuid}::text
            AND b.service_variation_id = ${lineItem.service_variation_id}
            AND b.start_at >= ${startWindow}::timestamp
            AND b.start_at <= ${endWindow}::timestamp
          ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
          LIMIT 5
        `
      }
      
      if (!matchingBookings || matchingBookings.length === 0) {
        console.log(`   ❌ No matching bookings found`)
        
        // Check if service_variation_id exists in any bookings for this customer
        const anyServiceBookings = await prisma.$queryRaw`
          SELECT 
            b.booking_id as square_booking_id,
            b.service_variation_id,
            b.start_at
          FROM bookings b
          WHERE b.customer_id = ${order.customer_id}
            AND b.service_variation_id = ${lineItem.service_variation_id}
          ORDER BY b.start_at DESC
          LIMIT 3
        `
        
        if (anyServiceBookings && anyServiceBookings.length > 0) {
          console.log(`   ℹ️  Found ${anyServiceBookings.length} booking(s) with this service_variation_id (outside time window):`)
          anyServiceBookings.forEach((b, idx) => {
            const timeDiff = Math.abs(new Date(b.start_at) - orderCreatedAt)
            const hoursDiff = timeDiff / (1000 * 60 * 60)
            console.log(`      ${idx + 1}. Booking ${b.square_booking_id} - ${hoursDiff.toFixed(1)} hours apart`)
          })
        } else {
          console.log(`   ℹ️  No bookings found with this service_variation_id for this customer`)
        }
      } else {
        console.log(`   ✅ Found ${matchingBookings.length} matching booking(s):`)
        
        for (let i = 0; i < matchingBookings.length; i++) {
          const booking = matchingBookings[i]
          const timeDiffSeconds = parseFloat(booking.time_diff_seconds)
          const timeDiffHours = Math.abs(timeDiffSeconds / 3600)
          
          console.log(`      ${i + 1}. Booking ${booking.square_booking_id}`)
          console.log(`         Time difference: ${timeDiffHours.toFixed(2)} hours`)
          console.log(`         Technician ID: ${booking.technician_id || 'N/A'}`)
          
          if (i === 0 && timeDiffHours <= 24) {
            console.log(`         ✅ GOOD MATCH (within 24 hours)`)
          }
        }
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n✅ Test Complete\n')
    console.log('📝 Summary:')
    console.log('   This approach matches by:')
    console.log('   - Customer ID')
    console.log('   - Location (UUID or Square location ID)')
    console.log('   - Service Variation ID (specific service)')
    console.log('   - Time window (7 days before, 1 day after)')
    console.log('\n   This is more specific than customer + location + time alone')
    console.log('   because it requires the service_variation_id to match as well.')

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

testServiceVariationMatching()
  .then(() => {
    console.log('✅ All tests complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })

