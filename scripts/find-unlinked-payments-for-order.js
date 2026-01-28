#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function findUnlinkedPayments() {
  const orderId = 'P1c1WYwCzcpQQkLaHIiiDTQokLSZY'
  
  console.log('🔍 Finding Unlinked Payments for Order\n')
  console.log('='.repeat(80))
  console.log(`Order ID (Square): ${orderId}\n`)
  
  // Get order details
  const order = await prisma.$queryRaw`
    SELECT id, order_id, organization_id, customer_id, location_id, created_at
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
  console.log(`  Customer: ${o.customer_id}`)
  console.log(`  Created: ${o.created_at}`)
  
  // Get location UUID
  let locationUuid = null
  if (o.location_id && o.location_id.length < 36) {
    const loc = await prisma.$queryRaw`
      SELECT id FROM locations 
      WHERE square_location_id = ${o.location_id}
        AND organization_id = ${o.organization_id}::uuid
      LIMIT 1
    `
    if (loc && loc.length > 0) {
      locationUuid = loc[0].id
    }
  } else {
    locationUuid = o.location_id
  }
  
  // Find payments that might be for this order but aren't linked
  // Criteria: same customer, same location, around the same time, order_id is NULL or different
  const orderCreatedAt = new Date(o.created_at)
  const startWindow = new Date(orderCreatedAt.getTime() - 4 * 60 * 60 * 1000) // 4 hours before
  const endWindow = new Date(orderCreatedAt.getTime() + 4 * 60 * 60 * 1000) // 4 hours after
  
  console.log(`\n${'='.repeat(80)}`)
  console.log('Searching for unlinked payments...\n')
  console.log(`Time window: ${startWindow.toISOString()} to ${endWindow.toISOString()}\n`)
  
  let unlinkedPayments = []
  if (locationUuid) {
    unlinkedPayments = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.payment_id,
        p.order_id,
        p.customer_id,
        p.location_id,
        p.status,
        p.total_money_amount,
        p.created_at,
        o2.order_id as linked_square_order_id
      FROM payments p
      LEFT JOIN orders o2 ON o2.id = p.order_id
      WHERE p.customer_id = ${o.customer_id}
        AND p.location_id = ${locationUuid}::uuid
        AND p.created_at >= ${startWindow}::timestamp
        AND p.created_at <= ${endWindow}::timestamp
        AND (p.order_id IS NULL OR p.order_id != ${o.id}::uuid)
      ORDER BY p.created_at DESC
      LIMIT 10
    `
  }
  
  console.log(`Found ${unlinkedPayments.length} potentially unlinked payment(s)\n`)
  
  unlinkedPayments.forEach((p, idx) => {
    console.log(`  ${idx + 1}. Payment: ${p.id}`)
    console.log(`     Square Payment ID: ${p.payment_id}`)
    console.log(`     Current Order ID: ${p.order_id || 'NULL'}`)
    console.log(`     Linked Square Order: ${p.linked_square_order_id || 'NULL'}`)
    console.log(`     Status: ${p.status}`)
    console.log(`     Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
    console.log(`     Created: ${p.created_at}`)
    console.log(`     Time diff: ${Math.abs(new Date(p.created_at) - orderCreatedAt) / (1000 * 60)} minutes`)
    
    if (!p.order_id) {
      console.log(`     ⚠️  UNLINKED - order_id is NULL`)
      console.log(`     💡 This payment might be for our order!`)
      console.log(`     💡 We can update it: UPDATE payments SET order_id = '${o.id}' WHERE id = '${p.id}'`)
    } else {
      console.log(`     ⚠️  Linked to different order: ${p.linked_square_order_id}`)
    }
    console.log()
  })
  
  // Also check payments with NULL order_id for this customer on this day
  console.log(`${'='.repeat(80)}`)
  console.log('All payments with NULL order_id for this customer on Dec 15, 2025:\n')
  
  const dayStart = new Date('2025-12-15T00:00:00Z')
  const dayEnd = new Date('2025-12-16T00:00:00Z')
  
  const nullOrderPayments = await prisma.$queryRaw`
    SELECT 
      p.id,
      p.payment_id,
      p.status,
      p.total_money_amount,
      p.created_at
    FROM payments p
    WHERE p.customer_id = ${o.customer_id}
      AND p.order_id IS NULL
      AND p.created_at >= ${dayStart}::timestamp
      AND p.created_at < ${dayEnd}::timestamp
    ORDER BY p.created_at DESC
    LIMIT 10
  `
  
  console.log(`Found ${nullOrderPayments.length} payment(s) with NULL order_id`)
  nullOrderPayments.forEach((p, idx) => {
    console.log(`  ${idx + 1}. Payment: ${p.id}`)
    console.log(`     Square Payment ID: ${p.payment_id}`)
    console.log(`     Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
    console.log(`     Created: ${p.created_at}`)
    console.log(`     Time diff from order: ${Math.abs(new Date(p.created_at) - orderCreatedAt) / (1000 * 60)} minutes`)
  })
  
  await prisma.$disconnect()
}

findUnlinkedPayments().catch(console.error)



