#!/usr/bin/env node
/**
 * Check if orders table was actually updated with state field
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkOrdersTableUpdates() {
  console.log('🔍 Checking Orders Table Updates\n')
  console.log('='.repeat(60))

  try {
    // Check orders by state
    const ordersByState = await prisma.$queryRaw`
      SELECT 
        state,
        COUNT(*)::int as count,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM orders
      GROUP BY state
      ORDER BY state
    `

    console.log('\n📊 All Orders by State:')
    ordersByState.forEach(s => {
      console.log(`   ${s.state || 'NULL'}: ${s.count.toLocaleString()} orders`)
      console.log(`      Date range: ${s.earliest} to ${s.latest}`)
    })

    // Check orders from 2024 specifically (using order_line_items for actual dates)
    const orders2024 = await prisma.$queryRaw`
      SELECT 
        o.state,
        COUNT(DISTINCT o.id)::int as count
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2024-01-01'
        AND oli.order_created_at < '2025-01-01'
      GROUP BY o.state
      ORDER BY o.state
    `

    console.log('\n📊 2024 Orders by State (from order_line_items.order_created_at):')
    if (orders2024.length === 0) {
      console.log('   ⚠️  No orders found with line items from 2024')
    } else {
      orders2024.forEach(s => {
        console.log(`   ${s.state || 'NULL'}: ${s.count.toLocaleString()} orders`)
      })
    }

    // Check for orders with NULL state that should have state
    const nullStateOrders = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as count,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM orders
      WHERE state IS NULL
    `

    console.log(`\n⚠️  Orders with NULL state: ${nullStateOrders[0].count.toLocaleString()}`)
    if (nullStateOrders[0].count > 0) {
      console.log(`   Date range: ${nullStateOrders[0].earliest} to ${nullStateOrders[0].latest}`)
    }

    // Check orders updated recently (last hour)
    const recentlyUpdated = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as count,
        COUNT(*) FILTER (WHERE state IS NOT NULL)::int as with_state,
        COUNT(*) FILTER (WHERE state IS NULL)::int as null_state
      FROM orders
      WHERE updated_at >= NOW() - INTERVAL '1 hour'
    `

    console.log(`\n🕐 Orders updated in last hour: ${recentlyUpdated[0].count.toLocaleString()}`)
    console.log(`   With state: ${recentlyUpdated[0].with_state.toLocaleString()}`)
    console.log(`   NULL state: ${recentlyUpdated[0].null_state.toLocaleString()}`)

    // Check sample orders to see their state
    const sampleOrders = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.state,
        o.created_at,
        o.updated_at,
        oli.order_created_at,
        oli.order_state
      FROM orders o
      LEFT JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2024-01-01'
        AND oli.order_created_at < '2025-01-01'
      ORDER BY o.updated_at DESC
      LIMIT 10
    `

    console.log('\n📋 Sample 2024 Orders (most recently updated):')
    sampleOrders.forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
      console.log(`      orders.state: ${order.state || 'NULL'}`)
      console.log(`      order_line_items.order_state: ${order.order_state || 'NULL'}`)
      console.log(`      orders.updated_at: ${order.updated_at}`)
      console.log(`      order_line_items.order_created_at: ${order.order_created_at}`)
    })

    // Check if there's a mismatch between orders.state and order_line_items.order_state
    const stateMismatch = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as count
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2024-01-01'
        AND oli.order_created_at < '2025-01-01'
        AND o.state IS DISTINCT FROM oli.order_state
    `

    console.log(`\n⚠️  Orders with state mismatch (orders.state != order_line_items.order_state): ${stateMismatch[0].count.toLocaleString()}`)

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Total orders with NULL state: ${nullStateOrders[0].count.toLocaleString()}`)
    console.log(`   Orders updated in last hour: ${recentlyUpdated[0].count.toLocaleString()}`)
    console.log(`   State mismatches: ${stateMismatch[0].count.toLocaleString()}`)

    if (nullStateOrders[0].count > 0) {
      console.log('\n⚠️  ISSUE: Some orders still have NULL state!')
      console.log('   The ON CONFLICT clause may not be updating state correctly.')
    } else {
      console.log('\n✅ All orders have state values!')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkOrdersTableUpdates()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



