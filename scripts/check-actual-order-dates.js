#!/usr/bin/env node
/**
 * Check actual order creation dates from order_line_items.order_created_at
 * instead of orders.created_at (which reflects backfill date)
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkActualOrderDates() {
  console.log('🔍 Checking Actual Order Creation Dates (from order_line_items)\n')
  console.log('='.repeat(60))

  try {
    // Get overall statistics based on actual order creation dates
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id)::int as total_orders,
        MIN(oli.order_created_at) as earliest_order,
        MAX(oli.order_created_at) as latest_order
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at IS NOT NULL
    `

    console.log('\n📊 Overall Statistics (based on actual order creation dates):')
    console.log(`   Total orders with line items: ${stats[0].total_orders}`)
    console.log(`   Earliest order: ${stats[0].earliest_order}`)
    console.log(`   Latest order: ${stats[0].latest_order}`)

    // Get orders by year based on actual creation date
    const byYear = await prisma.$queryRaw`
      SELECT 
        EXTRACT(YEAR FROM oli.order_created_at)::int as year,
        COUNT(DISTINCT o.id)::int as count,
        MIN(oli.order_created_at) as earliest,
        MAX(oli.order_created_at) as latest
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM oli.order_created_at)
      ORDER BY year
    `

    console.log('\n📅 Orders by year (based on actual order_created_at):')
    byYear.forEach(y => {
      console.log(`   ${y.year}: ${y.count} orders`)
      console.log(`      Earliest: ${y.earliest}`)
      console.log(`      Latest: ${y.latest}`)
    })

    // Check for orders from 2023-2024
    const orders2023_2024 = await prisma.$queryRaw`
      SELECT DISTINCT
        o.order_id,
        o.state,
        oli.order_created_at,
        oli.order_state,
        oli.order_closed_at
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2023-01-01'
        AND oli.order_created_at < '2025-01-01'
      ORDER BY oli.order_created_at ASC
      LIMIT 20
    `

    console.log(`\n📋 Orders from 2023-2024 (first 20): ${orders2023_2024.length}`)
    if (orders2023_2024.length > 0) {
      orders2023_2024.forEach((order, idx) => {
        console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
        console.log(`      Actual Created: ${order.order_created_at}`)
        console.log(`      State: ${order.order_state || order.state || 'NULL'}`)
        console.log(`      Closed: ${order.order_closed_at || 'NULL'}`)
      })
    }

    // Count cancelled orders from 2023-2024
    const cancelled2023_2024 = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT o.id)::int as count
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2023-01-01'
        AND oli.order_created_at < '2025-01-01'
        AND (oli.order_state = 'CANCELED' OR o.state = 'CANCELED')
    `

    console.log(`\n❌ Cancelled orders from 2023-2024: ${cancelled2023_2024[0].count}`)

    // Get cancelled orders by year
    const cancelledByYear = await prisma.$queryRaw`
      SELECT 
        EXTRACT(YEAR FROM oli.order_created_at)::int as year,
        COUNT(DISTINCT o.id)::int as count
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE (oli.order_state = 'CANCELED' OR o.state = 'CANCELED')
        AND oli.order_created_at IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM oli.order_created_at)
      ORDER BY year
    `

    console.log('\n❌ Cancelled orders by year (based on actual order_created_at):')
    cancelledByYear.forEach(y => {
      console.log(`   ${y.year}: ${y.count} orders`)
    })

    // Check orders without line items (these won't have order_created_at)
    const ordersWithoutLineItems = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders o
      LEFT JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.id IS NULL
    `

    console.log(`\n⚠️  Orders without line items: ${ordersWithoutLineItems[0].count}`)
    console.log(`   (These orders don't have order_created_at, so we can't determine their actual creation date)`)

    // Compare database created_at vs actual order_created_at for recent orders
    const comparison = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.created_at as db_created_at,
        oli.order_created_at as actual_order_created_at,
        o.state,
        oli.order_state
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at IS NOT NULL
      ORDER BY oli.order_created_at DESC
      LIMIT 10
    `

    console.log('\n📊 Comparison: DB created_at vs Actual order_created_at (most recent 10):')
    comparison.forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
      console.log(`      DB created_at: ${order.db_created_at}`)
      console.log(`      Actual order_created_at: ${order.actual_order_created_at}`)
      console.log(`      State: ${order.order_state || order.state || 'NULL'}`)
    })

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkActualOrderDates()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



