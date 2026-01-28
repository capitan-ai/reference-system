#!/usr/bin/env node
/**
 * Check for historic cancelled orders from 2023 onwards
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkHistoricCancelledOrders() {
  console.log('🔍 Checking for Historic Cancelled Orders (2023 onwards)\n')
  console.log('='.repeat(60))

  try {
    // Check cancelled orders from 2023 onwards
    const cancelledOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        state,
        location_id,
        customer_id,
        created_at,
        updated_at,
        version
      FROM orders
      WHERE state = 'CANCELED'
        AND created_at >= '2023-01-01'
      ORDER BY created_at ASC
    `

    console.log(`\n📊 Total cancelled orders from 2023: ${cancelledOrders.length}\n`)

    if (cancelledOrders.length === 0) {
      console.log('❌ No cancelled orders found from 2023 onwards')
      return
    }

    // Group by year
    const byYear = await prisma.$queryRaw`
      SELECT 
        EXTRACT(YEAR FROM created_at)::int as year,
        COUNT(*)::int as count,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM orders
      WHERE state = 'CANCELED'
        AND created_at >= '2023-01-01'
      GROUP BY EXTRACT(YEAR FROM created_at)
      ORDER BY year
    `

    console.log('📅 Cancelled orders by year:')
    byYear.forEach(y => {
      console.log(`   ${y.year}: ${y.count} orders`)
      console.log(`      Earliest: ${y.earliest}`)
      console.log(`      Latest: ${y.latest}`)
    })

    // Group by month for 2023
    const byMonth2023 = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*)::int as count
      FROM orders
      WHERE state = 'CANCELED'
        AND created_at >= '2023-01-01'
        AND created_at < '2024-01-01'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `

    if (byMonth2023.length > 0) {
      console.log('\n📅 Cancelled orders by month in 2023:')
      byMonth2023.forEach(m => {
        console.log(`   ${m.month.toISOString().substring(0, 7)}: ${m.count} orders`)
      })
    }

    // Group by month for 2024
    const byMonth2024 = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*)::int as count
      FROM orders
      WHERE state = 'CANCELED'
        AND created_at >= '2024-01-01'
        AND created_at < '2025-01-01'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `

    if (byMonth2024.length > 0) {
      console.log('\n📅 Cancelled orders by month in 2024:')
      byMonth2024.forEach(m => {
        console.log(`   ${m.month.toISOString().substring(0, 7)}: ${m.count} orders`)
      })
    }

    // Group by month for 2025
    const byMonth2025 = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*)::int as count
      FROM orders
      WHERE state = 'CANCELED'
        AND created_at >= '2025-01-01'
        AND created_at < '2026-01-01'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `

    if (byMonth2025.length > 0) {
      console.log('\n📅 Cancelled orders by month in 2025:')
      byMonth2025.forEach(m => {
        console.log(`   ${m.month.toISOString().substring(0, 7)}: ${m.count} orders`)
      })
    }

    // Group by month for 2026
    const byMonth2026 = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*)::int as count
      FROM orders
      WHERE state = 'CANCELED'
        AND created_at >= '2026-01-01'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `

    if (byMonth2026.length > 0) {
      console.log('\n📅 Cancelled orders by month in 2026:')
      byMonth2026.forEach(m => {
        console.log(`   ${m.month.toISOString().substring(0, 7)}: ${m.count} orders`)
      })
    }

    // Check which cancelled orders have line items
    const withLineItems = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT o.id)::int as count
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.state = 'CANCELED'
        AND o.created_at >= '2023-01-01'
    `

    const withoutLineItems = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT o.id)::int as count
      FROM orders o
      LEFT JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.state = 'CANCELED'
        AND o.created_at >= '2023-01-01'
        AND oli.id IS NULL
    `

    console.log('\n📦 Line items status:')
    console.log(`   Cancelled orders with line items: ${withLineItems[0].count}`)
    console.log(`   Cancelled orders without line items: ${withoutLineItems[0].count}`)

    // Show sample cancelled orders
    console.log('\n📋 Sample cancelled orders (first 10):')
    cancelledOrders.slice(0, 10).forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
      console.log(`      Created: ${order.created_at}`)
      console.log(`      Updated: ${order.updated_at}`)
      console.log(`      Location: ${order.location_id || 'NULL'}`)
      console.log(`      Customer: ${order.customer_id || 'NULL'}`)
    })

    if (cancelledOrders.length > 10) {
      console.log(`\n   ... and ${cancelledOrders.length - 10} more`)
    }

    // Check oldest and newest cancelled orders
    const oldest = cancelledOrders[0]
    const newest = cancelledOrders[cancelledOrders.length - 1]
    
    console.log('\n📌 Date range:')
    console.log(`   Oldest cancelled order: ${oldest.created_at} (${oldest.order_id})`)
    console.log(`   Newest cancelled order: ${newest.created_at} (${newest.order_id})`)

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkHistoricCancelledOrders()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



