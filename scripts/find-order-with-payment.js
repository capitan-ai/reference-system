#!/usr/bin/env node
/**
 * Find orders that have payments connected
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function findOrdersWithPayments() {
  console.log('🔍 Finding Orders with Payments\n')
  console.log('='.repeat(80))
  
  try {
    // Find orders with payments
    const orders = await prisma.$queryRaw`
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
      WHERE o.customer_id IS NOT NULL
      GROUP BY o.order_id, o.id, o.booking_id, o.customer_id, o.state, o.created_at
      ORDER BY o.created_at DESC
      LIMIT 10
    `
    
    if (!orders || orders.length === 0) {
      console.log('❌ No orders found with payments')
      await prisma.$disconnect()
      return
    }
    
    console.log(`✅ Found ${orders.length} orders with payments:\n`)
    
    for (const order of orders) {
      console.log(`${'='.repeat(80)}`)
      console.log(`Order: ${order.order_id}`)
      console.log(`  UUID: ${order.order_uuid}`)
      console.log(`  Customer: ${order.customer_id}`)
      console.log(`  State: ${order.state}`)
      console.log(`  Created: ${order.created_at}`)
      console.log(`  Booking ID: ${order.booking_id || 'NULL'}`)
      console.log(`  Payments: ${Number(order.payment_count)}`)
      
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
        LIMIT 5
      `
      
      console.log(`\n  Payments:`)
      payments.forEach((p, idx) => {
        console.log(`    ${idx + 1}. Payment: ${p.square_payment_id}`)
        console.log(`       Payment UUID: ${p.id}`)
        console.log(`       Booking ID: ${p.booking_id || 'NULL'}`)
        console.log(`       Status: ${p.status}`)
        console.log(`       Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
        console.log(`       Created: ${p.created_at}`)
      })
      
      // Get line items
      const lineItems = await prisma.$queryRaw`
        SELECT 
          oli.id,
          oli.uid,
          oli.service_variation_id,
          oli.booking_id,
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
        console.log(`       Amount: $${(Number(li.total_money_amount) / 100).toFixed(2)}`)
      })
      
      // If order has booking_id, show booking details
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
          console.log(`\n  ✅ Booking Connected:`)
          console.log(`     Square Booking ID: ${b.square_booking_id}`)
          console.log(`     Customer: ${b.customer_id}`)
          console.log(`     Start: ${b.start_at}`)
          console.log(`     Status: ${b.status}`)
          console.log(`     Service Variation: ${b.service_variation_id || 'NULL'}`)
        }
      }
      
      console.log()
    }
    
    // Summary
    console.log(`${'='.repeat(80)}`)
    console.log('📊 Summary:')
    const withBooking = orders.filter(o => o.booking_id).length
    const withPayments = orders.length
    console.log(`  Orders shown: ${withPayments}`)
    console.log(`  Orders with booking_id: ${withBooking}`)
    console.log(`  Orders with payments but no booking_id: ${withPayments - withBooking}`)
    
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

findOrdersWithPayments()
  .then(() => {
    console.log('\n✅ Search Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Search Failed:', error)
    process.exit(1)
  })



