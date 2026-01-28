#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function testOnSample() {
  // Find an order that has line items with service_variation_id
  // and check if there's a matching booking
  const orders = await prisma.$queryRaw`
    SELECT 
      o.order_id,
      o.id,
      o.customer_id,
      o.location_id,
      o.created_at,
      o.booking_id,
      COUNT(DISTINCT oli.service_variation_id) FILTER (WHERE oli.service_variation_id IS NOT NULL) as service_count
    FROM orders o
    LEFT JOIN order_line_items oli ON oli.order_id = o.id
    WHERE o.customer_id IS NOT NULL
      AND o.location_id IS NOT NULL
      AND o.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY o.order_id, o.id, o.customer_id, o.location_id, o.created_at, o.booking_id
    HAVING COUNT(DISTINCT oli.service_variation_id) FILTER (WHERE oli.service_variation_id IS NOT NULL) > 0
    ORDER BY o.created_at DESC
    LIMIT 10
  `
  
  console.log(`Found ${orders.length} orders with service variations\n`)
  
  for (const order of orders.slice(0, 3)) {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`Testing Order: ${order.order_id}`)
    console.log(`Customer: ${order.customer_id}`)
    console.log(`Created: ${order.created_at}`)
    console.log(`Current booking_id: ${order.booking_id || 'NULL'}`)
    
    // Get location type
    let squareLocationId = null
    let locationUuid = null
    if (order.location_id && order.location_id.length < 36) {
      squareLocationId = order.location_id
      const loc = await prisma.$queryRaw`
        SELECT id FROM locations 
        WHERE square_location_id = ${order.location_id}
        LIMIT 1
      `
      if (loc && loc.length > 0) {
        locationUuid = loc[0].id
      }
    } else {
      locationUuid = order.location_id
      const loc = await prisma.$queryRaw`
        SELECT square_location_id FROM locations 
        WHERE id = ${order.location_id}::uuid
        LIMIT 1
      `
      if (loc && loc.length > 0) {
        squareLocationId = loc[0].square_location_id
      }
    }
    
    // Get service variations
    const lineItems = await prisma.$queryRaw`
      SELECT DISTINCT service_variation_id
      FROM order_line_items
      WHERE order_id = ${order.id}::uuid
        AND service_variation_id IS NOT NULL
      LIMIT 3
    `
    
    console.log(`   Service variations: ${lineItems.length}`)
    
    // Try to match
    const orderCreatedAt = new Date(order.created_at)
    const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
    const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
    
    let foundMatch = false
    for (const li of lineItems) {
      let matchingBookings = null
      
      if (squareLocationId) {
        matchingBookings = await prisma.$queryRaw`
          SELECT b.id, b.booking_id, b.start_at
          FROM bookings b
          INNER JOIN locations l ON l.id::text = b.location_id::text
          INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
          WHERE b.customer_id = ${order.customer_id}
            AND l.square_location_id = ${squareLocationId}
            AND sv.square_variation_id = ${li.service_variation_id}
            AND b.start_at >= ${startWindow}::timestamp
            AND b.start_at <= ${endWindow}::timestamp
          LIMIT 1
        `
      } else if (locationUuid) {
        matchingBookings = await prisma.$queryRaw`
          SELECT b.id, b.booking_id, b.start_at
          FROM bookings b
          INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
          WHERE b.customer_id = ${order.customer_id}
            AND b.location_id::text = ${locationUuid}::text
            AND sv.square_variation_id = ${li.service_variation_id}
            AND b.start_at >= ${startWindow}::timestamp
            AND b.start_at <= ${endWindow}::timestamp
          LIMIT 1
        `
      }
      
      if (matchingBookings && matchingBookings.length > 0) {
        console.log(`   ✅ MATCH FOUND! Booking: ${matchingBookings[0].id}`)
        foundMatch = true
        break
      }
    }
    
    if (!foundMatch) {
      console.log(`   ❌ No match found`)
    }
  }
  
  await prisma.$disconnect()
}

testOnSample().catch(console.error)



