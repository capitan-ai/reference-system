/**
 * Investigate Payments Missing LocationId via Orders
 * 
 * This script investigates whether payments without a direct location_id
 * are actually Pacific Ave payments via their associated orders.
 * 
 * Usage: node scripts/investigate-payments-via-orders.js
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { Prisma } = require('@prisma/client')

const PACIFIC_AVE_SQUARE_LOCATION_ID = 'LNQKVBTQZN3EZ'
const ORGANIZATION_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
const START_DATE = '2026-01-02' // Start checking from this date

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
      runId: 'investigation',
      hypothesisId
    })
  }).catch(() => {})
}
// #endregion agent log

async function getPacificAveLocationUuid() {
  // #region agent log
  logDebug('investigate-payments-via-orders.js:getPacificAveLocationUuid', 'Getting Pacific Ave location UUID', { squareLocationId: PACIFIC_AVE_SQUARE_LOCATION_ID, organizationId: ORGANIZATION_ID }, 'A')
  // #endregion agent log
  
  const result = await prisma.$queryRaw`
    SELECT id FROM locations 
    WHERE square_location_id = ${PACIFIC_AVE_SQUARE_LOCATION_ID}
      AND organization_id = ${ORGANIZATION_ID}::uuid
    LIMIT 1
  `
  
  if (!result || result.length === 0) {
    throw new Error(`Pacific Ave location not found (square_location_id: ${PACIFIC_AVE_SQUARE_LOCATION_ID})`)
  }
  
  const locationUuid = result[0].id
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:getPacificAveLocationUuid', 'Pacific Ave location UUID found', { locationUuid }, 'A')
  // #endregion agent log
  
  return locationUuid
}

async function investigatePaymentsViaOrders(pacificAveUuid) {
  console.log(`\n🔍 Investigating payments without location_id that are linked to Pacific Ave orders...`)
  
  // Hypothesis A: Payments with NULL location_id linked to orders with Pacific Ave location_id
  console.log(`\n📊 Hypothesis A: Payments with NULL location_id linked to Pacific Ave orders`)
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Starting Hypothesis A investigation', { pacificAveUuid, startDate: START_DATE }, 'A')
  // #endregion agent log
  
  const paymentsWithNullLocation = await prisma.$queryRawUnsafe(`
    SELECT 
      p.id::text as payment_id,
      p.payment_id as square_payment_id,
      p.created_at,
      p.location_id::text as payment_location_id,
      p.order_id::text as payment_order_id,
      o.id::text as order_id,
      o.order_id as square_order_id,
      o.location_id::text as order_location_id,
      ol.square_location_id as order_square_location_id,
      ol.name as order_location_name,
      p.total_money_amount,
      p.status
    FROM payments p
    INNER JOIN orders o ON p.order_id::uuid = o.id::uuid
    INNER JOIN locations ol ON o.location_id::uuid = ol.id::uuid
    WHERE p.created_at >= '${START_DATE}'::date
      AND p.organization_id = '${ORGANIZATION_ID}'::uuid
      AND p.location_id IS NULL
      AND p.order_id IS NOT NULL
      AND ol.square_location_id = '${PACIFIC_AVE_SQUARE_LOCATION_ID}'
    ORDER BY p.created_at DESC
    LIMIT 100
  `)
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Hypothesis A query completed', { count: paymentsWithNullLocation.length }, 'A')
  // #endregion agent log
  
  console.log(`   Found ${paymentsWithNullLocation.length} payments with NULL location_id linked to Pacific Ave orders`)
  
  if (paymentsWithNullLocation.length > 0) {
    console.log(`\n   Sample payments:`)
    paymentsWithNullLocation.slice(0, 5).forEach((p, idx) => {
      console.log(`   ${idx + 1}. Payment ${p.payment_id}`)
      console.log(`      - Square Payment ID: ${p.square_payment_id}`)
      console.log(`      - Created: ${p.created_at}`)
      console.log(`      - Amount: $${(p.total_money_amount / 100).toFixed(2)}`)
      console.log(`      - Status: ${p.status}`)
      console.log(`      - Order Location: ${p.order_location_name} (${p.order_square_location_id})`)
      
      // #region agent log
      logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Sample payment details', {
        paymentId: p.payment_id,
        squarePaymentId: p.square_payment_id,
        createdAt: p.created_at,
        amount: p.total_money_amount,
        status: p.status,
        orderLocationName: p.order_location_name,
        orderSquareLocationId: p.order_square_location_id
      }, 'A')
      // #endregion agent log
    })
  }
  
  // Hypothesis B: Payments with non-Pacific-Ave location_id but linked to Pacific Ave orders
  console.log(`\n📊 Hypothesis B: Payments with wrong location_id linked to Pacific Ave orders`)
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Starting Hypothesis B investigation', { pacificAveUuid }, 'B')
  // #endregion agent log
  
  let paymentsWithWrongLocation = []
  try {
    // Simplified query - get payment location info separately if needed
    paymentsWithWrongLocation = await prisma.$queryRawUnsafe(`
    SELECT 
      p.id::text as payment_id,
      p.payment_id as square_payment_id,
      p.created_at,
      p.location_id::text as payment_location_id,
      p.order_id::text as payment_order_id,
      o.id::text as order_id,
      o.order_id as square_order_id,
      o.location_id::text as order_location_id,
      ol.square_location_id as order_square_location_id,
      ol.name as order_location_name,
      p.total_money_amount,
      p.status
    FROM payments p
    INNER JOIN orders o ON p.order_id::uuid = o.id::uuid
    INNER JOIN locations ol ON o.location_id::uuid = ol.id::uuid
    WHERE p.created_at >= '${START_DATE}'::date
      AND p.organization_id = '${ORGANIZATION_ID}'::uuid
      AND p.location_id IS NOT NULL
      AND p.location_id != '${pacificAveUuid}'::uuid
      AND p.order_id IS NOT NULL
      AND ol.square_location_id = '${PACIFIC_AVE_SQUARE_LOCATION_ID}'
    ORDER BY p.created_at DESC
    LIMIT 100
    `)
  } catch (error) {
    console.log(`   ⚠️  Hypothesis B query failed: ${error.message}`)
    console.log(`   This may indicate data integrity issues with location_id values`)
    // #region agent log
    logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Hypothesis B query failed', { error: error.message }, 'B')
    // #endregion agent log
  }
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Hypothesis B query completed', { count: paymentsWithWrongLocation.length }, 'B')
  // #endregion agent log
  
  console.log(`   Found ${paymentsWithWrongLocation.length} payments with wrong location_id linked to Pacific Ave orders`)
  
  if (paymentsWithWrongLocation.length > 0) {
    console.log(`\n   Sample payments:`)
    for (let idx = 0; idx < Math.min(5, paymentsWithWrongLocation.length); idx++) {
      const p = paymentsWithWrongLocation[idx]
      console.log(`   ${idx + 1}. Payment ${p.payment_id}`)
      console.log(`      - Square Payment ID: ${p.square_payment_id}`)
      console.log(`      - Created: ${p.created_at}`)
      console.log(`      - Amount: $${(p.total_money_amount / 100).toFixed(2)}`)
      console.log(`      - Status: ${p.status}`)
      // Get payment location info separately
      const paymentLocationInfo = await prisma.$queryRawUnsafe(`
        SELECT name, square_location_id 
        FROM locations 
        WHERE id = '${p.payment_location_id}'::uuid
        LIMIT 1
      `)
      const plInfo = paymentLocationInfo[0] || {}
      console.log(`      - Payment Location: ${plInfo.name || 'NULL'} (${plInfo.square_location_id || 'NULL'})`)
      console.log(`      - Order Location: ${p.order_location_name} (${p.order_square_location_id})`)
      
      // #region agent log
      logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Sample payment with wrong location', {
        paymentId: p.payment_id,
        squarePaymentId: p.square_payment_id,
        createdAt: p.created_at,
        amount: p.total_money_amount,
        status: p.status,
        paymentLocationId: p.payment_location_id,
        orderLocationName: p.order_location_name,
        orderSquareLocationId: p.order_square_location_id
      }, 'B')
      // #endregion agent log
    }
  }
  
  // Hypothesis C: Count total payments that would be affected
  console.log(`\n📊 Hypothesis C: Total revenue impact`)
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Starting Hypothesis C - revenue calculation', {}, 'C')
  // #endregion agent log
  
  const revenueImpact = await prisma.$queryRawUnsafe(`
    SELECT 
      COUNT(DISTINCT p.id) as payment_count,
      SUM(p.total_money_amount) as total_revenue_cents,
      COUNT(DISTINCT p.customer_id) as unique_customers
    FROM payments p
    INNER JOIN orders o ON p.order_id::uuid = o.id::uuid
    INNER JOIN locations ol ON o.location_id::uuid = ol.id::uuid
    WHERE p.created_at >= '${START_DATE}'::date
      AND p.organization_id = '${ORGANIZATION_ID}'::uuid
      AND p.status = 'COMPLETED'
      AND p.order_id IS NOT NULL
      AND ol.square_location_id = '${PACIFIC_AVE_SQUARE_LOCATION_ID}'
      AND (p.location_id IS NULL OR p.location_id != '${pacificAveUuid}'::uuid)
  `)
  
  const impact = revenueImpact[0]
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Revenue impact calculated', {
    paymentCount: parseInt(impact.payment_count) || 0,
    totalRevenueCents: parseInt(impact.total_revenue_cents) || 0,
    uniqueCustomers: parseInt(impact.unique_customers) || 0
  }, 'C')
  // #endregion agent log
  
  console.log(`   Total payments affected: ${impact.payment_count || 0}`)
  console.log(`   Total revenue: $${((impact.total_revenue_cents || 0) / 100).toFixed(2)}`)
  console.log(`   Unique customers: ${impact.unique_customers || 0}`)
  
  // Hypothesis D: Check if analytics view is missing these payments
  console.log(`\n📊 Hypothesis D: Analytics view comparison`)
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Starting Hypothesis D - analytics comparison', {}, 'D')
  // #endregion agent log
  
  let analyticsViewData = [{ total_revenue_cents: '0', total_payment_count: '0' }]
  try {
    analyticsViewData = await prisma.$queryRawUnsafe(`
      SELECT 
        COALESCE(SUM(revenue_cents), 0)::text as total_revenue_cents,
        COALESCE(SUM(payment_count), 0)::text as total_payment_count
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = '${ORGANIZATION_ID}'::uuid
        AND location_id = '${pacificAveUuid}'::uuid
        AND date >= '${START_DATE}'::date
    `)
  } catch (error) {
    console.log(`   ⚠️  Analytics view query failed: ${error.message}`)
    // #region agent log
    logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Analytics view query failed', { error: error.message }, 'D')
    // #endregion agent log
  }
  
  const analyticsTotal = analyticsViewData[0] || {}
  const analyticsRevenue = parseInt(analyticsTotal.total_revenue_cents) || 0
  const analyticsPayments = parseInt(analyticsTotal.total_payment_count) || 0
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Analytics view data retrieved', {
    analyticsRevenue,
    analyticsPayments
  }, 'D')
  // #endregion agent log
  
  console.log(`   Analytics view shows:`)
  console.log(`   - Payments: ${analyticsPayments}`)
  console.log(`   - Revenue: $${(analyticsRevenue / 100).toFixed(2)}`)
  
  const missingRevenue = (impact.total_revenue_cents || 0) - analyticsRevenue
  const missingPayments = (parseInt(impact.payment_count) || 0) - analyticsPayments
  
  console.log(`\n   Potential missing from analytics:`)
  console.log(`   - Payments: ${missingPayments > 0 ? missingPayments : 0}`)
  console.log(`   - Revenue: $${(missingRevenue > 0 ? missingRevenue / 100 : 0).toFixed(2)}`)
  
  // #region agent log
  logDebug('investigate-payments-via-orders.js:investigatePaymentsViaOrders', 'Analytics comparison complete', {
    missingPayments: missingPayments > 0 ? missingPayments : 0,
    missingRevenue: missingRevenue > 0 ? missingRevenue : 0
  }, 'D')
  // #endregion agent log
  
  return {
    paymentsWithNullLocation: paymentsWithNullLocation.length,
    paymentsWithWrongLocation: paymentsWithWrongLocation.length,
    totalAffected: parseInt(impact.payment_count) || 0,
    totalRevenueCents: parseInt(impact.total_revenue_cents) || 0,
    uniqueCustomers: parseInt(impact.unique_customers) || 0,
    analyticsPayments,
    analyticsRevenue,
    missingPayments: missingPayments > 0 ? missingPayments : 0,
    missingRevenue: missingRevenue > 0 ? missingRevenue : 0
  }
}

async function main() {
  console.log('='.repeat(80))
  console.log('🔍 Investigating Payments Missing LocationId via Orders')
  console.log('='.repeat(80))
  
  try {
    // #region agent log
    logDebug('investigate-payments-via-orders.js:main', 'Starting investigation', { startDate: START_DATE, organizationId: ORGANIZATION_ID }, 'A')
    // #endregion agent log
    
    const pacificAveUuid = await getPacificAveLocationUuid()
    console.log(`\n✅ Pacific Ave location UUID: ${pacificAveUuid}`)
    console.log(`   Square Location ID: ${PACIFIC_AVE_SQUARE_LOCATION_ID}`)
    
    const results = await investigatePaymentsViaOrders(pacificAveUuid)
    
    console.log('\n' + '='.repeat(80))
    console.log('📊 INVESTIGATION SUMMARY')
    console.log('='.repeat(80))
    console.log(`\nPayments with NULL location_id linked to Pacific Ave orders: ${results.paymentsWithNullLocation}`)
    console.log(`Payments with wrong location_id linked to Pacific Ave orders: ${results.paymentsWithWrongLocation}`)
    console.log(`\nTotal affected payments: ${results.totalAffected}`)
    console.log(`Total revenue: $${(results.totalRevenueCents / 100).toFixed(2)}`)
    console.log(`Unique customers: ${results.uniqueCustomers}`)
    console.log(`\nAnalytics view currently shows:`)
    console.log(`  - Payments: ${results.analyticsPayments}`)
    console.log(`  - Revenue: $${(results.analyticsRevenue / 100).toFixed(2)}`)
    console.log(`\nPotentially missing from analytics:`)
    console.log(`  - Payments: ${results.missingPayments}`)
    console.log(`  - Revenue: $${(results.missingRevenue / 100).toFixed(2)}`)
    
    if (results.totalAffected > 0) {
      console.log(`\n✅ CONCLUSION: Found ${results.totalAffected} payments that should be counted as Pacific Ave`)
      console.log(`   These payments are linked to Pacific Ave orders but don't have Pacific Ave location_id`)
      console.log(`   The analytics view needs to be updated to include payments via orders`)
    } else {
      console.log(`\nℹ️  No payments found that are missing Pacific Ave location via orders`)
    }
    
    // #region agent log
    logDebug('investigate-payments-via-orders.js:main', 'Investigation complete', results, 'A')
    // #endregion agent log
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    
    // #region agent log
    logDebug('investigate-payments-via-orders.js:main', 'Investigation failed', { error: error.message, stack: error.stack }, 'A')
    // #endregion agent log
    
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

