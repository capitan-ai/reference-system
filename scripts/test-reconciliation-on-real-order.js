#!/usr/bin/env node
/**
 * Test reconciliation on the real order we found
 * This will test if we can populate booking_id in payments
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function testReconciliation() {
  const orderId = 'P1c1WYwCzcpQQkLaHIiiDTQokLSZY'
  
  console.log(`🧪 Testing Reconciliation on Order: ${orderId}\n`)
  console.log('='.repeat(80))
  
  // Get order details
  const order = await prisma.$queryRaw`
    SELECT 
      o.id,
      o.order_id,
      o.booking_id,
      o.customer_id,
      o.location_id,
      o.created_at
    FROM orders o
    WHERE o.order_id = ${orderId}
    LIMIT 1
  `
  
  if (!order || order.length === 0) {
    console.log('Order not found')
    await prisma.$disconnect()
    return
  }
  
  const o = order[0]
  console.log('Order Details:')
  console.log(`  UUID: ${o.id}`)
  console.log(`  Booking ID: ${o.booking_id || 'NULL'}`)
  console.log(`  Customer: ${o.customer_id}`)
  console.log(`  Location: ${o.location_id}`)
  console.log(`  Created: ${o.created_at}`)
  
  // Get payments
  const payments = await prisma.$queryRaw`
    SELECT 
      p.id,
      p.payment_id,
      p.booking_id,
      p.status
    FROM payments p
    WHERE p.order_id = ${o.id}::uuid
  `
  
  console.log(`\nPayments: ${payments.length}`)
  payments.forEach((p, idx) => {
    console.log(`  ${idx + 1}. Payment: ${p.id}`)
    console.log(`     Booking ID: ${p.booking_id || 'NULL'}`)
  })
  
  // If order has booking_id but payments don't, update them
  if (o.booking_id && payments.length > 0) {
    const paymentsWithoutBooking = payments.filter(p => !p.booking_id)
    if (paymentsWithoutBooking.length > 0) {
      console.log(`\n💡 Found ${paymentsWithoutBooking.length} payment(s) without booking_id`)
      console.log(`   Order has booking_id: ${o.booking_id}`)
      console.log(`   We can update payments to link them`)
      
      // Update payments
      const updateResult = await prisma.$executeRaw`
        UPDATE payments
        SET booking_id = ${o.booking_id}::uuid,
            updated_at = NOW()
        WHERE order_id = ${o.id}::uuid
          AND booking_id IS NULL
      `
      
      console.log(`\n✅ Updated ${updateResult} payment(s) with booking_id`)
      
      // Verify
      const updatedPayments = await prisma.$queryRaw`
        SELECT 
          p.id,
          p.booking_id
        FROM payments p
        WHERE p.order_id = ${o.id}::uuid
      `
      
      console.log(`\nVerification:`)
      updatedPayments.forEach((p, idx) => {
        console.log(`  ${idx + 1}. Payment: ${p.id}`)
        console.log(`     Booking ID: ${p.booking_id || 'NULL'}`)
        if (p.booking_id) {
          console.log(`     ✅ HAS BOOKING_ID!`)
        }
      })
    }
  }
  
  await prisma.$disconnect()
}

testReconciliation().catch(console.error)



