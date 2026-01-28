#!/usr/bin/env node
/**
 * Verify where the backfilled orders were saved
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function verifyBackfilledOrders() {
  console.log('🔍 Verifying Where Backfilled Orders Were Saved\n')
  console.log('='.repeat(60))

  try {
    // Check orders table for 2023-2024
    const orders2023_2024 = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_orders,
        COUNT(*) FILTER (WHERE state = 'COMPLETED')::int as completed,
        COUNT(*) FILTER (WHERE state = 'CANCELED')::int as canceled,
        COUNT(*) FILTER (WHERE state = 'OPEN')::int as open,
        COUNT(*) FILTER (WHERE state IS NULL)::int as null_state,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM orders
      WHERE id IN (
        SELECT DISTINCT o.id
        FROM orders o
        INNER JOIN order_line_items oli ON o.id = oli.order_id
        WHERE oli.order_created_at >= '2023-01-01'
          AND oli.order_created_at < '2025-01-01'
      )
    `

    console.log('\n📊 Orders Table (2023-2024):')
    console.log(`   Table: orders`)
    console.log(`   Total orders: ${orders2023_2024[0].total_orders.toLocaleString()}`)
    console.log(`   COMPLETED: ${orders2023_2024[0].completed.toLocaleString()}`)
    console.log(`   CANCELED: ${orders2023_2024[0].canceled.toLocaleString()}`)
    console.log(`   OPEN: ${orders2023_2024[0].open.toLocaleString()}`)
    console.log(`   NULL state: ${orders2023_2024[0].null_state.toLocaleString()}`)
    console.log(`   Date range: ${orders2023_2024[0].earliest} to ${orders2023_2024[0].latest}`)

    // Check order_line_items table
    const lineItems2023_2024 = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_line_items,
        COUNT(DISTINCT order_id)::int as unique_orders,
        COUNT(*) FILTER (WHERE order_state = 'COMPLETED')::int as completed,
        COUNT(*) FILTER (WHERE order_state = 'CANCELED')::int as canceled,
        COUNT(*) FILTER (WHERE order_state = 'OPEN')::int as open,
        MIN(order_created_at) as earliest,
        MAX(order_created_at) as latest
      FROM order_line_items
      WHERE order_created_at >= '2023-01-01'
        AND order_created_at < '2025-01-01'
    `

    console.log('\n📊 Order Line Items Table (2023-2024):')
    console.log(`   Table: order_line_items`)
    console.log(`   Total line items: ${lineItems2023_2024[0].total_line_items.toLocaleString()}`)
    console.log(`   Unique orders: ${lineItems2023_2024[0].unique_orders.toLocaleString()}`)
    console.log(`   COMPLETED: ${lineItems2023_2024[0].completed.toLocaleString()}`)
    console.log(`   CANCELED: ${lineItems2023_2024[0].canceled.toLocaleString()}`)
    console.log(`   OPEN: ${lineItems2023_2024[0].open.toLocaleString()}`)
    console.log(`   Date range: ${lineItems2023_2024[0].earliest} to ${lineItems2023_2024[0].latest}`)

    // Check specifically for 2024 cancelled orders
    const cancelled2024 = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id)::int as total_cancelled_orders,
        COUNT(oli.id)::int as total_line_items
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2024-01-01'
        AND oli.order_created_at < '2025-01-01'
        AND (o.state = 'CANCELED' OR oli.order_state = 'CANCELED')
    `

    console.log('\n❌ Cancelled Orders (2024):')
    console.log(`   Total cancelled orders: ${cancelled2024[0].total_cancelled_orders.toLocaleString()}`)
    console.log(`   Total line items: ${cancelled2024[0].total_line_items.toLocaleString()}`)

    // Show sample orders
    const sampleOrders = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.state,
        o.location_id,
        o.created_at,
        COUNT(oli.id)::int as line_item_count
      FROM orders o
      LEFT JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.id IN (
        SELECT DISTINCT o2.id
        FROM orders o2
        INNER JOIN order_line_items oli2 ON o2.id = oli2.order_id
        WHERE oli2.order_created_at >= '2024-01-01'
          AND oli2.order_created_at < '2025-01-01'
      )
      GROUP BY o.order_id, o.state, o.location_id, o.created_at
      ORDER BY o.created_at DESC
      LIMIT 5
    `

    console.log('\n📋 Sample Orders (most recent 5):')
    sampleOrders.forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
      console.log(`      State: ${order.state || 'NULL'}`)
      console.log(`      Location: ${order.location_id || 'NULL'}`)
      console.log(`      Created: ${order.created_at}`)
      console.log(`      Line items: ${order.line_item_count}`)
    })

    // Database connection info
    const dbInfo = await prisma.$queryRaw`
      SELECT current_database() as database_name
    `

    console.log('\n' + '='.repeat(60))
    console.log('\n💾 DATABASE INFORMATION:\n')
    console.log(`   Database: ${dbInfo[0].database_name}`)
    console.log(`   Tables used:`)
    console.log(`      - orders (main orders table)`)
    console.log(`      - order_line_items (line items with order-level context)`)
    console.log(`\n   Key fields:`)
    console.log(`      - orders.order_id: Square order ID (external identifier)`)
    console.log(`      - orders.state: Order state (COMPLETED, CANCELED, OPEN)`)
    console.log(`      - order_line_items.order_created_at: Actual order creation date from Square`)
    console.log(`      - order_line_items.order_state: Order state stored per line item`)

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

verifyBackfilledOrders()
  .then(() => {
    console.log('\n✅ Verification complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Verification failed:', error)
    process.exit(1)
  })



