#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkLinking() {
  const orderId = 'P1c1WYwCzcpQQkLaHIiiDTQokLSZY'
  
  console.log('🔍 Checking Payment-Order Linking Logic\n')
  console.log('='.repeat(80))
  console.log(`Order ID (Square): ${orderId}\n`)
  
  // Get order UUID
  const order = await prisma.$queryRaw`
    SELECT id, order_id, organization_id, customer_id, created_at
    FROM orders
    WHERE order_id = ${orderId}
    LIMIT 1
  `
  
  if (!order || order.length === 0) {
    console.log('Order not found')
    await prisma.$disconnect()
    return
  }
  
  const o = order[0]
  console.log('Order:')
  console.log(`  UUID: ${o.id}`)
  console.log(`  Organization: ${o.organization_id}`)
  console.log(`  Customer: ${o.customer_id}`)
  console.log(`  Created: ${o.created_at}`)
  
  // Check payments that should link to this order
  // The payment webhook handler looks up order by: WHERE order_id = ${orderId} AND organization_id = ${organizationId}::uuid
  console.log(`\n${'='.repeat(80)}`)
  console.log('Simulating Payment Webhook Order Lookup:\n')
  
  const orderLookup = await prisma.$queryRaw`
    SELECT id FROM orders 
    WHERE order_id = ${orderId}
      AND organization_id = ${o.organization_id}::uuid
    LIMIT 1
  `
  
  console.log(`Lookup result: ${orderLookup && orderLookup.length > 0 ? 'FOUND' : 'NOT FOUND'}`)
  if (orderLookup && orderLookup.length > 0) {
    console.log(`  Order UUID: ${orderLookup[0].id}`)
    console.log(`  Matches our order: ${orderLookup[0].id === o.id ? 'YES' : 'NO'}`)
  }
  
  // Check if payments exist with NULL order_id that might be for this order
  console.log(`\n${'='.repeat(80)}`)
  console.log('Checking payments with NULL order_id around the same time:\n')
  
  const orderCreatedAt = new Date(o.created_at)
  const startWindow = new Date(orderCreatedAt.getTime() - 1 * 60 * 60 * 1000) // 1 hour before
  const endWindow = new Date(orderCreatedAt.getTime() + 1 * 60 * 60 * 1000) // 1 hour after
  
  const unlinkedPayments = await prisma.$queryRaw`
    SELECT 
      p.id,
      p.payment_id,
      p.order_id,
      p.customer_id,
      p.status,
      p.total_money_amount,
      p.created_at
    FROM payments p
    WHERE (p.order_id IS NULL OR p.order_id != ${o.id}::uuid)
      AND p.customer_id = ${o.customer_id}
      AND p.created_at >= ${startWindow}::timestamp
      AND p.created_at <= ${endWindow}::timestamp
    ORDER BY p.created_at DESC
    LIMIT 10
  `
  
  console.log(`Found ${unlinkedPayments.length} unlinked payment(s) for this customer in time window`)
  console.log(`Time window: ${startWindow.toISOString()} to ${endWindow.toISOString()}\n`)
  
  unlinkedPayments.forEach((p, idx) => {
    console.log(`  ${idx + 1}. Payment: ${p.id}`)
    console.log(`     Square Payment ID: ${p.payment_id}`)
    console.log(`     Order ID: ${p.order_id || 'NULL'}`)
    console.log(`     Customer: ${p.customer_id}`)
    console.log(`     Status: ${p.status}`)
    console.log(`     Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
    console.log(`     Created: ${p.created_at}`)
    console.log(`     Time diff: ${Math.abs(new Date(p.created_at) - orderCreatedAt) / (1000 * 60)} minutes`)
    
    if (!p.order_id) {
      console.log(`     ⚠️  UNLINKED - order_id is NULL`)
      console.log(`     💡 This payment might be for our order!`)
    } else {
      console.log(`     ⚠️  Linked to different order: ${p.order_id}`)
    }
  })
  
  // Check all payments for this customer on Dec 15
  console.log(`\n${'='.repeat(80)}`)
  console.log('All payments for this customer on Dec 15, 2025:\n')
  
  const dayStart = new Date('2025-12-15T00:00:00Z')
  const dayEnd = new Date('2025-12-16T00:00:00Z')
  
  const allCustomerPayments = await prisma.$queryRaw`
    SELECT 
      p.id,
      p.payment_id,
      p.order_id,
      p.status,
      p.total_money_amount,
      p.created_at,
      o2.order_id as linked_square_order_id
    FROM payments p
    LEFT JOIN orders o2 ON o2.id = p.order_id
    WHERE p.customer_id = ${o.customer_id}
      AND p.created_at >= ${dayStart}::timestamp
      AND p.created_at < ${dayEnd}::timestamp
    ORDER BY p.created_at DESC
  `
  
  console.log(`Found ${allCustomerPayments.length} payment(s) total`)
  allCustomerPayments.forEach((p, idx) => {
    console.log(`  ${idx + 1}. Payment: ${p.id}`)
    console.log(`     Square Payment ID: ${p.payment_id}`)
    console.log(`     Linked Order (Square): ${p.linked_square_order_id || 'NULL'}`)
    console.log(`     Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
    console.log(`     Created: ${p.created_at}`)
    if (p.linked_square_order_id === orderId) {
      console.log(`     ✅ LINKED TO OUR ORDER!`)
    } else if (!p.linked_square_order_id) {
      console.log(`     ⚠️  UNLINKED`)
    }
  })
  
  await prisma.$disconnect()
}

checkLinking().catch(console.error)



