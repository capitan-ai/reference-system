#!/usr/bin/env node
/**
 * Update analytics_revenue_by_location_daily view to ensure it's correct
 * and matches all raw data
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function updateAnalyticsView() {
  console.log('🔧 Updating analytics_revenue_by_location_daily view...\n')
  console.log('='.repeat(80))

  try {
    // Get the current view definition to compare
    const currentView = await prisma.$queryRaw`
      SELECT pg_get_viewdef('analytics_revenue_by_location_daily', true) as definition
    `
    
    console.log('Current view definition:')
    console.log('-'.repeat(80))
    if (currentView && currentView[0]) {
      console.log(currentView[0].definition)
    }

    // Updated view definition - ensuring it captures all payments correctly
    const updatedViewSQL = `
-- ============================================================================
-- ANALYTICS REVENUE BY LOCATION DAILY VIEW
-- Aggregates completed payments by location and date
-- Includes payments with direct location_id and payments via orders
-- ============================================================================

CREATE OR REPLACE VIEW analytics_revenue_by_location_daily AS
WITH payment_locations AS (
  -- Payments with direct location_id
  SELECT 
    p.id as payment_id,
    p.organization_id,
    p.location_id::uuid as location_id,
    p.created_at,
    p.amount_money_amount,
    p.customer_id,
    p.status
  FROM payments p
  WHERE p.status = 'COMPLETED'
    AND p.location_id IS NOT NULL
  
  UNION ALL
  
  -- Payments without location_id but linked to orders with location_id
  SELECT 
    p.id as payment_id,
    p.organization_id,
    o.location_id::uuid as location_id,
    p.created_at,
    p.amount_money_amount,
    p.customer_id,
    p.status
  FROM payments p
  INNER JOIN orders o ON p.order_id::uuid = o.id::uuid
  WHERE p.status = 'COMPLETED'
    AND p.location_id IS NULL
    AND p.order_id IS NOT NULL
    AND o.location_id IS NOT NULL
)
SELECT
  pl.organization_id,
  pl.location_id,
  l.name as location_name,
  DATE(pl.created_at) as date,
  SUM(pl.amount_money_amount) as revenue_cents,
  SUM(pl.amount_money_amount)::DECIMAL / 100.0 as revenue_dollars,
  COUNT(DISTINCT pl.payment_id) as payment_count,
  COUNT(DISTINCT pl.customer_id) FILTER (WHERE pl.customer_id IS NOT NULL) as unique_customers
FROM payment_locations pl
INNER JOIN locations l 
  ON pl.location_id = l.id
  AND pl.organization_id = l.organization_id
GROUP BY pl.organization_id, pl.location_id, l.name, DATE(pl.created_at);
    `

    console.log('\n\nUpdating view...')
    console.log('-'.repeat(80))
    
    await prisma.$executeRawUnsafe(updatedViewSQL)
    console.log('✅ View updated successfully')

    // Verify the update
    console.log('\n\n🔍 Verifying updated view...')
    console.log('-'.repeat(80))

    const orgId = 'd0e24178-2f94-4033-bc91-41f22df58278'

    // Check view stats
    const viewStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_records,
        COUNT(DISTINCT date)::int as unique_dates,
        COUNT(DISTINCT location_name)::int as unique_locations,
        MIN(date) as earliest_date,
        MAX(date) as latest_date,
        SUM(revenue_dollars) as total_revenue,
        SUM(payment_count)::bigint as total_payments
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = ${orgId}::uuid
    `

    const stats = viewStats[0]
    console.log(`\nView Statistics:`)
    console.log(`  Total records: ${stats.total_records?.toLocaleString()}`)
    console.log(`  Unique dates: ${stats.unique_dates?.toLocaleString()}`)
    console.log(`  Unique locations: ${stats.unique_locations}`)
    console.log(`  Date range: ${stats.earliest_date} to ${stats.latest_date}`)
    console.log(`  Total revenue: $${Number(stats.total_revenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    console.log(`  Total payments: ${stats.total_payments?.toLocaleString()}`)

    // Compare with raw data
    const rawStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_payments,
        COUNT(DISTINCT DATE(created_at))::int as unique_dates,
        SUM(amount_money_amount) as total_revenue_cents
      FROM payments
      WHERE organization_id = ${orgId}::uuid
        AND status = 'COMPLETED'
    `

    const raw = rawStats[0]
    const rawRevenue = Number(raw.total_revenue_cents || 0) / 100
    const viewRevenue = Number(stats.total_revenue || 0)

    console.log(`\nRaw Payments Statistics:`)
    console.log(`  Total payments: ${raw.total_payments?.toLocaleString()}`)
    console.log(`  Unique dates: ${raw.unique_dates?.toLocaleString()}`)
    console.log(`  Total revenue: $${rawRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

    console.log(`\n\n📊 Comparison:`)
    console.log('-'.repeat(80))
    console.log(`Revenue match: ${Math.abs(viewRevenue - rawRevenue) < 0.01 ? '✅' : '❌'} (View: $${viewRevenue.toFixed(2)}, Raw: $${rawRevenue.toFixed(2)})`)
    console.log(`Payments match: ${Number(stats.total_payments) === raw.total_payments ? '✅' : '❌'} (View: ${stats.total_payments}, Raw: ${raw.total_payments})`)
    console.log(`Dates match: ${stats.unique_dates === raw.unique_dates ? '✅' : '❌'} (View: ${stats.unique_dates}, Raw: ${raw.unique_dates})`)

    // Check by year
    console.log(`\n\n📅 Data by Year:`)
    console.log('-'.repeat(80))
    
    const byYear = await prisma.$queryRaw`
      SELECT 
        EXTRACT(YEAR FROM date)::int as year,
        COUNT(DISTINCT date)::int as days_with_data,
        COUNT(*)::int as total_records,
        SUM(revenue_dollars) as total_revenue,
        SUM(payment_count)::bigint as total_payments
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = ${orgId}::uuid
      GROUP BY EXTRACT(YEAR FROM date)
      ORDER BY year
    `

    console.log('\nYear | Days | Records | Revenue | Payments')
    console.log('-'.repeat(80))
    byYear.forEach(y => {
      const revenue = Number(y.total_revenue || 0)
      console.log(`${y.year} | ${y.days_with_data} | ${y.total_records} | $${revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | ${y.total_payments?.toLocaleString()}`)
    })

    // Check for any missing data
    console.log(`\n\n🔍 Checking for missing data...`)
    console.log('-'.repeat(80))
    
    const missingDates = await prisma.$queryRaw`
      WITH payment_dates AS (
        SELECT DISTINCT DATE(created_at) as payment_date
        FROM payments
        WHERE organization_id = ${orgId}::uuid
          AND status = 'COMPLETED'
      ),
      view_dates AS (
        SELECT DISTINCT date as view_date
        FROM analytics_revenue_by_location_daily
        WHERE organization_id = ${orgId}::uuid
      )
      SELECT COUNT(*)::int as missing_count
      FROM payment_dates pd
      LEFT JOIN view_dates vd ON vd.view_date = pd.payment_date
      WHERE vd.view_date IS NULL
    `

    const missing = missingDates[0]?.missing_count || 0
    if (missing === 0) {
      console.log('✅ No missing dates - all payment dates are in the view')
    } else {
      console.log(`⚠️  Found ${missing} dates with payments but missing from view`)
    }

    console.log('\n' + '='.repeat(80))
    console.log('✅ View update and verification completed!')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

updateAnalyticsView()


