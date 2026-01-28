#!/usr/bin/env node
/**
 * Check the date range of all orders in the database
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkOrderDateRange() {
  console.log('🔍 Checking Order Date Range in Database\n')
  console.log('='.repeat(60))

  try {
    // Get overall statistics
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_orders,
        MIN(created_at) as earliest_order,
        MAX(created_at) as latest_order
      FROM orders
    `

    console.log('\n📊 Overall Statistics:')
    console.log(`   Total orders: ${stats[0].total_orders}`)
    console.log(`   Earliest order: ${stats[0].earliest_order}`)
    console.log(`   Latest order: ${stats[0].latest_order}`)

    // Get orders by year
    const byYear = await prisma.$queryRaw`
      SELECT 
        EXTRACT(YEAR FROM created_at)::int as year,
        COUNT(*)::int as count,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM orders
      GROUP BY EXTRACT(YEAR FROM created_at)
      ORDER BY year
    `

    console.log('\n📅 Orders by year:')
    byYear.forEach(y => {
      console.log(`   ${y.year}: ${y.count} orders`)
      console.log(`      Earliest: ${y.earliest}`)
      console.log(`      Latest: ${y.latest}`)
    })

    // Get first 10 orders chronologically
    const firstOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        state,
        created_at,
        updated_at
      FROM orders
      ORDER BY created_at ASC
      LIMIT 10
    `

    console.log('\n📋 First 10 orders (chronologically):')
    firstOrders.forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
      console.log(`      State: ${order.state || 'NULL'}`)
      console.log(`      Created: ${order.created_at}`)
      console.log(`      Updated: ${order.updated_at}`)
    })

    // Check for orders by state
    const byState = await prisma.$queryRaw`
      SELECT 
        state,
        COUNT(*)::int as count,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM orders
      GROUP BY state
      ORDER BY state
    `

    console.log('\n📊 Orders by state:')
    byState.forEach(s => {
      console.log(`   ${s.state || 'NULL'}: ${s.count} orders`)
      console.log(`      Earliest: ${s.earliest}`)
      console.log(`      Latest: ${s.latest}`)
    })

    // Check if there are any orders with created_at before 2023
    const before2023 = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders
      WHERE created_at < '2023-01-01'
    `

    console.log(`\n📅 Orders before 2023: ${before2023[0].count}`)

    // Check if there are any orders with created_at in 2023-2024
    const in2023_2024 = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders
      WHERE created_at >= '2023-01-01'
        AND created_at < '2025-01-01'
    `

    console.log(`📅 Orders in 2023-2024: ${in2023_2024[0].count}`)

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkOrderDateRange()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



