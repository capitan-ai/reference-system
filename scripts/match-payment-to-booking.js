#!/usr/bin/env node
/**
 * Match a payment to a booking and use it to populate order's booking_id
 * Since payments have order_id, we can use payments as a bridge
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function matchPaymentToBooking(paymentId) {
  console.log('🔍 Matching Payment to Booking\n')
  console.log('='.repeat(80))
  console.log(`Square Payment ID: ${paymentId}\n`)

  try {
    // Get payment details
    const paymentRecord = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.payment_id as square_payment_id,
        p.order_id,
        p.booking_id as current_booking_id,
        p.customer_id,
        p.location_id,
        p.created_at,
        l.square_location_id,
        l.id as location_uuid
      FROM payments p
      LEFT JOIN locations l ON l.id::text = p.location_id::text
      WHERE p.payment_id = ${paymentId}
      LIMIT 1
    `
    
    if (!paymentRecord || paymentRecord.length === 0) {
      console.log('❌ Payment not found in database')
      return
    }
    
    const payment = paymentRecord[0]
    const locationUuid = payment.location_uuid || payment.location_id
    
    console.log('✅ Payment Details:')
    console.log(`   Square Payment ID: ${payment.square_payment_id}`)
    console.log(`   Order ID: ${payment.order_id || 'NULL'}`)
    console.log(`   Current Booking ID: ${payment.current_booking_id || 'NULL'}`)
    console.log(`   Customer ID: ${payment.customer_id || 'NULL'}`)
    console.log(`   Location: ${locationUuid}`)
    console.log(`   Square Location ID: ${payment.square_location_id || 'N/A'}`)
    console.log(`   Payment Created: ${payment.created_at}\n`)
    
    if (!payment.customer_id) {
      console.log('❌ Payment has no customer_id - cannot match to booking')
      return
    }
    
    if (!payment.order_id) {
      console.log('❌ Payment has no order_id - cannot use as bridge')
      return
    }
    
    // Get order details
    console.log('='.repeat(80))
    console.log('\n📦 Order Details:\n')
    
    const orderRecord = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id as square_order_id,
        o.booking_id as current_order_booking_id,
        o.created_at
      FROM orders o
      WHERE o.id = ${payment.order_id}::uuid
      LIMIT 1
    `
    
    if (!orderRecord || orderRecord.length === 0) {
      console.log('❌ Order not found for this payment')
      return
    }
    
    const order = orderRecord[0]
    console.log(`   Square Order ID: ${order.square_order_id}`)
    console.log(`   Current Booking ID: ${order.current_order_booking_id || 'NULL'}`)
    console.log(`   Order Created: ${order.created_at}\n`)
    
    // Get line items with service_variation_id
    const lineItems = await prisma.$queryRaw`
      SELECT 
        oli.service_variation_id,
        oli.name
      FROM order_line_items oli
      WHERE oli.order_id = ${order.id}::uuid
        AND oli.service_variation_id IS NOT NULL
      LIMIT 5
    `
    
    const paymentCreatedAt = new Date(payment.created_at)
    const orderCreatedAt = new Date(order.created_at)
    const startWindow = new Date(paymentCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000) // 7 days before payment
    const endWindow = new Date(paymentCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000) // 1 day after payment
    
    console.log('='.repeat(80))
    console.log('\n🔍 Matching Payment to Booking:\n')
    console.log(`   Customer ID: ${payment.customer_id}`)
    console.log(`   Location: ${payment.square_location_id || locationUuid}`)
    console.log(`   Payment Created: ${paymentCreatedAt.toISOString()}`)
    console.log(`   Time Window: ${startWindow.toISOString()} to ${endWindow.toISOString()}\n`)
    
    if (lineItems && lineItems.length > 0) {
      console.log(`📦 Found ${lineItems.length} line item(s) with service_variation_id\n`)
      
      // Try matching with service_variation_id
      for (const lineItem of lineItems) {
        console.log(`   Service Variation ID: ${lineItem.service_variation_id}`)
        
        let matchingBookings = null
        
        if (payment.square_location_id) {
          matchingBookings = await prisma.$queryRaw`
            SELECT 
              b.id,
              b.booking_id as square_booking_id,
              b.customer_id,
              b.start_at,
              b.technician_id,
              EXTRACT(EPOCH FROM (b.start_at - ${paymentCreatedAt}::timestamp)) as time_diff_seconds
            FROM bookings b
            INNER JOIN locations l ON l.id::text = b.location_id::text
            INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
            WHERE b.customer_id = ${payment.customer_id}
              AND l.square_location_id = ${payment.square_location_id}
              AND sv.square_variation_id = ${lineItem.service_variation_id}
              AND b.start_at >= ${startWindow}::timestamp
              AND b.start_at <= ${endWindow}::timestamp
            ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${paymentCreatedAt}::timestamp)))
            LIMIT 5
          `
        } else {
          matchingBookings = await prisma.$queryRaw`
            SELECT 
              b.id,
              b.booking_id as square_booking_id,
              b.customer_id,
              b.start_at,
              b.technician_id,
              EXTRACT(EPOCH FROM (b.start_at - ${paymentCreatedAt}::timestamp)) as time_diff_seconds
            FROM bookings b
            INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
            WHERE b.customer_id = ${payment.customer_id}
              AND b.location_id::text = ${locationUuid}::text
              AND sv.square_variation_id = ${lineItem.service_variation_id}
              AND b.start_at >= ${startWindow}::timestamp
              AND b.start_at <= ${endWindow}::timestamp
            ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${paymentCreatedAt}::timestamp)))
            LIMIT 5
          `
        }
        
        if (matchingBookings && matchingBookings.length > 0) {
          const bestMatch = matchingBookings[0]
          const timeDiffHours = Math.abs(parseFloat(bestMatch.time_diff_seconds) / 3600)
          
          console.log(`\n   ✅ Found ${matchingBookings.length} matching booking(s):`)
          console.log(`      Best Match: ${bestMatch.square_booking_id}`)
          console.log(`      Time difference: ${timeDiffHours.toFixed(2)} hours`)
          
          if (timeDiffHours <= 24) {
            console.log(`      ✅ GOOD MATCH (within 24 hours)`)
            
            // Update payment with booking_id
            console.log(`\n   💾 Updating payment with booking_id: ${bestMatch.id}`)
            await prisma.$executeRaw`
              UPDATE payments
              SET booking_id = ${bestMatch.id}::uuid,
                  updated_at = NOW()
              WHERE id = ${payment.id}::uuid
                AND booking_id IS NULL
            `
            console.log(`   ✅ Payment updated!`)
            
            // Update order with booking_id
            console.log(`\n   💾 Updating order with booking_id: ${bestMatch.id}`)
            await prisma.$executeRaw`
              UPDATE orders
              SET booking_id = ${bestMatch.id}::uuid,
                  updated_at = NOW()
              WHERE id = ${order.id}::uuid
                AND booking_id IS NULL
            `
            console.log(`   ✅ Order updated!`)
            
            // Update order_line_items
            const lineItemsCount = await prisma.$executeRaw`
              UPDATE order_line_items
              SET booking_id = ${bestMatch.id}::uuid,
                  updated_at = NOW()
              WHERE order_id = ${order.id}::uuid
                AND booking_id IS NULL
            `
            console.log(`   ✅ Updated ${lineItemsCount} order_line_item(s)!`)
            
            return // Found match, exit
          } else {
            console.log(`      ⚠️  WEAK MATCH (more than 24 hours apart)`)
          }
        } else {
          console.log(`   ❌ No matching bookings found`)
        }
      }
    } else {
      console.log('⚠️  No line items with service_variation_id found')
      console.log('   Trying to match without service_variation_id...\n')
      
      // Match without service_variation_id
      let matchingBookings = null
      
      if (payment.square_location_id) {
        matchingBookings = await prisma.$queryRaw`
          SELECT 
            b.id,
            b.booking_id as square_booking_id,
            b.customer_id,
            b.start_at,
            EXTRACT(EPOCH FROM (b.start_at - ${paymentCreatedAt}::timestamp)) as time_diff_seconds
          FROM bookings b
          INNER JOIN locations l ON l.id::text = b.location_id::text
          WHERE b.customer_id = ${payment.customer_id}
            AND l.square_location_id = ${payment.square_location_id}
            AND b.start_at >= ${startWindow}::timestamp
            AND b.start_at <= ${endWindow}::timestamp
          ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${paymentCreatedAt}::timestamp)))
          LIMIT 5
        `
      } else {
        matchingBookings = await prisma.$queryRaw`
          SELECT 
            b.id,
            b.booking_id as square_booking_id,
            b.customer_id,
            b.start_at,
            EXTRACT(EPOCH FROM (b.start_at - ${paymentCreatedAt}::timestamp)) as time_diff_seconds
          FROM bookings b
          WHERE b.customer_id = ${payment.customer_id}
            AND b.location_id::text = ${locationUuid}::text
            AND b.start_at >= ${startWindow}::timestamp
            AND b.start_at <= ${endWindow}::timestamp
          ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${paymentCreatedAt}::timestamp)))
          LIMIT 5
        `
      }
      
      if (matchingBookings && matchingBookings.length > 0) {
        const bestMatch = matchingBookings[0]
        const timeDiffHours = Math.abs(parseFloat(bestMatch.time_diff_seconds) / 3600)
        
        console.log(`✅ Found ${matchingBookings.length} matching booking(s) (without service):`)
        console.log(`   Best Match: ${bestMatch.square_booking_id}`)
        console.log(`   Time difference: ${timeDiffHours.toFixed(2)} hours`)
        
        if (timeDiffHours <= 24) {
          console.log(`   ✅ GOOD MATCH`)
          // Update payment, order, and line items (same as above)
        }
      } else {
        console.log(`❌ No matching bookings found`)
      }
    }
    
    // Final summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Final Status:\n')
    
    const updatedPayment = await prisma.$queryRaw`
      SELECT booking_id FROM payments WHERE id = ${payment.id}::uuid
    `
    const updatedOrder = await prisma.$queryRaw`
      SELECT booking_id FROM orders WHERE id = ${order.id}::uuid
    `
    
    console.log(`   Payment Booking ID: ${updatedPayment[0]?.booking_id || 'NULL'}`)
    console.log(`   Order Booking ID: ${updatedOrder[0]?.booking_id || 'NULL'}`)
    
    if (updatedPayment[0]?.booking_id && updatedOrder[0]?.booking_id) {
      console.log(`\n   ✅ Successfully linked payment → booking → order!`)
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

// Get payment ID from command line argument
const paymentId = process.argv[2] || 'R2ZxYK3gEQc5ATpF3dqqzh1fvaB'

matchPaymentToBooking(paymentId)
  .then(() => {
    console.log('\n✅ Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })



