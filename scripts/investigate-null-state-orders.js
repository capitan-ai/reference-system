#!/usr/bin/env node
/**
 * Investigate orders with NULL state - check their actual dates and origin
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function investigateNullStateOrders() {
  console.log('🔍 Investigating NULL State Orders\n')
  console.log('='.repeat(60))

  try {
    // Check NULL state orders - what dates do they actually have?
    const nullStateOrders = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        MIN(created_at) as earliest_created_at,
        MAX(created_at) as latest_created_at,
        MIN(updated_at) as earliest_updated_at,
        MAX(updated_at) as latest_updated_at
      FROM orders
      WHERE state IS NULL
    `

    console.log('\n📊 NULL State Orders Summary:')
    console.log(`   Total: ${nullStateOrders[0].total.toLocaleString()}`)
    console.log(`   Created at range: ${nullStateOrders[0].earliest_created_at} to ${nullStateOrders[0].latest_created_at}`)
    console.log(`   Updated at range: ${nullStateOrders[0].earliest_updated_at} to ${nullStateOrders[0].latest_updated_at}`)

    // Check if they have raw_json with actual order dates
    const withRawJson = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE raw_json IS NOT NULL)::int as with_raw_json
      FROM orders
      WHERE state IS NULL
    `

    console.log(`\n   With raw_json: ${withRawJson[0].with_raw_json.toLocaleString()} / ${withRawJson[0].total.toLocaleString()}`)

    // Sample some orders to see their raw_json
    const sampleOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        created_at,
        updated_at,
        raw_json->>'createdAt' as square_created_at,
        raw_json->>'state' as square_state,
        raw_json->>'locationId' as square_location_id
      FROM orders
      WHERE state IS NULL
        AND raw_json IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 10
    `

    console.log('\n📋 Sample NULL State Orders (with raw_json):')
    sampleOrders.forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.order_id}`)
      console.log(`      DB created_at: ${order.created_at}`)
      console.log(`      DB updated_at: ${order.updated_at}`)
      console.log(`      Square createdAt: ${order.square_created_at || 'N/A'}`)
      console.log(`      Square state: ${order.square_state || 'N/A'}`)
      console.log(`      Square locationId: ${order.square_location_id || 'N/A'}`)
    })

    // Check if these orders have line items with order_created_at
    const withLineItems = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id)::int as orders_with_line_items,
        MIN(oli.order_created_at) as earliest_order_created_at,
        MAX(oli.order_created_at) as latest_order_created_at
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.state IS NULL
    `

    console.log(`\n   Orders with line items: ${withLineItems[0].orders_with_line_items.toLocaleString()}`)
    if (withLineItems[0].orders_with_line_items > 0) {
      console.log(`   Line items order_created_at range: ${withLineItems[0].earliest_order_created_at} to ${withLineItems[0].latest_order_created_at}`)
    }

    // Check distribution by created_at date
    const byDate = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*)::int as count
      FROM orders
      WHERE state IS NULL
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 10
    `

    console.log('\n📅 NULL State Orders by Date (DB created_at):')
    byDate.forEach(d => {
      console.log(`   ${d.date}: ${d.count.toLocaleString()} orders`)
    })

    // Check if these are from a specific backfill batch
    const byHour = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*)::int as count
      FROM orders
      WHERE state IS NULL
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY hour DESC
      LIMIT 5
    `

    console.log('\n🕐 NULL State Orders by Hour (DB created_at):')
    byHour.forEach(h => {
      console.log(`   ${h.hour}: ${h.count.toLocaleString()} orders`)
    })

    // Check organization distribution
    const byOrg = await prisma.$queryRaw`
      SELECT 
        organization_id,
        COUNT(*)::int as count
      FROM orders
      WHERE state IS NULL
      GROUP BY organization_id
      ORDER BY count DESC
    `

    console.log('\n🏢 NULL State Orders by Organization:')
    byOrg.forEach(org => {
      console.log(`   ${org.organization_id.substring(0, 8)}...: ${org.count.toLocaleString()} orders`)
    })

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

investigateNullStateOrders()
  .then(() => {
    console.log('\n✅ Investigation complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Investigation failed:', error)
    process.exit(1)
  })



