#!/usr/bin/env node
/**
 * Find an order that has both booking_id and payment connected
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function findOrderWithBookingAndPayment() {
  console.log('🔍 Finding Order with Booking ID and Payment Connected\n')
  console.log('='.repeat(80))
  
  try {
    // Find orders that have booking_id and at least one payment
    const orders = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id as order_uuid,
        o.organization_id,
        o.customer_id,
        o.location_id,
        o.booking_id,
        o.created_at as order_created_at,
        o.state,
        COUNT(DISTINCT p.id) as payment_count,
        COUNT(DISTINCT p.id) FILTER (WHERE p.booking_id IS NOT NULL) as payments_with_booking,
        COUNT(DISTINCT oli.id) as line_item_count,
        COUNT(DISTINCT oli.id) FILTER (WHERE oli.booking_id IS NOT NULL) as line_items_with_booking
      FROM orders o
      INNER JOIN payments p ON p.order_id = o.id
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      WHERE o.booking_id IS NOT NULL
      GROUP BY o.order_id, o.id, o.organization_id, o.customer_id, o.location_id, o.booking_id, o.created_at, o.state
      HAVING COUNT(DISTINCT p.id) > 0
      ORDER BY o.created_at DESC
      LIMIT 5
    `
    
    if (!orders || orders.length === 0) {
      console.log('❌ No orders found with both booking_id and payments')
      
      // Check what we have
      const ordersWithBooking = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM orders WHERE booking_id IS NOT NULL
      `
      const ordersWithPayments = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT o.id) as count 
        FROM orders o
        INNER JOIN payments p ON p.order_id = o.id
      `
      const paymentsWithBooking = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM payments WHERE booking_id IS NOT NULL
      `
      
      console.log(`\nStatistics:`)
      console.log(`  Orders with booking_id: ${Number(ordersWithBooking[0].count)}`)
      console.log(`  Orders with payments: ${Number(ordersWithPayments[0].count)}`)
      console.log(`  Payments with booking_id: ${Number(paymentsWithBooking[0].count)}`)
      
      await prisma.$disconnect()
      return
    }
    
    console.log(`✅ Found ${orders.length} order(s) with booking_id and payments\n`)
    
    for (const order of orders) {
      console.log(`${'='.repeat(80)}`)
      console.log(`Order: ${order.order_id}`)
      console.log(`  UUID: ${order.order_uuid}`)
      console.log(`  Customer: ${order.customer_id}`)
      console.log(`  Location: ${order.location_id}`)
      console.log(`  State: ${order.state}`)
      console.log(`  Created: ${order.order_created_at}`)
      console.log(`  Booking ID: ${order.booking_id}`)
      console.log(`  Payments: ${Number(order.payment_count)}`)
      console.log(`  Payments with booking_id: ${Number(order.payments_with_booking)}`)
      console.log(`  Line Items: ${Number(order.line_item_count)}`)
      console.log(`  Line Items with booking_id: ${Number(order.line_items_with_booking)}`)
      
      // Get payment details
      const payments = await prisma.$queryRaw`
        SELECT 
          p.id,
          p.payment_id as square_payment_id,
          p.booking_id,
          p.customer_id,
          p.status,
          p.total_money_amount,
          p.created_at
        FROM payments p
        WHERE p.order_id = ${order.order_uuid}::uuid
        ORDER BY p.created_at DESC
        LIMIT 5
      `
      
      console.log(`\n  Payment Details:`)
      payments.forEach((p, idx) => {
        console.log(`    ${idx + 1}. Payment ID: ${p.id}`)
        console.log(`       Square Payment ID: ${p.square_payment_id}`)
        console.log(`       Booking ID: ${p.booking_id || 'NULL'}`)
        console.log(`       Status: ${p.status}`)
        console.log(`       Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
        console.log(`       Created: ${p.created_at}`)
        if (p.booking_id) {
          console.log(`       ✅ HAS BOOKING_ID!`)
        } else {
          console.log(`       ❌ Missing booking_id`)
        }
      })
      
      // Get booking details
      if (order.booking_id) {
        const booking = await prisma.$queryRaw`
          SELECT 
            b.id,
            b.booking_id as square_booking_id,
            b.customer_id,
            b.location_id,
            b.start_at,
            b.status,
            b.service_variation_id,
            b.technician_id
          FROM bookings b
          WHERE b.id = ${order.booking_id}::uuid
          LIMIT 1
        `
        
        if (booking && booking.length > 0) {
          const b = booking[0]
          console.log(`\n  Booking Details:`)
          console.log(`    Booking ID: ${b.id}`)
          console.log(`    Square Booking ID: ${b.square_booking_id}`)
          console.log(`    Customer: ${b.customer_id}`)
          console.log(`    Start At: ${b.start_at}`)
          console.log(`    Status: ${b.status}`)
          console.log(`    Service Variation: ${b.service_variation_id || 'NULL'}`)
          console.log(`    Technician: ${b.technician_id || 'NULL'}`)
        }
      }
      
      // Get line items
      const lineItems = await prisma.$queryRaw`
        SELECT 
          oli.id,
          oli.uid,
          oli.service_variation_id,
          oli.booking_id,
          oli.technician_id,
          oli.name,
          oli.total_money_amount
        FROM order_line_items oli
        WHERE oli.order_id = ${order.order_uuid}::uuid
        LIMIT 5
      `
      
      console.log(`\n  Line Items:`)
      lineItems.forEach((li, idx) => {
        console.log(`    ${idx + 1}. ${li.name || 'Unnamed'}`)
        console.log(`       UID: ${li.uid || 'NULL'}`)
        console.log(`       Service Variation: ${li.service_variation_id || 'NULL'}`)
        console.log(`       Booking ID: ${li.booking_id || 'NULL'}`)
        console.log(`       Technician: ${li.technician_id || 'NULL'}`)
        console.log(`       Amount: $${(Number(li.total_money_amount) / 100).toFixed(2)}`)
      })
      
      console.log()
    }
    
    // Show the first complete example
    if (orders.length > 0) {
      const firstOrder = orders[0]
      console.log(`${'='.repeat(80)}`)
      console.log('📋 COMPLETE EXAMPLE:\n')
      console.log(`Order ID (Square): ${firstOrder.order_id}`)
      console.log(`Order UUID: ${firstOrder.order_uuid}`)
      console.log(`Booking ID: ${firstOrder.booking_id}`)
      console.log(`Payments: ${Number(firstOrder.payment_count)}`)
      console.log(`Line Items: ${Number(firstOrder.line_item_count)}`)
      console.log(`\n✅ This order has:`)
      console.log(`   - booking_id in orders table`)
      console.log(`   - ${Number(firstOrder.payments_with_booking)} payment(s) with booking_id`)
      console.log(`   - ${Number(firstOrder.line_items_with_booking)} line item(s) with booking_id`)
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

findOrderWithBookingAndPayment()
  .then(() => {
    console.log('\n✅ Search Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Search Failed:', error)
    process.exit(1)
  })



