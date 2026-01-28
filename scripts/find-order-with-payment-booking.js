#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function findOrderWithPaymentBooking() {
  // Find orders that have payments with booking_id
  const orders = await prisma.$queryRaw`
    SELECT 
      o.order_id,
      o.id,
      o.customer_id,
      o.booking_id as order_booking_id,
      p.id as payment_id,
      p.booking_id as payment_booking_id
    FROM orders o
    INNER JOIN payments p ON p.order_id = o.id
    WHERE p.booking_id IS NOT NULL
      AND o.customer_id IS NOT NULL
    ORDER BY o.created_at DESC
    LIMIT 5
  `
  
  if (orders.length === 0) {
    console.log('No orders found with payments that have booking_id')
    console.log('\nChecking if any payments have booking_id at all...')
    
    const paymentsWithBooking = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM payments
      WHERE booking_id IS NOT NULL
    `
    console.log(`Total payments with booking_id: ${Number(paymentsWithBooking[0].count)}`)
  } else {
    console.log(`Found ${orders.length} orders with payments that have booking_id:\n`)
    orders.forEach((o, idx) => {
      console.log(`${idx + 1}. Order: ${o.order_id}`)
      console.log(`   Payment: ${o.payment_id}`)
      console.log(`   Payment booking_id: ${o.payment_booking_id}`)
      console.log(`   Order booking_id: ${o.order_booking_id || 'NULL'}`)
      console.log()
    })
    
    if (orders.length > 0) {
      const first = orders[0]
      console.log(`\nTest with:`)
      console.log(`node scripts/test-reconciliation-method.js ${first.order_id} ${first.payment_id}`)
    }
  }
  
  await prisma.$disconnect()
}

findOrderWithPaymentBooking().catch(console.error)



