#!/usr/bin/env node
/**
 * Find and verify bookings that can be matched to orders with payments
 * Uses the same matching logic as reconcileBookingLinks
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function verifyMatches() {
  console.log('🔍 Finding Bookings to Match with Orders and Payments\n')
  console.log('='.repeat(80))
  
  try {
    // Find orders with payments but no booking_id
    const ordersWithPayments = await prisma.$queryRaw`
      SELECT DISTINCT
        o.order_id,
        o.id as order_uuid,
        o.customer_id,
        o.location_id,
        o.organization_id,
        o.created_at,
        COUNT(DISTINCT p.id) as payment_count
      FROM orders o
      INNER JOIN payments p ON p.order_id = o.id
      WHERE o.booking_id IS NULL
        AND o.customer_id IS NOT NULL
        AND o.location_id IS NOT NULL
      GROUP BY o.order_id, o.id, o.customer_id, o.location_id, o.organization_id, o.created_at
      ORDER BY o.created_at DESC
      LIMIT 200
    `
    
    if (!ordersWithPayments || ordersWithPayments.length === 0) {
      console.log('❌ No orders found with payments (no booking_id)')
      await prisma.$disconnect()
      return
    }
    
    console.log(`\n📋 Checking ${ordersWithPayments.length} orders with payments...\n`)
    
    const matches = []
    
    for (const order of ordersWithPayments) {
      // Get location UUID and square_location_id
      let locationUuid = null
      let squareLocationId = null
      
      if (order.location_id && order.location_id.length < 36) {
        // It's a square_location_id
        squareLocationId = order.location_id
        const loc = await prisma.$queryRaw`
          SELECT id FROM locations 
          WHERE square_location_id = ${order.location_id}
            AND organization_id = ${order.organization_id}::uuid
          LIMIT 1
        `
        if (loc && loc.length > 0) {
          locationUuid = loc[0].id
        }
      } else {
        // It's a UUID
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
      
      if (!locationUuid || !squareLocationId) {
        continue // Skip if we can't resolve location
      }
      
      // Get service_variation_id from order line items
      const lineItems = await prisma.$queryRaw`
        SELECT DISTINCT service_variation_id
        FROM order_line_items
        WHERE order_id = ${order.order_uuid}::uuid
          AND service_variation_id IS NOT NULL
        LIMIT 5
      `
      
      // Time window: 7 days before order, 1 day after (same as reconcileBookingLinks)
      const startWindow = new Date(order.created_at.getTime() - 7 * 24 * 60 * 60 * 1000)
      const endWindow = new Date(order.created_at.getTime() + 1 * 24 * 60 * 60 * 1000)
      
      let matchingBooking = null
      let matchMethod = null
      
      // Method 2: Match by Customer + Location + Service Variation + Time
      if (lineItems && lineItems.length > 0) {
        for (const lineItem of lineItems) {
          try {
            const matchingBookings = await prisma.$queryRaw`
              SELECT 
                b.id,
                b.booking_id as square_booking_id,
                b.customer_id,
                b.start_at,
                b.status,
                b.service_variation_id,
                sv.square_variation_id,
                ABS(EXTRACT(EPOCH FROM (b.start_at - ${order.created_at}::timestamp))) / 3600 as hours_diff
              FROM bookings b
              INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
              WHERE b.customer_id = ${order.customer_id}
                AND b.location_id = ${locationUuid}::uuid
                AND sv.square_variation_id = ${lineItem.service_variation_id}
                AND b.start_at >= ${startWindow}::timestamp
                AND b.start_at <= ${endWindow}::timestamp
              ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${order.created_at}::timestamp)))
              LIMIT 1
            `
            
            if (matchingBookings && matchingBookings.length > 0) {
              matchingBooking = matchingBookings[0]
              matchMethod = 'Service Variation + Time'
              break
            }
          } catch (error) {
            // Skip if error (might be UUID casting issue)
            continue
          }
        }
      }
      
      // Method 3: Fallback to Customer + Location + Time
      if (!matchingBooking) {
        try {
          const fallbackBookings = await prisma.$queryRaw`
            SELECT 
              b.id,
              b.booking_id as square_booking_id,
              b.customer_id,
              b.start_at,
              b.status,
              b.service_variation_id,
              ABS(EXTRACT(EPOCH FROM (b.start_at - ${order.created_at}::timestamp))) / 3600 as hours_diff
            FROM bookings b
            WHERE b.customer_id = ${order.customer_id}
              AND b.location_id = ${locationUuid}::uuid
              AND b.start_at >= ${startWindow}::timestamp
              AND b.start_at <= ${endWindow}::timestamp
            ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${order.created_at}::timestamp)))
            LIMIT 1
          `
          
          if (fallbackBookings && fallbackBookings.length > 0) {
            matchingBooking = fallbackBookings[0]
            matchMethod = 'Customer + Location + Time'
          }
        } catch (error) {
          // Skip if error
          continue
        }
      }
      
      if (matchingBooking) {
        // Get payment details
        const payments = await prisma.$queryRaw`
          SELECT 
            p.payment_id as square_payment_id,
            p.status,
            p.total_money_amount,
            p.created_at
          FROM payments p
          WHERE p.order_id = ${order.order_uuid}::uuid
          ORDER BY p.created_at DESC
          LIMIT 3
        `
        
        // Get line item details
        const orderLineItems = await prisma.$queryRaw`
          SELECT 
            oli.uid,
            oli.service_variation_id,
            oli.name,
            oli.total_money_amount
          FROM order_line_items oli
          WHERE oli.order_id = ${order.order_uuid}::uuid
          LIMIT 5
        `
        
        matches.push({
          order,
          booking: matchingBooking,
          matchMethod,
          payments,
          lineItems: orderLineItems,
          locationUuid,
          squareLocationId
        })
        
        // Stop when we have 20 matches (to ensure we have at least 10 valid)
        if (matches.length >= 20) {
          break
        }
      }
    }
    
    if (matches.length === 0) {
      console.log('❌ No matches found')
      console.log('\n💡 This could mean:')
      console.log('   1. Orders and bookings are too far apart in time (>7 days)')
      console.log('   2. Service variations don\'t match')
      console.log('   3. Location IDs don\'t match')
      console.log('   4. Customer IDs don\'t match')
      await prisma.$disconnect()
      return
    }
    
    console.log(`\n✅ Found ${matches.length} potential matches:\n`)
    console.log('='.repeat(80))
    
    matches.forEach((match, idx) => {
      const { order, booking, matchMethod, payments, lineItems } = match
      
      console.log(`\n${idx + 1}. MATCH #${idx + 1}`)
      console.log(`${'─'.repeat(80)}`)
      console.log(`📦 Order:`)
      console.log(`   Square Order ID: ${order.order_id}`)
      console.log(`   Order UUID: ${order.order_uuid}`)
      console.log(`   Customer: ${order.customer_id}`)
      console.log(`   Location: ${match.squareLocationId}`)
      console.log(`   Created: ${order.created_at}`)
      console.log(`   Payments: ${Number(order.payment_count)}`)
      
      console.log(`\n📅 Booking:`)
      console.log(`   Booking UUID: ${booking.id}`)
      console.log(`   Square Booking ID: ${booking.square_booking_id}`)
      console.log(`   Customer: ${order.customer_id} ${order.customer_id === booking.customer_id ? '✅' : '❌'}`)
      console.log(`   Start At: ${booking.start_at}`)
      console.log(`   Status: ${booking.status}`)
      console.log(`   Service Variation: ${booking.service_variation_id || 'NULL'}`)
      console.log(`   Time Difference: ${Number(booking.hours_diff).toFixed(2)} hours`)
      console.log(`   Match Method: ${matchMethod}`)
      
      console.log(`\n💳 Payments:`)
      payments.forEach((p, pIdx) => {
        console.log(`   ${pIdx + 1}. ${p.square_payment_id}`)
        console.log(`      Status: ${p.status}`)
        console.log(`      Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
        console.log(`      Created: ${p.created_at}`)
      })
      
      console.log(`\n📋 Line Items:`)
      lineItems.forEach((li, liIdx) => {
        console.log(`   ${liIdx + 1}. ${li.name || 'Unnamed'}`)
        console.log(`      Service Variation: ${li.service_variation_id || 'NULL'}`)
        console.log(`      Amount: $${(Number(li.total_money_amount) / 100).toFixed(2)}`)
      })
      
      // Verification checks
      console.log(`\n✅ Verification:`)
      const timeDiffHours = Number(booking.hours_diff)
      const customerMatch = order.customer_id === (booking.customer_id || '')
      const timeReasonable = timeDiffHours >= -168 && timeDiffHours <= 24 // -7 days to +1 day
      
      console.log(`   Customer Match: ${customerMatch ? '✅' : '❌'}`)
      console.log(`   Time Window: ${timeReasonable ? '✅' : '❌'} (${timeDiffHours.toFixed(2)} hours)`)
      console.log(`   Location Match: ✅ (verified via location UUID)`)
      console.log(`   Has Payments: ${payments.length > 0 ? '✅' : '❌'}`)
      console.log(`   Has Line Items: ${lineItems.length > 0 ? '✅' : '❌'}`)
      
      const isValid = customerMatch && timeReasonable && payments.length > 0
      console.log(`\n   Overall: ${isValid ? '✅ VALID MATCH' : '❌ INVALID MATCH'}`)
    })
    
    console.log(`\n${'='.repeat(80)}`)
    console.log(`\n📊 Summary:`)
    console.log(`   Total matches found: ${matches.length}`)
    const validMatches = matches.filter(m => {
      const timeDiffHours = Number(m.booking.hours_diff)
      return m.order.customer_id === m.booking.customer_id &&
             timeDiffHours >= -168 && timeDiffHours <= 24 &&
             m.payments.length > 0
    })
    console.log(`   Valid matches: ${validMatches.length}`)
    console.log(`   Invalid matches: ${matches.length - validMatches.length}`)
    
    if (validMatches.length >= 10) {
      console.log(`\n✅ Found ${validMatches.length} valid matches! Ready for reconciliation.`)
      console.log(`\n💡 Next step: Run reconciliation on these orders:`)
      validMatches.forEach((match, idx) => {
        console.log(`   ${idx + 1}. Order: ${match.order.order_id} → Booking: ${match.booking.square_booking_id}`)
      })
    } else {
      console.log(`\n⚠️  Only found ${validMatches.length} valid matches (need at least 10)`)
      console.log(`   Consider:`)
      console.log(`   1. Expanding time window`)
      console.log(`   2. Checking if more orders have service_variation_id`)
      console.log(`   3. Verifying location matching logic`)
    }
    
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

verifyMatches()
  .then(() => {
    console.log('\n✅ Verification Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Verification Failed:', error)
    process.exit(1)
  })

