#!/usr/bin/env node
/**
 * Match an order to a booking using:
 * - Customer ID
 * - Location ID
 * - Service Variation ID (from catalogObjectId)
 * - Time window (booking start time within 7 days before or 1 day after order creation)
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function matchOrderToBooking(orderId) {
  console.log('🔍 Matching Order to Booking\n')
  console.log('='.repeat(80))
  console.log(`Order ID (internal UUID): ${orderId}\n`)

  try {
    // Get order details
    const orderRecord = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id as square_order_id,
        o.customer_id,
        o.location_id,
        o.created_at,
        o.organization_id,
        o.booking_id as current_booking_id,
        l.square_location_id,
        l.id as location_uuid
      FROM orders o
      LEFT JOIN locations l ON l.id::text = o.location_id::text
      WHERE o.id = ${orderId}::uuid
      LIMIT 1
    `
    
    if (!orderRecord || orderRecord.length === 0) {
      console.log('❌ Order not found in database')
      return
    }
    
    const order = orderRecord[0]
    
    console.log('✅ Order Details:')
    console.log(`   Square Order ID: ${order.square_order_id}`)
    console.log(`   Customer ID: ${order.customer_id}`)
    console.log(`   Location ID: ${order.location_id}`)
    console.log(`   Square Location ID: ${order.square_location_id || 'N/A'}`)
    console.log(`   Order Created: ${order.created_at}`)
    console.log(`   Current Booking ID: ${order.current_booking_id || 'NULL'}\n`)
    
    if (!order.customer_id) {
      console.log('❌ Order has no customer_id - cannot match to booking')
      return
    }
    
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
    `
    
    if (!lineItems || lineItems.length === 0) {
      console.log('❌ No line items with service_variation_id found')
      console.log('   Trying to match without service_variation_id...\n')
      
      // Try matching without service_variation_id
      await matchByCustomerLocationTime(order, null)
      return
    }
    
    console.log(`📦 Found ${lineItems.length} line item(s) with service_variation_id:\n`)
    
    const orderCreatedAt = new Date(order.created_at)
    const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000) // 7 days before
    const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000) // 1 day after
    
    console.log(`⏰ Time Window:`)
    console.log(`   Order Created: ${orderCreatedAt.toISOString()}`)
    console.log(`   Search Window: ${startWindow.toISOString()} to ${endWindow.toISOString()}`)
    console.log(`   (7 days before, 1 day after order creation)\n`)
    
    // Match each line item
    for (const lineItem of lineItems) {
      console.log('='.repeat(80))
      console.log(`\n📋 Line Item: ${lineItem.name || 'N/A'}`)
      console.log(`   Service Variation ID: ${lineItem.service_variation_id}`)
      console.log(`   Variation: ${lineItem.variation_name || 'N/A'}\n`)
      
      await matchByCustomerLocationTime(order, lineItem.service_variation_id, lineItem)
    }
    
    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Summary:\n')
    
    const updatedOrder = await prisma.$queryRaw`
      SELECT booking_id
      FROM orders
      WHERE id = ${order.id}::uuid
    `
    
    if (updatedOrder && updatedOrder.length > 0 && updatedOrder[0].booking_id) {
      console.log(`✅ Order now has booking_id: ${updatedOrder[0].booking_id}`)
    } else {
      console.log(`⚠️  Order still has no booking_id`)
      console.log(`   Could not find a matching booking with the criteria`)
    }

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

async function matchByCustomerLocationTime(order, serviceVariationId, lineItem = null) {
  const orderCreatedAt = new Date(order.created_at)
  const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
  const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
  
  const locationUuid = order.location_uuid || order.location_id
  
  // Build query based on whether we have service_variation_id
  let matchingBookings = null
  
  if (order.location_id && order.location_id.length < 36) {
    // Square location ID - match via locations table
    if (serviceVariationId) {
      matchingBookings = await prisma.$queryRaw`
        SELECT 
          b.id,
          b.booking_id as square_booking_id,
          b.customer_id,
          b.location_id,
          b.start_at,
          b.technician_id,
          b.service_variation_id,
          sv.square_variation_id as booking_service_variation_square_id,
          EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)) as time_diff_seconds
        FROM bookings b
        INNER JOIN locations l ON l.id::text = b.location_id::text
        INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
        WHERE b.customer_id = ${order.customer_id}
          AND l.square_location_id = ${order.location_id}
          AND sv.square_variation_id = ${serviceVariationId}
          AND b.start_at >= ${startWindow}::timestamp
          AND b.start_at <= ${endWindow}::timestamp
        ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
        LIMIT 5
      `
    } else {
      // Match without service_variation_id
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
          AND b.start_at >= ${startWindow}::timestamp
          AND b.start_at <= ${endWindow}::timestamp
        ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
        LIMIT 5
      `
    }
  } else {
    // UUID - match directly
    if (serviceVariationId) {
      matchingBookings = await prisma.$queryRaw`
        SELECT 
          b.id,
          b.booking_id as square_booking_id,
          b.customer_id,
          b.location_id,
          b.start_at,
          b.technician_id,
          b.service_variation_id,
          sv.square_variation_id as booking_service_variation_square_id,
          EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)) as time_diff_seconds
        FROM bookings b
        INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
        WHERE b.customer_id = ${order.customer_id}
          AND b.location_id::text = ${locationUuid}::text
          AND sv.square_variation_id = ${serviceVariationId}
          AND b.start_at >= ${startWindow}::timestamp
          AND b.start_at <= ${endWindow}::timestamp
        ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
        LIMIT 5
      `
    } else {
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
          AND b.start_at >= ${startWindow}::timestamp
          AND b.start_at <= ${endWindow}::timestamp
        ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
        LIMIT 5
      `
    }
  }
  
  if (!matchingBookings || matchingBookings.length === 0) {
    console.log('   ❌ No matching bookings found')
    
    // Show what we're looking for
    console.log(`\n   🔍 Search Criteria:`)
    console.log(`      - Customer ID: ${order.customer_id}`)
    console.log(`      - Location: ${order.location_id}`)
    if (serviceVariationId) {
      console.log(`      - Service Variation ID: ${serviceVariationId}`)
    }
    console.log(`      - Time Window: ${startWindow.toISOString()} to ${endWindow.toISOString()}`)
    
    // Check if customer has any bookings at all
    const anyBookings = await prisma.$queryRaw`
      SELECT 
        b.booking_id as square_booking_id,
        b.start_at,
        b.service_variation_id,
        l.square_location_id
      FROM bookings b
      LEFT JOIN locations l ON l.id = b.location_id
      WHERE b.customer_id = ${order.customer_id}
      ORDER BY b.start_at DESC
      LIMIT 5
    `
    
    if (anyBookings && anyBookings.length > 0) {
      console.log(`\n   ℹ️  Customer has ${anyBookings.length} booking(s) total:`)
      anyBookings.forEach((b, idx) => {
        const timeDiff = Math.abs(new Date(b.start_at) - orderCreatedAt)
        const hoursDiff = timeDiff / (1000 * 60 * 60)
        const locationMatch = b.square_location_id === order.location_id || 
                             b.square_location_id === order.square_location_id
        const serviceMatch = serviceVariationId ? b.service_variation_id === serviceVariationId : 'N/A'
        
        console.log(`      ${idx + 1}. Booking ${b.square_booking_id}`)
        console.log(`         Start: ${b.start_at}`)
        console.log(`         Location: ${b.square_location_id || 'N/A'} ${locationMatch ? '✅' : '❌'}`)
        console.log(`         Service: ${b.service_variation_id || 'N/A'} ${serviceMatch === 'N/A' ? '' : (serviceMatch ? '✅' : '❌')}`)
        console.log(`         Time diff: ${hoursDiff.toFixed(1)} hours`)
      })
    } else {
      console.log(`\n   ℹ️  Customer has no bookings at all`)
    }
    
    return
  }
  
  console.log(`   ✅ Found ${matchingBookings.length} matching booking(s):\n`)
  
  const bestMatch = matchingBookings[0]
  const timeDiffSeconds = parseFloat(bestMatch.time_diff_seconds)
  const timeDiffHours = Math.abs(timeDiffSeconds / 3600)
  
  for (let i = 0; i < matchingBookings.length; i++) {
    const booking = matchingBookings[i]
    const tdSeconds = parseFloat(booking.time_diff_seconds)
    const tdHours = Math.abs(tdSeconds / 3600)
    
    console.log(`   ${i + 1}. Booking ${booking.square_booking_id}`)
    console.log(`      UUID: ${booking.id}`)
    console.log(`      Start: ${booking.start_at}`)
    console.log(`      Time difference: ${tdHours.toFixed(2)} hours`)
    console.log(`      Technician ID: ${booking.technician_id || 'N/A'}`)
    console.log(`      Service Variation ID: ${booking.service_variation_id || 'N/A'}`)
    
    if (i === 0) {
      if (tdHours <= 24) {
        console.log(`      ✅ BEST MATCH (within 24 hours)`)
      } else {
        console.log(`      ⚠️  WEAK MATCH (more than 24 hours apart)`)
      }
    }
    console.log()
  }
  
  // Update order with booking_id if we have a good match
  if (timeDiffHours <= 24) {
    console.log(`   💾 Updating order with booking_id: ${bestMatch.id}`)
    
    await prisma.$executeRaw`
      UPDATE orders
      SET booking_id = ${bestMatch.id}::uuid,
          updated_at = NOW()
      WHERE id = ${order.id}::uuid
        AND booking_id IS NULL
    `
    
    console.log(`   ✅ Order updated!`)
    
    // Also update line items if we have a specific line item
    if (lineItem) {
      await prisma.$executeRaw`
        UPDATE order_line_items
        SET booking_id = ${bestMatch.id}::uuid,
            updated_at = NOW()
        WHERE order_id = ${order.id}::uuid
          AND id = ${lineItem.id}::uuid
          AND booking_id IS NULL
      `
      console.log(`   ✅ Line item updated!`)
    } else {
      // Update all line items for this order
      await prisma.$executeRaw`
        UPDATE order_line_items
        SET booking_id = ${bestMatch.id}::uuid,
            updated_at = NOW()
        WHERE order_id = ${order.id}::uuid
          AND booking_id IS NULL
      `
      console.log(`   ✅ All line items updated!`)
    }
  } else {
    console.log(`   ⚠️  Time difference too large (${timeDiffHours.toFixed(2)} hours)`)
    console.log(`   Skipping automatic update - manual review recommended`)
  }
}

// Get order ID from command line argument
const orderId = process.argv[2] || 'a3b1f1a7-201f-449f-ab7a-e931ddaa37a1'

matchOrderToBooking(orderId)
  .then(() => {
    console.log('\n✅ Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })

