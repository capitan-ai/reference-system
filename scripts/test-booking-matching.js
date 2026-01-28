#!/usr/bin/env node
/**
 * Test Customer + Location + Time matching for orders to bookings
 * Tests the matching logic on a real order from the database
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function testBookingMatching() {
  console.log('🧪 Testing Booking Matching for Orders\n')
  console.log('='.repeat(60))

  try {
    // Find an order without booking_id that has customer_id and location_id
    // AND the customer has at least one booking
    console.log('\n📝 Step 1: Finding an order to test (with customer that has bookings)...\n')
    
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
        AND o.created_at >= NOW() - INTERVAL '30 days'
        AND EXISTS (
          SELECT 1 FROM bookings b 
          WHERE b.customer_id = o.customer_id
        )
      ORDER BY o.created_at DESC
      LIMIT 1
    `
    
    if (!testOrder || testOrder.length === 0) {
      console.log('❌ No orders found without booking_id that have customer_id and location_id')
      console.log('   Try finding orders from the last 30 days')
      return
    }
    
    const order = testOrder[0]
    const locationUuid = order.location_uuid || order.location_id
    
    console.log(`✅ Found test order:`)
    console.log(`   Order ID (Square): ${order.square_order_id}`)
    console.log(`   Order UUID: ${order.id}`)
    console.log(`   Customer ID: ${order.customer_id}`)
    console.log(`   Location UUID: ${locationUuid}`)
    console.log(`   Square Location ID: ${order.square_location_id || 'N/A'}`)
    console.log(`   Created At: ${order.created_at}`)
    console.log(`   Organization ID: ${order.organization_id}`)

    // Step 2: Try to match to booking
    console.log('\n' + '='.repeat(60))
    console.log('\n🔍 Step 2: Attempting to match to booking...\n')
    
    const orderCreatedAt = new Date(order.created_at)
    // For testing, use a wider window (210 days before, 1 day after) to catch the July booking
    // In production, use 7 days before, 1 day after
    const startWindow = new Date(orderCreatedAt.getTime() - 210 * 24 * 60 * 60 * 1000) // 210 days before (for testing)
    const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000) // 1 day after
    
    console.log(`   Searching for bookings:`)
    console.log(`   - Customer ID: ${order.customer_id}`)
    console.log(`   - Location UUID: ${locationUuid}`)
    console.log(`   - Time window: ${startWindow.toISOString()} to ${endWindow.toISOString()}`)
    console.log(`   - Order created: ${orderCreatedAt.toISOString()}`)
    
    // Try to match by location UUID first, then by Square location ID if needed
    let matchingBookings = await prisma.$queryRaw`
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
        AND b.start_at >= ${startWindow}::timestamp
        AND b.start_at <= ${endWindow}::timestamp
      ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
      LIMIT 5
    `
    
    // If no matches and location_id looks like a Square location ID (not UUID), try matching by Square location ID
    if ((!matchingBookings || matchingBookings.length === 0) && order.square_location_id) {
      console.log(`   ⚠️  No matches by UUID, trying to match by Square location ID: ${order.square_location_id}`)
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
        INNER JOIN locations l ON l.id = b.location_id
        WHERE b.customer_id = ${order.customer_id}
          AND l.square_location_id = ${order.square_location_id}
          AND b.start_at >= ${startWindow}::timestamp
          AND b.start_at <= ${endWindow}::timestamp
        ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
        LIMIT 5
      `
    }
    
    // If still no matches and location_id looks like a Square location ID (not UUID), try matching by Square location ID
    if ((!matchingBookings || matchingBookings.length === 0) && order.location_id && order.location_id.length < 36) {
      console.log(`   ⚠️  No matches by UUID, trying to match by Square location ID: ${order.location_id}`)
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
        INNER JOIN locations l ON l.id = b.location_id
        WHERE b.customer_id = ${order.customer_id}
          AND l.square_location_id = ${order.location_id}
          AND b.start_at >= ${startWindow}::timestamp
          AND b.start_at <= ${endWindow}::timestamp
        ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
        LIMIT 5
      `
    }
    
    if (!matchingBookings || matchingBookings.length === 0) {
      console.log('\n   ❌ No matching bookings found')
      console.log('\n   📊 Checking if customer has any bookings at all...')
      
      const allCustomerBookings = await prisma.$queryRaw`
        SELECT 
          b.id,
          b.booking_id as square_booking_id,
          b.start_at,
          b.location_id,
          l.square_location_id
        FROM bookings b
        LEFT JOIN locations l ON l.id = b.location_id
        WHERE b.customer_id = ${order.customer_id}
        ORDER BY b.start_at DESC
        LIMIT 5
      `
      
      if (allCustomerBookings && allCustomerBookings.length > 0) {
        console.log(`   Found ${allCustomerBookings.length} booking(s) for this customer:`)
        allCustomerBookings.forEach((booking, idx) => {
          const timeDiff = Math.abs(new Date(booking.start_at) - orderCreatedAt)
          const hoursDiff = timeDiff / (1000 * 60 * 60)
          const bookingLocationUuid = booking.location_id
          const locationMatches = bookingLocationUuid === locationUuid || 
                                 booking.square_location_id === order.location_id ||
                                 booking.square_location_id === order.square_location_id
          console.log(`   ${idx + 1}. Booking ${booking.square_booking_id}`)
          console.log(`      Start: ${booking.start_at}`)
          console.log(`      Location UUID: ${bookingLocationUuid}`)
          console.log(`      Square Location ID: ${booking.square_location_id || 'N/A'}`)
          console.log(`      Time difference: ${hoursDiff.toFixed(1)} hours (${(hoursDiff/24).toFixed(1)} days)`)
          console.log(`      Location match: ${locationMatches ? '✅' : '❌'}`)
          
          // If location matches but time is outside window, show what would happen
          if (locationMatches && hoursDiff > 24) {
            console.log(`      ⚠️  Location matches but time is ${(hoursDiff/24).toFixed(1)} days apart`)
            console.log(`      ${hoursDiff <= 168 ? '✅ Would match with 7-day window' : '❌ Too far apart even with 7-day window'}`)
          }
        })
        
        // Try to find a booking that matches location (ignoring time for demo)
        const locationMatchedBooking = allCustomerBookings.find(b => 
          b.location_id === locationUuid || 
          b.square_location_id === order.location_id ||
          b.square_location_id === order.square_location_id
        )
        
        if (locationMatchedBooking) {
          const timeDiff = Math.abs(new Date(locationMatchedBooking.start_at) - orderCreatedAt)
          const hoursDiff = timeDiff / (1000 * 60 * 60)
          console.log(`\n   📋 Best location match: Booking ${locationMatchedBooking.square_booking_id}`)
          console.log(`      Time difference: ${hoursDiff.toFixed(1)} hours (${(hoursDiff/24).toFixed(1)} days)`)
          if (hoursDiff <= 168) { // 7 days
            console.log(`      ✅ Would be matched with 7-day window`)
          } else {
            console.log(`      ❌ Too far apart (${(hoursDiff/24).toFixed(1)} days > 7 days)`)
          }
        }
      } else {
        console.log('   No bookings found for this customer at all')
      }
      
      return
    }
    
    console.log(`\n   ✅ Found ${matchingBookings.length} potential matching booking(s):\n`)
    
    for (let i = 0; i < matchingBookings.length; i++) {
      const booking = matchingBookings[i]
      const timeDiffSeconds = parseFloat(booking.time_diff_seconds)
      const timeDiffHours = Math.abs(timeDiffSeconds / 3600)
      const timeDiffDays = Math.abs(timeDiffSeconds / 86400)
      
      console.log(`   ${i + 1}. Booking Match:`)
      console.log(`      Booking UUID: ${booking.id}`)
      console.log(`      Square Booking ID: ${booking.square_booking_id}`)
      console.log(`      Booking Start: ${booking.start_at}`)
      console.log(`      Time Difference: ${timeDiffHours.toFixed(2)} hours (${timeDiffDays.toFixed(2)} days)`)
      console.log(`      Technician ID: ${booking.technician_id || 'N/A'}`)
      console.log(`      Service Variation ID: ${booking.service_variation_id || 'N/A'}`)
      
      if (i === 0) {
        // This is the best match (closest time)
        if (timeDiffHours <= 24) {
          console.log(`      ✅ GOOD MATCH (within 24 hours)`)
        } else {
          console.log(`      ⚠️  WEAK MATCH (more than 24 hours apart)`)
        }
      }
    }
    
    // Step 3: Test the actual update
    const bestMatch = matchingBookings[0]
    if (bestMatch) {
      const timeDiffHours = Math.abs(parseFloat(bestMatch.time_diff_seconds) / 3600)
      
      console.log('\n' + '='.repeat(60))
      console.log('\n💾 Step 3: Testing database update...\n')
      
      if (timeDiffHours <= 24) {
        console.log(`   Would update order ${order.square_order_id} with booking ${bestMatch.square_booking_id}`)
        console.log(`   Time difference: ${timeDiffHours.toFixed(2)} hours`)
        
        // Ask for confirmation
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        })
        
        const answer = await new Promise(resolve => {
          readline.question('\n   Do you want to apply this match? (yes/no): ', resolve)
        })
        readline.close()
        
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
          await prisma.$executeRaw`
            UPDATE orders
            SET booking_id = ${bestMatch.id}::uuid
            WHERE id = ${order.id}::uuid
          `
          console.log(`\n   ✅ Successfully updated order with booking_id!`)
          
          // Also update order_line_items if they exist
          const lineItemsCount = await prisma.$executeRaw`
            UPDATE order_line_items
            SET booking_id = ${bestMatch.id}::uuid
            WHERE order_id = ${order.id}::uuid
              AND booking_id IS NULL
          `
          console.log(`   ✅ Updated ${lineItemsCount} order_line_item(s) with booking_id`)
        } else {
          console.log('\n   ⏭️  Skipped update (dry run)')
        }
      } else {
        console.log(`   ⚠️  Time difference too large (${timeDiffHours.toFixed(2)} hours)`)
        console.log(`   Skipping automatic update - manual review recommended`)
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n✅ Test Complete\n')

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

testBookingMatching()
  .then(() => {
    console.log('✅ All tests complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })

