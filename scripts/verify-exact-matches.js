#!/usr/bin/env node
/**
 * Strict verification of matches - check for exact matches and potential conflicts
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function verifyExactMatches() {
  console.log('🔍 STRICT VERIFICATION: Checking for Exact Matches\n')
  console.log('='.repeat(80))
  
  const validMatches = [
    { orderId: 'nL7IfRx7CLqFsq7FbwPQUoVfdJBZY', bookingId: 'hqtqsebho5fda4' },
    { orderId: 'pAJwS174IMseVJgOYWGHmtpicu5YY', bookingId: 'g4e7fgcyhqza0c-GSZZR45VJXB44NF4P4WXI5NB' },
    { orderId: 'vDJSvRvKm8MLX4CBrl7dRrnYSGWZY', bookingId: '0k34864h71xf94' },
    { orderId: 'NoUkgd38e7FthU4ATQwL69kk41fZY', bookingId: '0k34864h71xf94' },
    { orderId: 'B4zUrJZbO8FmPsz1MGhz8l032BDZY', bookingId: '8gj2dzk0hjqvpg' },
    { orderId: 'ftQPsyn4rHggIx6vHqOSNQrDHSIZY', bookingId: 'oka49zs0nxg728' },
    { orderId: 'zdbXg7oNatT6SqmWw8o93yHC4UNZY', bookingId: 'kj8zvgcbxfqw9t-BM556FTNFOTEHYVG4GPXAXFM' },
    { orderId: 'VyJNExQacCifqIZGWPIbzAUsj1TZY', bookingId: 'gyxmgi9b8r804k-5KMEQ27BJSRQ4HEIXM3BEVCU' },
    { orderId: 'vVyoWNMdi32vpB09HkrbF4QhCVaZY', bookingId: 'b9ph0omv3jrvaj' },
    { orderId: 'dsE3306FsQIMchoWgGn7I1HVhNZZY', bookingId: 'jr99j35bh918s7-LI7DPMZ73P77O27QKKOX5JAK' }
  ]
  
  let exactMatches = []
  let ambiguousMatches = []
  
  for (let i = 0; i < validMatches.length; i++) {
    const { orderId, bookingId } = validMatches[i]
    
    console.log(`\n${i + 1}. Checking Order: ${orderId}`)
    console.log(`${'─'.repeat(80)}`)
    
    // Get order details
    const order = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id as order_uuid,
        o.customer_id,
        o.location_id,
        o.organization_id,
        o.created_at
      FROM orders o
      WHERE o.order_id = ${orderId}
      LIMIT 1
    `
    
    if (!order || order.length === 0) {
      console.log(`   ❌ Order not found`)
      continue
    }
    
    const o = order[0]
    
    // Get location details
    let locationUuid = null
    let squareLocationId = null
    
    if (o.location_id && o.location_id.length < 36) {
      squareLocationId = o.location_id
      const loc = await prisma.$queryRaw`
        SELECT id, square_location_id FROM locations 
        WHERE square_location_id = ${o.location_id}
          AND organization_id = ${o.organization_id}::uuid
        LIMIT 1
      `
      if (loc && loc.length > 0) {
        locationUuid = loc[0].id
        squareLocationId = loc[0].square_location_id
      }
    } else {
      locationUuid = o.location_id
      const loc = await prisma.$queryRaw`
        SELECT id, square_location_id FROM locations 
        WHERE id = ${o.location_id}::uuid
        LIMIT 1
      `
      if (loc && loc.length > 0) {
        locationUuid = loc[0].id
        squareLocationId = loc[0].square_location_id
      }
    }
    
    // Get booking details
    const booking = await prisma.$queryRaw`
      SELECT 
        b.id,
        b.booking_id as square_booking_id,
        b.customer_id,
        b.location_id,
        b.start_at,
        b.status,
        b.service_variation_id
      FROM bookings b
      WHERE b.booking_id = ${bookingId}
      LIMIT 1
    `
    
    if (!booking || booking.length === 0) {
      console.log(`   ❌ Booking not found`)
      continue
    }
    
    const b = booking[0]
    
    // Get booking location
    const bookingLocation = await prisma.$queryRaw`
      SELECT square_location_id FROM locations 
      WHERE id = ${b.location_id}::uuid
      LIMIT 1
    `
    const bookingSquareLocationId = bookingLocation && bookingLocation.length > 0 
      ? bookingLocation[0].square_location_id 
      : null
    
    // Get order line items with service variations
    const lineItems = await prisma.$queryRaw`
      SELECT DISTINCT 
        oli.service_variation_id,
        sv.square_variation_id
      FROM order_line_items oli
      LEFT JOIN service_variation sv ON sv.uuid::text = oli.service_variation_id::text
      WHERE oli.order_id = ${o.order_uuid}::uuid
        AND oli.service_variation_id IS NOT NULL
      LIMIT 5
    `
    
    // Get booking service variation
    let bookingServiceVariationId = null
    if (b.service_variation_id) {
      const sv = await prisma.$queryRaw`
        SELECT square_variation_id FROM service_variation
        WHERE uuid = ${b.service_variation_id}::uuid
        LIMIT 1
      `
      if (sv && sv.length > 0) {
        bookingServiceVariationId = sv[0].square_variation_id
      }
    }
    
    // Check for other potential bookings (ambiguity check)
    const startWindow = new Date(o.created_at.getTime() - 7 * 24 * 60 * 60 * 1000)
    const endWindow = new Date(o.created_at.getTime() + 1 * 24 * 60 * 60 * 1000)
    
    const otherBookings = await prisma.$queryRaw`
      SELECT 
        b2.id,
        b2.booking_id as square_booking_id,
        b2.start_at,
        b2.status,
        ABS(EXTRACT(EPOCH FROM (b2.start_at - ${o.created_at}::timestamp))) / 3600 as hours_diff
      FROM bookings b2
      WHERE b2.customer_id = ${o.customer_id}
        AND b2.location_id = ${locationUuid}::uuid
        AND b2.start_at >= ${startWindow}::timestamp
        AND b2.start_at <= ${endWindow}::timestamp
        AND b2.id::text != ${b.id}::text
      ORDER BY ABS(EXTRACT(EPOCH FROM (b2.start_at - ${o.created_at}::timestamp)))
      LIMIT 5
    `
    
    // Verification checks
    const customerMatch = o.customer_id === b.customer_id
    const locationMatch = squareLocationId === bookingSquareLocationId
    const timeDiffHours = Math.abs((new Date(b.start_at) - new Date(o.created_at)) / (1000 * 60 * 60))
    const timeReasonable = timeDiffHours <= 168 // 7 days
    
    // Service variation match check
    let serviceVariationMatch = false
    if (lineItems && lineItems.length > 0 && bookingServiceVariationId) {
      serviceVariationMatch = lineItems.some(li => 
        li.square_variation_id === bookingServiceVariationId
      )
    }
    
    const isAmbiguous = otherBookings && otherBookings.length > 0
    
    console.log(`   Order Customer ID:     ${o.customer_id}`)
    console.log(`   Booking Customer ID:   ${b.customer_id}`)
    console.log(`   Customer Match:        ${customerMatch ? '✅ EXACT' : '❌ MISMATCH'}`)
    
    console.log(`\n   Order Location:        ${squareLocationId || 'NULL'}`)
    console.log(`   Booking Location:      ${bookingSquareLocationId || 'NULL'}`)
    console.log(`   Location Match:        ${locationMatch ? '✅ EXACT' : '❌ MISMATCH'}`)
    
    console.log(`\n   Order Created:        ${o.created_at}`)
    console.log(`   Booking Start:        ${b.start_at}`)
    console.log(`   Time Difference:       ${timeDiffHours.toFixed(2)} hours`)
    console.log(`   Time Window:           ${timeReasonable ? '✅ WITHIN 7 DAYS' : '❌ OUTSIDE WINDOW'}`)
    
    console.log(`\n   Order Service Vars:    ${lineItems.length > 0 ? lineItems.map(li => li.square_variation_id || 'NULL').join(', ') : 'NONE'}`)
    console.log(`   Booking Service Var:   ${bookingServiceVariationId || 'NULL'}`)
    if (bookingServiceVariationId) {
      console.log(`   Service Match:         ${serviceVariationMatch ? '✅ MATCHES' : '❌ NO MATCH'}`)
    } else {
      console.log(`   Service Match:         ⚠️  CANNOT VERIFY (booking has no service_variation_id)`)
    }
    
    if (isAmbiguous) {
      console.log(`\n   ⚠️  AMBIGUITY DETECTED: ${otherBookings.length} other booking(s) also match:`)
      otherBookings.forEach((other, idx) => {
        console.log(`      ${idx + 1}. Booking: ${other.square_booking_id}, Start: ${other.start_at}, Status: ${other.status}, Time Diff: ${Number(other.hours_diff).toFixed(2)}h`)
      })
    } else {
      console.log(`\n   ✅ NO AMBIGUITY: This is the only booking matching the criteria`)
    }
    
    // Overall assessment
    const isExactMatch = customerMatch && locationMatch && timeReasonable && !isAmbiguous
    
    if (isExactMatch) {
      console.log(`\n   ✅ EXACT MATCH - Safe to reconcile`)
      exactMatches.push({ orderId, bookingId, order: o, booking: b })
    } else {
      console.log(`\n   ⚠️  NOT EXACT MATCH - Review needed`)
      ambiguousMatches.push({ orderId, bookingId, order: o, booking: b, reason: isAmbiguous ? 'Multiple bookings match' : 'Mismatch in criteria' })
    }
  }
  
  console.log(`\n${'='.repeat(80)}`)
  console.log(`\n📊 VERIFICATION SUMMARY:`)
  console.log(`   Exact Matches: ${exactMatches.length}`)
  console.log(`   Ambiguous/Questionable: ${ambiguousMatches.length}`)
  
  if (exactMatches.length > 0) {
    console.log(`\n✅ EXACT MATCHES (Safe to reconcile):`)
    exactMatches.forEach((match, idx) => {
      console.log(`   ${idx + 1}. Order: ${match.orderId} → Booking: ${match.bookingId}`)
    })
  }
  
  if (ambiguousMatches.length > 0) {
    console.log(`\n⚠️  AMBIGUOUS MATCHES (Review needed):`)
    ambiguousMatches.forEach((match, idx) => {
      console.log(`   ${idx + 1}. Order: ${match.orderId} → Booking: ${match.bookingId} (${match.reason})`)
    })
  }
  
  console.log(`\n💡 Recommendation: Only reconcile the ${exactMatches.length} exact matches`)
  
  await prisma.$disconnect()
}

verifyExactMatches()
  .then(() => {
    console.log('\n✅ Verification Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })

