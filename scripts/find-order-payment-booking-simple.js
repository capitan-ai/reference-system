#!/usr/bin/env node
/**
 * Simple script to find orders connected to payments and bookings
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function findConnections() {
  console.log('🔍 Finding Orders with Payment and Booking Connections\n')
  console.log('='.repeat(80))
  
  try {
    // 1. Find orders that have BOTH booking_id AND payments
    console.log('\n1️⃣ Orders with booking_id AND payments:')
    const completeOrders = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id as order_uuid,
        o.booking_id,
        o.customer_id,
        o.state,
        o.created_at,
        COUNT(DISTINCT p.id) as payment_count
      FROM orders o
      INNER JOIN payments p ON p.order_id = o.id
      WHERE o.booking_id IS NOT NULL
      GROUP BY o.order_id, o.id, o.booking_id, o.customer_id, o.state, o.created_at
      ORDER BY o.created_at DESC
      LIMIT 5
    `
    
    if (completeOrders && completeOrders.length > 0) {
      console.log(`\n✅ Found ${completeOrders.length} order(s) with both booking_id and payments:\n`)
      
      for (const order of completeOrders) {
        console.log(`Order: ${order.order_id}`)
        console.log(`  UUID: ${order.order_uuid}`)
        console.log(`  Booking ID: ${order.booking_id}`)
        console.log(`  Customer: ${order.customer_id}`)
        console.log(`  Payments: ${Number(order.payment_count)}`)
        console.log(`  Created: ${order.created_at}`)
        
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
        
        console.log(`\n  Payments:`)
        payments.forEach((p, idx) => {
          console.log(`    ${idx + 1}. ${p.square_payment_id}`)
          console.log(`       Booking ID: ${p.booking_id || 'NULL'}`)
          console.log(`       Status: ${p.status}`)
          console.log(`       Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
        })
        
        // Get booking details
        if (order.booking_id) {
          const booking = await prisma.$queryRaw`
            SELECT 
              b.booking_id as square_booking_id,
              b.customer_id,
              b.start_at,
              b.status,
              b.service_variation_id
            FROM bookings b
            WHERE b.id = ${order.booking_id}::uuid
            LIMIT 1
          `
          
          if (booking && booking.length > 0) {
            const b = booking[0]
            console.log(`\n  Booking:`)
            console.log(`    Square Booking ID: ${b.square_booking_id}`)
            console.log(`    Customer: ${b.customer_id}`)
            console.log(`    Start: ${b.start_at}`)
            console.log(`    Status: ${b.status}`)
            console.log(`    Service Variation: ${b.service_variation_id || 'NULL'}`)
          }
        }
        
        console.log()
      }
    } else {
      console.log('❌ No orders found with both booking_id and payments')
    }
    
    // 2. Statistics
    console.log('\n\n2️⃣ Statistics:')
    const stats = await prisma.$queryRaw`
      SELECT 
        (SELECT COUNT(*) FROM orders WHERE booking_id IS NOT NULL) as orders_with_booking,
        (SELECT COUNT(DISTINCT o.id) FROM orders o INNER JOIN payments p ON p.order_id = o.id) as orders_with_payments,
        (SELECT COUNT(*) FROM payments WHERE booking_id IS NOT NULL) as payments_with_booking,
        (SELECT COUNT(*) FROM payments WHERE order_id IS NOT NULL) as payments_with_order,
        (SELECT COUNT(*) FROM order_line_items WHERE booking_id IS NOT NULL) as line_items_with_booking,
        (SELECT COUNT(*) FROM bookings) as total_bookings,
        (SELECT COUNT(*) FROM orders o 
         INNER JOIN payments p ON p.order_id = o.id 
         WHERE o.booking_id IS NOT NULL) as orders_with_booking_and_payment
    `
    
    if (stats && stats.length > 0) {
      const s = stats[0]
      console.log(`   Orders with booking_id: ${Number(s.orders_with_booking)}`)
      console.log(`   Orders with payments: ${Number(s.orders_with_payments)}`)
      console.log(`   Orders with BOTH booking_id AND payments: ${Number(s.orders_with_booking_and_payment)}`)
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



