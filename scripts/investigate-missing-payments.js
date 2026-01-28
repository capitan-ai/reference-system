#!/usr/bin/env node
/**
 * Investigate why order P1c1WYwCzcpQQkLaHIiiDTQokLSZY has no payments
 * Check if payments exist but aren't linked, or if they're missing entirely
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function investigate() {
  const orderId = 'P1c1WYwCzcpQQkLaHIiiDTQokLSZY'
  
  console.log('🔍 Investigating Missing Payments for Order\n')
  console.log('='.repeat(80))
  console.log(`Order ID (Square): ${orderId}\n`)
  
  // Get order details
  const order = await prisma.$queryRaw`
    SELECT 
      o.id,
      o.order_id,
      o.organization_id,
      o.customer_id,
      o.location_id,
      o.booking_id,
      o.created_at,
      o.state
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
  console.log(`  Organization: ${o.organization_id}`)
  console.log(`  Customer: ${o.customer_id}`)
  console.log(`  Location: ${o.location_id}`)
  console.log(`  Created: ${o.created_at}`)
  console.log(`  State: ${o.state}`)
  
  // Check 1: Payments linked by order_id (UUID)
  console.log(`\n${'='.repeat(80)}`)
  console.log('Check 1: Payments linked by order_id (UUID)\n')
  const paymentsByUuid = await prisma.$queryRaw`
    SELECT 
      p.id,
      p.payment_id as square_payment_id,
      p.order_id,
      p.customer_id,
      p.location_id,
      p.status,
      p.total_money_amount,
      p.created_at
    FROM payments p
    WHERE p.order_id = ${o.id}::uuid
    ORDER BY p.created_at DESC
  `
  
  console.log(`Found ${paymentsByUuid.length} payment(s) linked by UUID`)
  paymentsByUuid.forEach((p, idx) => {
    console.log(`  ${idx + 1}. Payment: ${p.id}`)
    console.log(`     Square Payment ID: ${p.square_payment_id}`)
    console.log(`     Customer: ${p.customer_id}`)
    console.log(`     Status: ${p.status}`)
    console.log(`     Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
    console.log(`     Created: ${p.created_at}`)
  })
  
  // Check 2: Payments with same customer and location around the same time
  console.log(`\n${'='.repeat(80)}`)
  console.log('Check 2: Payments with same customer and location (time window)\n')
  
  // Get location UUID from square_location_id
  let locationUuid = null
  if (o.location_id && o.location_id.length < 36) {
    // It's a square_location_id, need to get UUID
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
  
  const orderCreatedAt = new Date(o.created_at)
  const startWindow = new Date(orderCreatedAt.getTime() - 2 * 60 * 60 * 1000) // 2 hours before
  const endWindow = new Date(orderCreatedAt.getTime() + 2 * 60 * 60 * 1000) // 2 hours after
  
  let paymentsByCustomerLocation = []
  if (locationUuid) {
    paymentsByCustomerLocation = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.payment_id as square_payment_id,
        p.order_id,
        p.customer_id,
        p.location_id,
        p.status,
        p.total_money_amount,
        p.created_at,
        o2.order_id as linked_order_id
      FROM payments p
      LEFT JOIN orders o2 ON o2.id = p.order_id
      WHERE p.customer_id = ${o.customer_id}
        AND p.location_id = ${locationUuid}::uuid
        AND p.created_at >= ${startWindow}::timestamp
        AND p.created_at <= ${endWindow}::timestamp
      ORDER BY p.created_at DESC
      LIMIT 10
    `
  }
  
  console.log(`Found ${paymentsByCustomerLocation.length} payment(s) with same customer+location in time window`)
  console.log(`Time window: ${startWindow.toISOString()} to ${endWindow.toISOString()}\n`)
  
  paymentsByCustomerLocation.forEach((p, idx) => {
    console.log(`  ${idx + 1}. Payment: ${p.id}`)
    console.log(`     Square Payment ID: ${p.square_payment_id}`)
    console.log(`     Linked Order: ${p.linked_order_id || 'NULL'}`)
    console.log(`     Status: ${p.status}`)
    console.log(`     Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
    console.log(`     Created: ${p.created_at}`)
    if (!p.linked_order_id) {
      console.log(`     ⚠️  UNLINKED PAYMENT!`)
    }
  })
  
  // Check 3: Payments with same customer on the same day
  console.log(`\n${'='.repeat(80)}`)
  console.log('Check 3: All payments for this customer on Dec 15, 2025\n')
  
  const dayStart = new Date('2025-12-15T00:00:00Z')
  const dayEnd = new Date('2025-12-16T00:00:00Z')
  
  const paymentsSameDay = await prisma.$queryRaw`
    SELECT 
      p.id,
      p.payment_id as square_payment_id,
      p.order_id,
      p.status,
      p.total_money_amount,
      p.created_at,
      o2.order_id as linked_order_id
    FROM payments p
    LEFT JOIN orders o2 ON o2.id = p.order_id
    WHERE p.customer_id = ${o.customer_id}
      AND p.created_at >= ${dayStart}::timestamp
      AND p.created_at < ${dayEnd}::timestamp
    ORDER BY p.created_at DESC
  `
  
  console.log(`Found ${paymentsSameDay.length} payment(s) for this customer on Dec 15, 2025`)
  paymentsSameDay.forEach((p, idx) => {
    console.log(`  ${idx + 1}. Payment: ${p.id}`)
    console.log(`     Square Payment ID: ${p.square_payment_id}`)
    console.log(`     Linked Order: ${p.linked_order_id || 'NULL'}`)
    console.log(`     Status: ${p.status}`)
    console.log(`     Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
    console.log(`     Created: ${p.created_at}`)
    if (!p.linked_order_id) {
      console.log(`     ⚠️  UNLINKED PAYMENT!`)
    }
  })
  
  // Check 4: Check if order_id in payments table might be stored as Square order_id instead of UUID
  console.log(`\n${'='.repeat(80)}`)
  console.log('Check 4: Payments with order_id matching Square order_id (text search)\n')
  
  // This won't work directly, but let's check payment raw_json if it exists
  const paymentsWithOrderId = await prisma.$queryRaw`
    SELECT 
      p.id,
      p.payment_id as square_payment_id,
      p.order_id,
      p.status,
      p.total_money_amount,
      p.created_at
    FROM payments p
    WHERE p.created_at >= ${dayStart}::timestamp
      AND p.created_at < ${dayEnd}::timestamp
      AND p.customer_id = ${o.customer_id}
    ORDER BY p.created_at DESC
    LIMIT 10
  `
  
  console.log(`Found ${paymentsWithOrderId.length} payment(s) to check`)
  console.log(`Note: We can't directly search payment raw_json for order_id, but these payments exist\n`)
  
  // Summary
  console.log(`${'='.repeat(80)}`)
  console.log('📊 SUMMARY\n')
  console.log(`Payments linked by UUID: ${paymentsByUuid.length}`)
  console.log(`Payments same customer+location+time: ${paymentsByCustomerLocation.length}`)
  console.log(`Payments same customer same day: ${paymentsSameDay.length}`)
  
  if (paymentsByCustomerLocation.length > 0 && paymentsByUuid.length === 0) {
    console.log(`\n⚠️  ISSUE FOUND: Payments exist but aren't linked to this order!`)
    console.log(`   Possible causes:`)
    console.log(`   1. Payment webhook arrived before order webhook`)
    console.log(`   2. Payment has wrong order_id (Square order_id instead of UUID)`)
    console.log(`   3. Payment order_id is NULL`)
  } else if (paymentsSameDay.length === 0) {
    console.log(`\n⚠️  ISSUE FOUND: No payments found for this customer on this day!`)
    console.log(`   Possible causes:`)
    console.log(`   1. Payments not saved to database`)
    console.log(`   2. Payment webhooks not being processed`)
    console.log(`   3. Payments have different customer_id`)
  }
  
  await prisma.$disconnect()
}

investigate().catch(console.error)

