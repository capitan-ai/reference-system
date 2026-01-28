#!/usr/bin/env node
/**
 * Check for orders from 2023-2024 that might be cancelled but not marked as such
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function check2023_2024Orders() {
  console.log('🔍 Checking Orders from 2023-2024 for Cancelled Status\n')
  console.log('='.repeat(60))

  try {
    // Get all orders from 2023-2024
    const allOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        state,
        location_id,
        customer_id,
        created_at,
        updated_at,
        version
      FROM orders
      WHERE created_at >= '2023-01-01'
        AND created_at < '2025-01-01'
      ORDER BY created_at ASC
    `

    console.log(`\n📊 Total orders from 2023-2024: ${allOrders.length}\n`)

    if (allOrders.length === 0) {
      console.log('❌ No orders found from 2023-2024')
      return
    }

    // Group by state
    const byState = await prisma.$queryRaw`
      SELECT 
        state,
        COUNT(*)::int as count,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM orders
      WHERE created_at >= '2023-01-01'
        AND created_at < '2025-01-01'
      GROUP BY state
      ORDER BY state
    `

    console.log('📊 Orders by state:')
    byState.forEach(s => {
      console.log(`   ${s.state || 'NULL'}: ${s.count} orders`)
      console.log(`      Earliest: ${s.earliest}`)
      console.log(`      Latest: ${s.latest}`)
    })

    // Check for orders with order_closed_at in line items but state is not CANCELED
    const closedButNotCancelled = await prisma.$queryRaw`
      SELECT DISTINCT
        o.order_id,
        o.state,
        o.location_id,
        o.customer_id,
        o.created_at,
        o.updated_at,
        o.version,
        MAX(oli.order_closed_at) as order_closed_at
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.created_at >= '2023-01-01'
        AND o.created_at < '2025-01-01'
        AND oli.order_closed_at IS NOT NULL
        AND o.state != 'CANCELED'
      GROUP BY o.order_id, o.state, o.location_id, o.customer_id, o.created_at, o.updated_at, o.version
      ORDER BY o.created_at ASC
    `

    console.log(`\n⚠️  Orders with order_closed_at but state != CANCELED: ${closedButNotCancelled.length}`)
    if (closedButNotCancelled.length > 0) {
      console.log('\n   These might be cancelled but not marked:')
      closedButNotCancelled.slice(0, 20).forEach((order, idx) => {
        console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
        console.log(`      State: ${order.state}`)
        console.log(`      Created: ${order.created_at}`)
        console.log(`      Closed: ${order.order_closed_at}`)
        console.log(`      Location: ${order.location_id || 'NULL'}`)
      })
      if (closedButNotCancelled.length > 20) {
        console.log(`\n   ... and ${closedButNotCancelled.length - 20} more`)
      }
    }

    // Check for orders with state = COMPLETED but order_closed_at is NULL in line items
    const completedWithoutClosed = await prisma.$queryRaw`
      SELECT DISTINCT
        o.order_id,
        o.state,
        o.location_id,
        o.customer_id,
        o.created_at,
        o.updated_at,
        o.version
      FROM orders o
      LEFT JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.created_at >= '2023-01-01'
        AND o.created_at < '2025-01-01'
        AND o.state = 'COMPLETED'
        AND (oli.order_closed_at IS NULL OR oli.id IS NULL)
      ORDER BY o.created_at ASC
    `

    console.log(`\n📋 Orders with state=COMPLETED but order_closed_at=NULL: ${completedWithoutClosed.length}`)
    if (completedWithoutClosed.length > 0 && completedWithoutClosed.length <= 20) {
      completedWithoutClosed.forEach((order, idx) => {
        console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
        console.log(`      Created: ${order.created_at}`)
        console.log(`      Updated: ${order.updated_at}`)
      })
    }

    // Check for orders with state = OPEN but created more than 30 days ago
    const oldOpenOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        state,
        location_id,
        customer_id,
        created_at,
        updated_at,
        version
      FROM orders
      WHERE created_at >= '2023-01-01'
        AND created_at < '2025-01-01'
        AND state = 'OPEN'
        AND created_at < NOW() - INTERVAL '30 days'
      ORDER BY created_at ASC
    `

    console.log(`\n⏰ Old OPEN orders (created >30 days ago): ${oldOpenOrders.length}`)
    if (oldOpenOrders.length > 0 && oldOpenOrders.length <= 20) {
      oldOpenOrders.forEach((order, idx) => {
        console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
        console.log(`      Created: ${order.created_at}`)
        console.log(`      Updated: ${order.updated_at}`)
      })
    }

    // Check by year
    const byYear = await prisma.$queryRaw`
      SELECT 
        EXTRACT(YEAR FROM created_at)::int as year,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE state = 'CANCELED')::int as cancelled,
        COUNT(*) FILTER (WHERE state = 'COMPLETED')::int as completed,
        COUNT(*) FILTER (WHERE state = 'OPEN')::int as open,
        COUNT(*) FILTER (WHERE state IS NULL)::int as null_state
      FROM orders
      WHERE created_at >= '2023-01-01'
        AND created_at < '2025-01-01'
      GROUP BY EXTRACT(YEAR FROM created_at)
      ORDER BY year
    `

    console.log('\n📅 Orders by year (2023-2024):')
    byYear.forEach(y => {
      console.log(`\n   ${y.year}:`)
      console.log(`      Total: ${y.total}`)
      console.log(`      Cancelled: ${y.cancelled}`)
      console.log(`      Completed: ${y.completed}`)
      console.log(`      Open: ${y.open}`)
      console.log(`      NULL state: ${y.null_state}`)
    })

    // Check for orders with no line items (might indicate cancelled/test orders)
    const ordersWithoutLineItems = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.state,
        o.created_at,
        o.updated_at
      FROM orders o
      LEFT JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.created_at >= '2023-01-01'
        AND o.created_at < '2025-01-01'
        AND oli.id IS NULL
      ORDER BY o.created_at ASC
      LIMIT 50
    `

    console.log(`\n📦 Orders without line items (first 50): ${ordersWithoutLineItems.length}`)
    if (ordersWithoutLineItems.length > 0) {
      const byStateNoItems = {}
      ordersWithoutLineItems.forEach(order => {
        const state = order.state || 'NULL'
        byStateNoItems[state] = (byStateNoItems[state] || 0) + 1
      })
      console.log('   Breakdown by state:')
      Object.entries(byStateNoItems).forEach(([state, count]) => {
        console.log(`      ${state}: ${count}`)
      })
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 SUMMARY:')
    console.log(`   Total orders 2023-2024: ${allOrders.length}`)
    console.log(`   Cancelled orders: ${byState.find(s => s.state === 'CANCELED')?.count || 0}`)
    console.log(`   Orders with closed_at but not CANCELED: ${closedButNotCancelled.length}`)
    console.log(`   Old OPEN orders (>30 days): ${oldOpenOrders.length}`)
    console.log(`   Orders without line items: ${ordersWithoutLineItems.length}`)

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

check2023_2024Orders()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })

