/**
 * Apply Analytics View Fix
 * Updates analytics_revenue_by_location_daily to include payments via orders
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
      runId: 'post-fix',
      hypothesisId
    })
  }).catch(() => {})
}
// #endregion agent log

async function applyViewFix() {
  console.log('🔧 Applying analytics_revenue_by_location_daily view fix...')
  
  // #region agent log
  logDebug('apply-analytics-view-fix.js:applyViewFix', 'Starting view update', {}, 'FIX')
  // #endregion agent log
  
  const migrationSQL = `
-- ============================================================================
-- FIX ANALYTICS REVENUE BY LOCATION DAILY VIEW
-- Include payments that are linked to orders with location_id, even if
-- the payment itself doesn't have a direct location_id
-- ============================================================================

CREATE OR REPLACE VIEW analytics_revenue_by_location_daily AS
WITH payment_locations AS (
  -- Payments with direct location_id
  SELECT 
    p.id as payment_id,
    p.organization_id,
    p.location_id::uuid as location_id,
    p.created_at,
    p.total_money_amount,
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
    p.total_money_amount,
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
  SUM(pl.total_money_amount) as revenue_cents,
  SUM(pl.total_money_amount)::DECIMAL / 100.0 as revenue_dollars,
  COUNT(DISTINCT pl.payment_id) as payment_count,
  COUNT(DISTINCT pl.customer_id) as unique_customers
FROM payment_locations pl
INNER JOIN locations l 
  ON pl.location_id = l.id
  AND pl.organization_id = l.organization_id
GROUP BY pl.organization_id, pl.location_id, l.name, DATE(pl.created_at);
  `
  
  try {
    await prisma.$executeRawUnsafe(migrationSQL)
    console.log('✅ View updated successfully')
    
    // #region agent log
    logDebug('apply-analytics-view-fix.js:applyViewFix', 'View update completed', { success: true }, 'FIX')
    // #endregion agent log
  } catch (error) {
    console.error('❌ Error updating view:', error.message)
    
    // #region agent log
    logDebug('apply-analytics-view-fix.js:applyViewFix', 'View update failed', { error: error.message }, 'FIX')
    // #endregion agent log
    
    throw error
  }
}

async function verifyFix() {
  console.log('\n🔍 Verifying fix...')
  
  const ORGANIZATION_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
  const PACIFIC_AVE_SQUARE_LOCATION_ID = 'LNQKVBTQZN3EZ'
  const START_DATE = '2026-01-02'
  
  // Get Pacific Ave location UUID
  const locationResult = await prisma.$queryRawUnsafe(`
    SELECT id FROM locations 
    WHERE square_location_id = '${PACIFIC_AVE_SQUARE_LOCATION_ID}'
      AND organization_id = '${ORGANIZATION_ID}'::uuid
    LIMIT 1
  `)
  
  if (!locationResult || locationResult.length === 0) {
    console.log('⚠️  Pacific Ave location not found')
    return
  }
  
  const pacificAveUuid = locationResult[0].id
  
  // Check analytics view for Pacific Ave
  const analyticsData = await prisma.$queryRawUnsafe(`
    SELECT 
      SUM(revenue_cents)::text as total_revenue_cents,
      SUM(payment_count)::text as total_payment_count,
      COUNT(DISTINCT date)::text as days_with_data
    FROM analytics_revenue_by_location_daily
    WHERE organization_id = '${ORGANIZATION_ID}'::uuid
      AND location_id = '${pacificAveUuid}'::uuid
      AND date >= '${START_DATE}'::date
  `)
  
  const result = analyticsData[0] || {}
  const revenue = parseInt(result.total_revenue_cents) || 0
  const payments = parseInt(result.total_payment_count) || 0
  const days = parseInt(result.days_with_data) || 0
  
  console.log(`\n📊 Pacific Ave Analytics (since ${START_DATE}):`)
  console.log(`   - Payments: ${payments}`)
  console.log(`   - Revenue: $${(revenue / 100).toFixed(2)}`)
  console.log(`   - Days with data: ${days}`)
  
  // #region agent log
  logDebug('apply-analytics-view-fix.js:verifyFix', 'Verification complete', {
    payments,
    revenue,
    days
  }, 'VERIFY')
  // #endregion agent log
  
  // Check for payments via orders
  const paymentsViaOrders = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT p.id)::text as count
    FROM payments p
    INNER JOIN orders o ON p.order_id::uuid = o.id::uuid
    INNER JOIN locations ol ON o.location_id::uuid = ol.id::uuid
    WHERE p.created_at >= '${START_DATE}'::date
      AND p.organization_id = '${ORGANIZATION_ID}'::uuid
      AND p.status = 'COMPLETED'
      AND p.location_id IS NULL
      AND p.order_id IS NOT NULL
      AND ol.square_location_id = '${PACIFIC_AVE_SQUARE_LOCATION_ID}'
  `)
  
  const viaOrdersCount = parseInt(paymentsViaOrders[0]?.count) || 0
  console.log(`\n📊 Payments via orders (should now be included):`)
  console.log(`   - Payments without location_id linked to Pacific Ave orders: ${viaOrdersCount}`)
  
  // #region agent log
  logDebug('apply-analytics-view-fix.js:verifyFix', 'Payments via orders check', {
    viaOrdersCount
  }, 'VERIFY')
  // #endregion agent log
}

async function main() {
  try {
    await applyViewFix()
    await verifyFix()
    console.log('\n✅ Fix applied and verified!')
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

main()

