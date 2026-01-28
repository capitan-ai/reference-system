#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function findTestOrder() {
  const orders = await prisma.$queryRaw`
    SELECT 
      o.order_id, 
      o.id, 
      o.customer_id, 
      o.location_id, 
      o.booking_id, 
      o.created_at,
      (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id) as payment_count
    FROM orders o
    WHERE o.customer_id IS NOT NULL 
      AND o.location_id IS NOT NULL
    ORDER BY o.created_at DESC
    LIMIT 5
  `
  
  console.log('Recent orders with customer and location:')
  orders.forEach((o, idx) => {
    console.log(`\n${idx + 1}. Order ID (Square): ${o.order_id}`)
    console.log(`   Internal UUID: ${o.id}`)
    console.log(`   Customer ID: ${o.customer_id}`)
    console.log(`   Booking ID: ${o.booking_id || 'NULL'}`)
    console.log(`   Payments: ${Number(o.payment_count)}`)
    console.log(`   Created: ${o.created_at}`)
  })
  
  if (orders.length > 0) {
    const firstOrder = orders[0]
    const payments = await prisma.$queryRaw`
      SELECT id, booking_id
      FROM payments
      WHERE order_id = ${firstOrder.id}::uuid
      LIMIT 3
    `
    
    console.log(`\n\nTest with:`)
    console.log(`Order ID: ${firstOrder.order_id}`)
    if (payments.length > 0) {
      console.log(`Payment ID: ${payments[0].id}`)
    }
    console.log(`\nCommand:`)
    console.log(`node scripts/test-reconciliation-method.js ${firstOrder.order_id} ${payments.length > 0 ? payments[0].id : ''}`)
  }
  
  await prisma.$disconnect()
}

findTestOrder().catch(console.error)



