#!/usr/bin/env node
/**
 * Check exactly how many 2025 orders were updated/inserted in the database
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function check2025BackfillResults() {
  console.log('🔍 Checking 2025 Backfill Results\n')
  console.log('='.repeat(60))

  try {
    // Check total 2025 orders in database (using order_line_items.order_created_at)
    const total2025 = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id)::int as total_orders,
        COUNT(DISTINCT o.id) FILTER (WHERE o.state = 'COMPLETED')::int as completed,
        COUNT(DISTINCT o.id) FILTER (WHERE o.state = 'CANCELED')::int as canceled,
        COUNT(DISTINCT o.id) FILTER (WHERE o.state = 'OPEN')::int as open,
        COUNT(DISTINCT o.id) FILTER (WHERE o.state IS NULL)::int as null_state
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
    `

    console.log('\n📊 2025 Orders in Database (from order_line_items.order_created_at):')
    console.log(`   Total orders: ${total2025[0].total_orders.toLocaleString()}`)
    console.log(`   COMPLETED: ${total2025[0].completed.toLocaleString()}`)
    console.log(`   CANCELED: ${total2025[0].canceled.toLocaleString()}`)
    console.log(`   OPEN: ${total2025[0].open.toLocaleString()}`)
    console.log(`   NULL state: ${total2025[0].null_state.toLocaleString()}`)

    // Check orders updated in the last hour (from backfill)
    const recentlyUpdated = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE o.state = 'COMPLETED')::int as completed,
        COUNT(*) FILTER (WHERE o.state = 'CANCELED')::int as canceled,
        COUNT(*) FILTER (WHERE o.state = 'OPEN')::int as open,
        MIN(o.updated_at) as earliest_update,
        MAX(o.updated_at) as latest_update
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
        AND o.updated_at >= NOW() - INTERVAL '10 minutes'
    `

    console.log(`\n🕐 Orders updated in last 10 minutes (from backfill):`)
    console.log(`   Total: ${recentlyUpdated[0].total.toLocaleString()}`)
    console.log(`   COMPLETED: ${recentlyUpdated[0].completed.toLocaleString()}`)
    console.log(`   CANCELED: ${recentlyUpdated[0].canceled.toLocaleString()}`)
    console.log(`   OPEN: ${recentlyUpdated[0].open.toLocaleString()}`)
    console.log(`   Update time range: ${recentlyUpdated[0].earliest_update} to ${recentlyUpdated[0].latest_update}`)

    // Check how many were newly inserted vs updated
    // We can estimate by checking orders that were created recently vs updated recently
    const newVsUpdated = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE o.created_at >= NOW() - INTERVAL '10 minutes')::int as newly_inserted,
        COUNT(*) FILTER (WHERE o.created_at < NOW() - INTERVAL '10 minutes' AND o.updated_at >= NOW() - INTERVAL '10 minutes')::int as updated_existing,
        COUNT(*)::int as total_processed
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
        AND (o.created_at >= NOW() - INTERVAL '10 minutes' OR o.updated_at >= NOW() - INTERVAL '10 minutes')
    `

    console.log(`\n📝 New vs Updated Breakdown (last 10 minutes):`)
    console.log(`   Newly inserted: ${newVsUpdated[0].newly_inserted.toLocaleString()}`)
    console.log(`   Updated existing: ${newVsUpdated[0].updated_existing.toLocaleString()}`)
    console.log(`   Total processed: ${newVsUpdated[0].total_processed.toLocaleString()}`)

    // Check before/after comparison
    const beforeBackfill = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id)::int as total
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
        AND o.updated_at < NOW() - INTERVAL '10 minutes'
    `

    console.log(`\n📊 Orders that existed before backfill: ${beforeBackfill[0].total.toLocaleString()}`)

    // Check cancelled orders specifically
    const cancelled2025 = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id)::int as total_cancelled,
        COUNT(DISTINCT o.id) FILTER (WHERE o.updated_at >= NOW() - INTERVAL '10 minutes')::int as recently_updated_cancelled
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
        AND (o.state = 'CANCELED' OR oli.order_state = 'CANCELED')
    `

    console.log(`\n❌ Cancelled Orders (2025):`)
    console.log(`   Total in database: ${cancelled2025[0].total_cancelled.toLocaleString()}`)
    console.log(`   Recently updated: ${cancelled2025[0].recently_updated_cancelled.toLocaleString()}`)

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Total 2025 orders in database: ${total2025[0].total_orders.toLocaleString()}`)
    console.log(`   Orders processed in backfill: ${newVsUpdated[0].total_processed.toLocaleString()}`)
    console.log(`   - Newly inserted: ${newVsUpdated[0].newly_inserted.toLocaleString()}`)
    console.log(`   - Updated existing: ${newVsUpdated[0].updated_existing.toLocaleString()}`)
    console.log(`   Cancelled orders: ${cancelled2025[0].total_cancelled.toLocaleString()}`)

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

check2025BackfillResults()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })

