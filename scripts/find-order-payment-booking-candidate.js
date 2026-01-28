#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function findCandidate() {
  // Find orders with payments that have customer+location but no booking_id
  const candidates = await prisma.$queryRaw`
    SELECT 
      o.order_id,
      o.id as order_uuid,
      o.customer_id,
      o.location_id,
      o.booking_id,
      o.created_at,
      COUNT(DISTINCT p.id) as payment_count,
      COUNT(DISTINCT oli.id) FILTER (WHERE oli.service_variation_id IS NOT NULL) as service_count
    FROM orders o
    INNER JOIN payments p ON p.order_id = o.id
    LEFT JOIN order_line_items oli ON oli.order_id = o.id
    WHERE o.customer_id IS NOT NULL
      AND o.location_id IS NOT NULL
      AND o.booking_id IS NULL
      AND o.created_at >= '2025-12-01'::timestamp
    GROUP BY o.order_id, o.id, o.customer_id, o.location_id, o.booking_id, o.created_at
    HAVING COUNT(DISTINCT oli.id) FILTER (WHERE oli.service_variation_id IS NOT NULL) > 0
    ORDER BY o.created_at DESC
    LIMIT 5
  `
  
  console.log(`Found ${candidates.length} candidate orders with payments and service variations\n`)
  
  for (const candidate of candidates) {
    console.log(`${'='.repeat(80)}`)
    console.log(`Order: ${candidate.order_id}`)
    console.log(`  UUID: ${candidate.order_uuid}`)
    console.log(`  Customer: ${candidate.customer_id}`)
    console.log(`  Location: ${candidate.location_id}`)
    console.log(`  Created: ${candidate.created_at}`)
    console.log(`  Payments: ${Number(candidate.payment_count)}`)
    console.log(`  Service variations: ${Number(candidate.service_count)}`)
    console.log(`  Booking ID: ${candidate.booking_id || 'NULL'}`)
    
    // Try to find matching booking
    const orderCreatedAt = new Date(candidate.created_at)
    const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
    const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
    
    // Get location UUID
    let squareLocationId = candidate.location_id
    let locationUuid = null
    if (candidate.location_id && candidate.location_id.length < 36) {
      const loc = await prisma.$queryRaw`
        SELECT id FROM locations 
        WHERE square_location_id = ${candidate.location_id}
        LIMIT 1
      `
      if (loc && loc.length > 0) {
        locationUuid = loc[0].id
      }
    } else {
      locationUuid = candidate.location_id
    }
    
    // Get service variations
    const lineItems = await prisma.$queryRaw`
      SELECT DISTINCT service_variation_id
      FROM order_line_items
      WHERE order_id = ${candidate.order_uuid}::uuid
        AND service_variation_id IS NOT NULL
      LIMIT 3
    `
    
    let foundMatch = false
    for (const li of lineItems) {
      let matchingBookings = null
      
      if (squareLocationId && squareLocationId.length < 36) {
        matchingBookings = await prisma.$queryRaw`
          SELECT b.id, b.booking_id, b.start_at
          FROM bookings b
          INNER JOIN locations l ON l.id::text = b.location_id::text
          INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
          WHERE b.customer_id = ${candidate.customer_id}
            AND l.square_location_id = ${squareLocationId}
            AND sv.square_variation_id = ${li.service_variation_id}
            AND b.start_at >= ${startWindow}::timestamp
            AND b.start_at <= ${endWindow}::timestamp
          ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
          LIMIT 1
        `
      }
      
      if (matchingBookings && matchingBookings.length > 0) {
        const booking = matchingBookings[0]
        console.log(`\n  ✅ MATCHING BOOKING FOUND!`)
        console.log(`     Booking ID: ${booking.id}`)
        console.log(`     Square Booking ID: ${booking.booking_id}`)
        console.log(`     Start At: ${booking.start_at}`)
        console.log(`     Time diff: ${Math.abs(new Date(booking.start_at) - orderCreatedAt) / (1000 * 60)} minutes`)
        
        // Get payments
        const payments = await prisma.$queryRaw`
          SELECT id, booking_id
          FROM payments
          WHERE order_id = ${candidate.order_uuid}::uuid
          LIMIT 3
        `
        
        console.log(`\n  Payments (${payments.length}):`)
        payments.forEach((p, idx) => {
          console.log(`    ${idx + 1}. Payment: ${p.id}`)
          console.log(`       Booking ID: ${p.booking_id || 'NULL'}`)
        })
        
        console.log(`\n  💡 This order can be updated with booking_id: ${booking.id}`)
        console.log(`     And payments can be updated too!`)
        
        foundMatch = true
        break
      }
    }
    
    if (!foundMatch) {
      console.log(`  ❌ No matching booking found`)
    }
    
    console.log()
  }
  
  await prisma.$disconnect()
}

findCandidate().catch(console.error)



