#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function showOrderWithBooking() {
  // Get the order with booking_id
  const order = await prisma.$queryRaw`
    SELECT 
      o.order_id,
      o.id as order_uuid,
      o.organization_id,
      o.customer_id,
      o.location_id,
      o.booking_id,
      o.created_at,
      o.state
    FROM orders o
    WHERE o.booking_id IS NOT NULL
    LIMIT 1
  `
  
  if (!order || order.length === 0) {
    console.log('No order with booking_id found')
    await prisma.$disconnect()
    return
  }
  
  const o = order[0]
  console.log('Order with Booking ID:')
  console.log(`  Order ID (Square): ${o.order_id}`)
  console.log(`  Order UUID: ${o.order_uuid}`)
  console.log(`  Booking ID: ${o.booking_id}`)
  console.log(`  Customer: ${o.customer_id}`)
  console.log(`  Location: ${o.location_id}`)
  console.log(`  Created: ${o.created_at}`)
  console.log(`  State: ${o.state}`)
  
  // Get payments
  const payments = await prisma.$queryRaw`
    SELECT 
      p.id,
      p.payment_id as square_payment_id,
      p.booking_id,
      p.status,
      p.total_money_amount,
      p.created_at
    FROM payments p
    WHERE p.order_id = ${o.order_uuid}::uuid
    ORDER BY p.created_at DESC
  `
  
  console.log(`\nPayments (${payments.length}):`)
  payments.forEach((p, idx) => {
    console.log(`  ${idx + 1}. Payment ID: ${p.id}`)
    console.log(`     Square Payment ID: ${p.square_payment_id}`)
    console.log(`     Booking ID: ${p.booking_id || 'NULL'}`)
    console.log(`     Status: ${p.status}`)
    console.log(`     Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
    console.log(`     Created: ${p.created_at}`)
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
    WHERE oli.order_id = ${o.order_uuid}::uuid
    LIMIT 10
  `
  
  console.log(`\nLine Items (${lineItems.length}):`)
  lineItems.forEach((li, idx) => {
    console.log(`  ${idx + 1}. ${li.name || 'Unnamed'}`)
    console.log(`     UID: ${li.uid || 'NULL'}`)
    console.log(`     Service Variation: ${li.service_variation_id || 'NULL'}`)
    console.log(`     Booking ID: ${li.booking_id || 'NULL'}`)
    console.log(`     Amount: $${(Number(li.total_money_amount) / 100).toFixed(2)}`)
  })
  
  // Get booking details
  const booking = await prisma.$queryRaw`
    SELECT 
      b.id,
      b.booking_id as square_booking_id,
      b.customer_id,
      b.start_at,
      b.status,
      b.service_variation_id
    FROM bookings b
    WHERE b.id = ${o.booking_id}::uuid
    LIMIT 1
  `
  
  if (booking && booking.length > 0) {
    const b = booking[0]
    console.log(`\nBooking Details:`)
    console.log(`  Booking ID: ${b.id}`)
    console.log(`  Square Booking ID: ${b.square_booking_id}`)
    console.log(`  Customer: ${b.customer_id}`)
    console.log(`  Start At: ${b.start_at}`)
    console.log(`  Status: ${b.status}`)
    console.log(`  Service Variation: ${b.service_variation_id || 'NULL'}`)
  }
  
  // Check if we can update payments
  if (payments.length > 0 && o.booking_id) {
    console.log(`\n💡 Recommendation:`)
    console.log(`   This order has booking_id but payments don't.`)
    console.log(`   We can update payments with booking_id using:`)
    console.log(`   UPDATE payments SET booking_id = '${o.booking_id}' WHERE order_id = '${o.order_uuid}'`)
  }
  
  await prisma.$disconnect()
}

showOrderWithBooking().catch(console.error)



