#!/usr/bin/env node
/**
 * Find orders that can be connected to payments and bookings
 * Shows detailed analysis of the relationships
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function findConnections() {
  console.log('🔍 Finding Orders with Payment and Booking Connections\n')
  console.log('='.repeat(80))
  
  try {
    // 1. Check the order that has booking_id
    const orderWithBooking = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id as order_uuid,
        o.booking_id,
        o.customer_id,
        o.location_id,
        o.state,
        o.created_at,
        COUNT(DISTINCT p.id) as payment_count
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.booking_id IS NOT NULL
      GROUP BY o.order_id, o.id, o.booking_id, o.customer_id, o.location_id, o.state, o.created_at
      LIMIT 5
    `
    
    console.log('\n1️⃣ Orders WITH booking_id:')
    if (orderWithBooking && orderWithBooking.length > 0) {
      orderWithBooking.forEach((order, idx) => {
        console.log(`\n   Order ${idx + 1}:`)
        console.log(`     Order ID (Square): ${order.order_id}`)
        console.log(`     Order UUID: ${order.order_uuid}`)
        console.log(`     Booking ID: ${order.booking_id}`)
        console.log(`     Customer: ${order.customer_id}`)
        console.log(`     Location: ${order.location_id}`)
        console.log(`     State: ${order.state}`)
        console.log(`     Created: ${order.created_at}`)
        console.log(`     Payments: ${Number(order.payment_count)}`)
        
        // Get booking details
        if (order.booking_id) {
          const booking = prisma.$queryRaw`
            SELECT 
              b.booking_id as square_booking_id,
              b.customer_id,
              b.location_id,
              b.start_at,
              b.status,
              b.service_variation_id
            FROM bookings b
            WHERE b.id = ${order.booking_id}::uuid
            LIMIT 1
          `.then(bookings => {
            if (bookings && bookings.length > 0) {
              const b = bookings[0]
              console.log(`\n     Booking Details:`)
              console.log(`       Square Booking ID: ${b.square_booking_id}`)
              console.log(`       Customer: ${b.customer_id}`)
              console.log(`       Location: ${b.location_id}`)
              console.log(`       Start At: ${b.start_at}`)
              console.log(`       Status: ${b.status}`)
              console.log(`       Service Variation: ${b.service_variation_id || 'NULL'}`)
            }
          })
        }
      })
    } else {
      console.log('   None found')
    }
    
    // 2. Find orders with payments that might have matching bookings
    console.log('\n\n2️⃣ Orders WITH payments (potential booking matches):')
    const ordersWithPayments = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id as order_uuid,
        o.booking_id,
        o.customer_id,
        o.location_id,
        l.square_location_id,
        o.state,
        o.created_at as order_created_at,
        COUNT(DISTINCT p.id) as payment_count,
        COUNT(DISTINCT oli.id) as line_item_count,
        COUNT(DISTINCT oli.service_variation_id) FILTER (WHERE oli.service_variation_id IS NOT NULL) as line_items_with_service
      FROM orders o
      INNER JOIN payments p ON p.order_id = o.id
      LEFT JOIN locations l ON o.location_id = l.id
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      WHERE o.booking_id IS NULL
        AND o.customer_id IS NOT NULL
        AND o.location_id IS NOT NULL
      GROUP BY o.order_id, o.id, o.booking_id, o.customer_id, o.location_id, o.state, o.created_at, l.square_location_id
      ORDER BY o.created_at DESC
      LIMIT 10
    `
    
    if (ordersWithPayments && ordersWithPayments.length > 0) {
      console.log(`\n   Found ${ordersWithPayments.length} orders with payments (no booking_id yet):\n`)
      
      for (const order of ordersWithPayments.slice(0, 3)) {
        console.log(`   Order: ${order.order_id}`)
        console.log(`     UUID: ${order.order_uuid}`)
        console.log(`     Customer: ${order.customer_id}`)
        console.log(`     Location UUID: ${order.location_id}`)
        console.log(`     Square Location ID: ${order.square_location_id || 'NULL'}`)
        console.log(`     Created: ${order.order_created_at}`)
        console.log(`     Payments: ${Number(order.payment_count)}`)
        console.log(`     Line Items: ${Number(order.line_item_count)}`)
        console.log(`     Line Items with Service: ${Number(order.line_items_with_service)}`)
        
        // Check for potential booking matches
        // Match by customer_id and location_id (both are UUIDs in bookings table)
        const potentialBookings = await prisma.$queryRaw`
          SELECT 
            b.id,
            b.booking_id as square_booking_id,
            b.customer_id,
            b.location_id,
            b.start_at,
            b.status,
            b.service_variation_id,
            ABS(EXTRACT(EPOCH FROM (b.start_at - ${order.order_created_at}::timestamp))) / 3600 as hours_diff
          FROM bookings b
          WHERE b.customer_id = ${order.customer_id}
            AND b.location_id = ${order.location_id}::uuid
            AND b.start_at BETWEEN (${order.order_created_at}::timestamp - INTERVAL '2 hours')
                AND (${order.order_created_at}::timestamp + INTERVAL '2 hours')
          ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${order.order_created_at}::timestamp)))
          LIMIT 3
        `
        
        if (potentialBookings && potentialBookings.length > 0) {
          console.log(`\n     🎯 Potential Booking Matches:`)
          potentialBookings.forEach((b, idx) => {
            console.log(`       ${idx + 1}. Booking ID: ${b.square_booking_id}`)
            console.log(`          UUID: ${b.id}`)
            console.log(`          Start: ${b.start_at}`)
            console.log(`          Status: ${b.status}`)
            console.log(`          Service Variation: ${b.service_variation_id || 'NULL'}`)
            console.log(`          Time Difference: ${Number(b.hours_diff).toFixed(2)} hours`)
          })
        } else {
          console.log(`     ❌ No potential booking matches found`)
        }
        
        // Get payment details
        const payments = await prisma.$queryRaw`
          SELECT 
            p.id,
            p.payment_id as square_payment_id,
            p.booking_id,
            p.status,
            p.total_money_amount,
            p.created_at
          FROM payments p
          WHERE p.order_id = ${order.order_uuid}::uuid
          ORDER BY p.created_at DESC
          LIMIT 3
        `
        
        console.log(`\n     Payment Details:`)
        payments.forEach((p, idx) => {
          console.log(`       ${idx + 1}. Payment: ${p.square_payment_id}`)
          console.log(`          Booking ID: ${p.booking_id || 'NULL'}`)
          console.log(`          Status: ${p.status}`)
          console.log(`          Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
        })
        
        console.log()
      }
    } else {
      console.log('   None found')
    }
    
    // 3. Statistics
    console.log('\n\n3️⃣ Statistics:')
    const stats = await prisma.$queryRaw`
      SELECT 
        (SELECT COUNT(*) FROM orders WHERE booking_id IS NOT NULL) as orders_with_booking,
        (SELECT COUNT(DISTINCT o.id) FROM orders o INNER JOIN payments p ON p.order_id = o.id) as orders_with_payments,
        (SELECT COUNT(*) FROM payments WHERE booking_id IS NOT NULL) as payments_with_booking,
        (SELECT COUNT(*) FROM payments WHERE order_id IS NOT NULL) as payments_with_order,
        (SELECT COUNT(*) FROM order_line_items WHERE booking_id IS NOT NULL) as line_items_with_booking,
        (SELECT COUNT(*) FROM bookings) as total_bookings
    `
    
    if (stats && stats.length > 0) {
      const s = stats[0]
      console.log(`   Orders with booking_id: ${Number(s.orders_with_booking)}`)
      console.log(`   Orders with payments: ${Number(s.orders_with_payments)}`)
      console.log(`   Payments with booking_id: ${Number(s.payments_with_booking)}`)
      console.log(`   Payments with order_id: ${Number(s.payments_with_order)}`)
      console.log(`   Line items with booking_id: ${Number(s.line_items_with_booking)}`)
      console.log(`   Total bookings: ${Number(s.total_bookings)}`)
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

findConnections()
  .then(() => {
    console.log('\n✅ Analysis Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Analysis Failed:', error)
    process.exit(1)
  })

