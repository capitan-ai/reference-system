#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkStats() {
  const orders = await prisma.$queryRaw`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE booking_id IS NOT NULL) as with_booking,
      COUNT(*) FILTER (WHERE customer_id IS NOT NULL AND location_id IS NOT NULL) as with_customer_location
    FROM orders
    WHERE created_at >= '2025-01-01'::timestamp
      AND created_at <= '2025-12-31'::timestamp
  `
  
  const lineItems = await prisma.$queryRaw`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE booking_id IS NOT NULL) as with_booking,
      COUNT(*) FILTER (WHERE service_variation_id IS NOT NULL) as with_service
    FROM order_line_items
    WHERE order_created_at >= '2025-01-01'::timestamp
      AND order_created_at <= '2025-12-31'::timestamp
  `
  
  const payments = await prisma.$queryRaw`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE booking_id IS NOT NULL) as with_booking,
      COUNT(*) FILTER (WHERE order_id IS NOT NULL) as with_order
    FROM payments
    WHERE created_at >= '2025-01-01'::timestamp
      AND created_at <= '2025-12-31'::timestamp
  `
  
  const ordersWithoutLineItems = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT o.id) as count
    FROM orders o
    LEFT JOIN order_line_items oli ON oli.order_id = o.id
    WHERE o.created_at >= '2025-01-01'::timestamp
      AND o.created_at <= '2025-12-31'::timestamp
      AND oli.id IS NULL
  `
  
  console.log('📊 2025 Database Statistics\n')
  console.log('Orders:')
  console.log(`  Total: ${Number(orders[0].total)}`)
  console.log(`  With booking_id: ${Number(orders[0].with_booking)} (${((Number(orders[0].with_booking) / Number(orders[0].total)) * 100).toFixed(1)}%)`)
  console.log(`  With customer+location: ${Number(orders[0].with_customer_location)}`)
  console.log(`  Orders without line items: ${Number(ordersWithoutLineItems[0].count)}`)
  
  console.log('\nOrder Line Items:')
  console.log(`  Total: ${Number(lineItems[0].total)}`)
  console.log(`  With booking_id: ${Number(lineItems[0].with_booking)} (${((Number(lineItems[0].with_booking) / Number(lineItems[0].total)) * 100).toFixed(1)}%)`)
  console.log(`  With service_variation_id: ${Number(lineItems[0].with_service)}`)
  
  console.log('\nPayments:')
  console.log(`  Total: ${Number(payments[0].total)}`)
  console.log(`  With booking_id: ${Number(payments[0].with_booking)} (${((Number(payments[0].with_booking) / Number(payments[0].total)) * 100).toFixed(1)}%)`)
  console.log(`  With order_id: ${Number(payments[0].with_order)}`)
  
  await prisma.$disconnect()
}

checkStats().catch(console.error)

