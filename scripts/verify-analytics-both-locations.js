/**
 * Verify Analytics Data for Both Locations
 * Checks if Union St and Pacific Ave data are showing correctly in analytics views
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

// #region agent log
const LOG_ENDPOINT = 'http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939'
function logDebug(location, message, data, hypothesisId) {
  fetch(LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'verify-all-data',
      hypothesisId
    })
  }).catch(() => {})
}
// #endregion agent log

const ORGANIZATION_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'

async function getLocationInfo() {
  // #region agent log
  logDebug('verify-analytics-both-locations.js:getLocationInfo', 'Getting location info', {}, 'LOC')
  // #endregion agent log
  
  const locations = await prisma.$queryRawUnsafe(`
    SELECT id, name, square_location_id
    FROM locations
    WHERE organization_id = '${ORGANIZATION_ID}'::uuid
    ORDER BY name
  `)
  
  // #region agent log
  logDebug('verify-analytics-both-locations.js:getLocationInfo', 'Locations found', { count: locations.length }, 'LOC')
  // #endregion agent log
  
  return locations
}

async function checkAnalyticsByLocation(locationId, locationName, startDate = null) {
  console.log(`\n📊 ${locationName} Analytics`)
  console.log('='.repeat(60))
  
  // #region agent log
  logDebug('verify-analytics-both-locations.js:checkAnalyticsByLocation', 'Checking analytics', { locationId, locationName, startDate }, 'ANALYTICS')
  // #endregion agent log
  
  const dateFilter = startDate ? `AND date >= '${startDate}'::date` : ''
  const dateLabel = startDate ? `(since ${startDate})` : '(all time)'
  
  // Check analytics_revenue_by_location_daily
  const revenueData = await prisma.$queryRawUnsafe(`
    SELECT 
      COUNT(DISTINCT date)::text as days_count,
      SUM(payment_count)::text as total_payments,
      SUM(revenue_cents)::text as total_revenue_cents,
      MIN(date)::text as first_date,
      MAX(date)::text as last_date
    FROM analytics_revenue_by_location_daily
    WHERE organization_id = '${ORGANIZATION_ID}'::uuid
      AND location_id = '${locationId}'::uuid
      ${dateFilter}
  `)
  
  const revenue = revenueData[0] || {}
  const days = parseInt(revenue.days_count) || 0
  const payments = parseInt(revenue.total_payments) || 0
  const revenueCents = parseInt(revenue.total_revenue_cents) || 0
  const firstDate = revenue.first_date || 'N/A'
  const lastDate = revenue.last_date || 'N/A'
  
  console.log(`Revenue Data ${dateLabel}:`)
  console.log(`  - Days with data: ${days}`)
  console.log(`  - Total payments: ${payments}`)
  console.log(`  - Total revenue: $${(revenueCents / 100).toFixed(2)}`)
  console.log(`  - Date range: ${firstDate} to ${lastDate}`)
  
  // #region agent log
  logDebug('verify-analytics-both-locations.js:checkAnalyticsByLocation', 'Revenue data retrieved', {
    days,
    payments,
    revenueCents,
    firstDate,
    lastDate
  }, 'ANALYTICS')
  // #endregion agent log
  
  // Check raw payments data for comparison
  const rawPayments = await prisma.$queryRawUnsafe(`
    SELECT 
      COUNT(*)::text as count,
      SUM(total_money_amount)::text as revenue_cents,
      MIN(created_at)::text as first_payment,
      MAX(created_at)::text as last_payment
    FROM payments
    WHERE organization_id = '${ORGANIZATION_ID}'::uuid
      AND location_id = '${locationId}'::uuid
      AND status = 'COMPLETED'
      ${startDate ? `AND created_at >= '${startDate}'::date` : ''}
  `)
  
  const raw = rawPayments[0] || {}
  const rawCount = parseInt(raw.count) || 0
  const rawRevenue = parseInt(raw.revenue_cents) || 0
  
  console.log(`\nRaw Payments Data ${dateLabel} (direct location_id):`)
  console.log(`  - Payments: ${rawCount}`)
  console.log(`  - Revenue: $${(rawRevenue / 100).toFixed(2)}`)
  
  // Check payments via orders
  const paymentsViaOrders = await prisma.$queryRawUnsafe(`
    SELECT 
      COUNT(DISTINCT p.id)::text as count,
      SUM(p.total_money_amount)::text as revenue_cents
    FROM payments p
    INNER JOIN orders o ON p.order_id::uuid = o.id::uuid
    WHERE p.organization_id = '${ORGANIZATION_ID}'::uuid
      AND p.status = 'COMPLETED'
      AND p.location_id IS NULL
      AND p.order_id IS NOT NULL
      AND o.location_id::uuid = '${locationId}'::uuid
      ${startDate ? `AND p.created_at >= '${startDate}'::date` : ''}
  `)
  
  const viaOrders = paymentsViaOrders[0] || {}
  const viaOrdersCount = parseInt(viaOrders.count) || 0
  const viaOrdersRevenue = parseInt(viaOrders.revenue_cents) || 0
  
  console.log(`\nPayments via Orders ${dateLabel} (no direct location_id):`)
  console.log(`  - Payments: ${viaOrdersCount}`)
  console.log(`  - Revenue: $${(viaOrdersRevenue / 100).toFixed(2)}`)
  
  // #region agent log
  logDebug('verify-analytics-both-locations.js:checkAnalyticsByLocation', 'Payments via orders check', {
    viaOrdersCount,
    viaOrdersRevenue
  }, 'ANALYTICS')
  // #endregion agent log
  
  // Calculate expected total
  const expectedPayments = rawCount + viaOrdersCount
  const expectedRevenue = rawRevenue + viaOrdersRevenue
  
  console.log(`\nExpected Total ${dateLabel} (direct + via orders):`)
  console.log(`  - Payments: ${expectedPayments}`)
  console.log(`  - Revenue: $${(expectedRevenue / 100).toFixed(2)}`)
  
  console.log(`\nAnalytics View vs Expected:`)
  console.log(`  - Payments: ${payments} (analytics) vs ${expectedPayments} (expected) - ${payments === expectedPayments ? '✅ Match' : '⚠️  Mismatch'}`)
  console.log(`  - Revenue: $${(revenueCents / 100).toFixed(2)} (analytics) vs $${(expectedRevenue / 100).toFixed(2)} (expected) - ${Math.abs(revenueCents - expectedRevenue) < 1 ? '✅ Match' : '⚠️  Mismatch'}`)
  
  // #region agent log
  logDebug('verify-analytics-both-locations.js:checkAnalyticsByLocation', 'Comparison complete', {
    analyticsPayments: payments,
    expectedPayments,
    analyticsRevenue: revenueCents,
    expectedRevenue,
    match: payments === expectedPayments && Math.abs(revenueCents - expectedRevenue) < 1
  }, 'ANALYTICS')
  // #endregion agent log
  
  return {
    days,
    payments,
    revenueCents,
    firstDate,
    lastDate,
    rawCount,
    rawRevenue,
    viaOrdersCount,
    viaOrdersRevenue,
    expectedPayments,
    expectedRevenue,
    matches: payments === expectedPayments && Math.abs(revenueCents - expectedRevenue) < 1
  }
}

async function checkLastMonth() {
  console.log('\n' + '='.repeat(80))
  console.log('📅 LAST MONTH DATA CHECK')
  console.log('='.repeat(80))
  
  const lastMonth = new Date()
  lastMonth.setMonth(lastMonth.getMonth() - 1)
  lastMonth.setDate(1)
  lastMonth.setHours(0, 0, 0, 0)
  const startDate = lastMonth.toISOString().split('T')[0]
  
  console.log(`\nChecking data since: ${startDate} (start of last month)`)
  
  // #region agent log
  logDebug('verify-analytics-both-locations.js:checkLastMonth', 'Checking last month data', { startDate }, 'MONTH')
  // #endregion agent log
  
  const locations = await getLocationInfo()
  const results = {}
  
  for (const loc of locations) {
    results[loc.name] = await checkAnalyticsByLocation(loc.id, loc.name, startDate)
  }
  
  return results
}

async function checkAllTime() {
  console.log('\n' + '='.repeat(80))
  console.log('📅 ALL TIME DATA CHECK')
  console.log('='.repeat(80))
  
  // #region agent log
  logDebug('verify-analytics-both-locations.js:checkAllTime', 'Checking all time data', {}, 'ALLTIME')
  // #endregion agent log
  
  const locations = await getLocationInfo()
  const results = {}
  
  for (const loc of locations) {
    results[loc.name] = await checkAnalyticsByLocation(loc.id, loc.name)
  }
  
  return results
}

async function main() {
  console.log('='.repeat(80))
  console.log('🔍 Verifying Analytics Data for Both Locations')
  console.log('='.repeat(80))
  
  try {
    // #region agent log
    logDebug('verify-analytics-both-locations.js:main', 'Starting verification', { organizationId: ORGANIZATION_ID }, 'MAIN')
    // #endregion agent log
    
    const locations = await getLocationInfo()
    console.log(`\n📍 Found ${locations.length} location(s):`)
    locations.forEach(loc => {
      console.log(`  - ${loc.name} (${loc.square_location_id})`)
    })
    
    // Check all time data
    const allTimeResults = await checkAllTime()
    
    // Check last month data
    const lastMonthResults = await checkLastMonth()
    
    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('📊 SUMMARY')
    console.log('='.repeat(80))
    
    console.log('\nAll Time:')
    for (const [locationName, result] of Object.entries(allTimeResults)) {
      console.log(`\n${locationName}:`)
      console.log(`  - Days: ${result.days}`)
      console.log(`  - Payments: ${result.payments}`)
      console.log(`  - Revenue: $${(result.revenueCents / 100).toFixed(2)}`)
      console.log(`  - Data matches: ${result.matches ? '✅' : '⚠️'}`)
    }
    
    console.log('\nLast Month:')
    for (const [locationName, result] of Object.entries(lastMonthResults)) {
      console.log(`\n${locationName}:`)
      console.log(`  - Days: ${result.days}`)
      console.log(`  - Payments: ${result.payments}`)
      console.log(`  - Revenue: $${(result.revenueCents / 100).toFixed(2)}`)
      console.log(`  - Data matches: ${result.matches ? '✅' : '⚠️'}`)
    }
    
    // #region agent log
    logDebug('verify-analytics-both-locations.js:main', 'Verification complete', {
      allTimeResults,
      lastMonthResults
    }, 'MAIN')
    // #endregion agent log
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    
    // #region agent log
    logDebug('verify-analytics-both-locations.js:main', 'Verification failed', { error: error.message }, 'MAIN')
    // #endregion agent log
    
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

