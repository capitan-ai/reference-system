#!/usr/bin/env node
/**
 * Verify Rebooking Rate Calculation
 * Compares the analytics view calculation with the true overall rebooking rate
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function verifyRebookingRate() {
  console.log('🔍 Verifying Rebooking Rate Calculation\n')
  console.log('='.repeat(60))

  try {
    // Get organization with analytics data
    const orgsWithData = await prisma.$queryRaw`
      SELECT DISTINCT organization_id
      FROM analytics_overview_daily
      ORDER BY organization_id
      LIMIT 1
    `

    if (!orgsWithData || orgsWithData.length === 0) {
      console.log('⚠️  No organizations with analytics data found')
      return
    }

    const orgId = orgsWithData[0].organization_id
    
    // Get org name
    const org = await prisma.$queryRaw`
      SELECT id, name, square_merchant_id
      FROM organizations
      WHERE id = ${orgId}::uuid
    `
    const orgName = org && org.length > 0 
      ? (org[0].name || org[0].square_merchant_id)
      : orgId
    console.log(`\n📊 Testing with organization: ${orgName}`)
    console.log(`   Organization ID: ${orgId}\n`)

    // Calculate TRUE overall rebooking rate
    console.log('1️⃣  Calculating TRUE overall rebooking rate...')
    const trueRate = await prisma.$queryRaw`
      WITH customer_booking_counts AS (
        SELECT 
          customer_id,
          COUNT(*) as booking_count
        FROM bookings
        WHERE status != 'CANCELLED'
          AND customer_id IS NOT NULL
          AND organization_id = ${orgId}::uuid
        GROUP BY customer_id
      )
      SELECT 
        COUNT(DISTINCT CASE WHEN booking_count >= 2 THEN customer_id END)::DECIMAL 
          / NULLIF(COUNT(DISTINCT customer_id), 0) as true_rebooking_rate,
        COUNT(DISTINCT customer_id) as total_customers,
        COUNT(DISTINCT CASE WHEN booking_count >= 2 THEN customer_id END) as customers_with_2plus_bookings,
        COUNT(DISTINCT CASE WHEN booking_count = 1 THEN customer_id END) as customers_with_1_booking,
        COUNT(DISTINCT CASE WHEN booking_count >= 3 THEN customer_id END) as customers_with_3plus_bookings
      FROM customer_booking_counts
    `

    if (trueRate && trueRate.length > 0) {
      const stats = trueRate[0]
      console.log(`   ✅ TRUE Rebooking Rate: ${(Number(stats.true_rebooking_rate) * 100).toFixed(2)}%`)
      console.log(`   📊 Total Customers: ${Number(stats.total_customers)}`)
      console.log(`   🔄 Customers with 2+ bookings: ${Number(stats.customers_with_2plus_bookings)}`)
      console.log(`   🆕 Customers with 1 booking: ${Number(stats.customers_with_1_booking)}`)
      console.log(`   ⭐ Customers with 3+ bookings: ${Number(stats.customers_with_3plus_bookings)}`)
    }

    // Get what the view currently shows (last 30 days)
    console.log('\n2️⃣  Checking analytics_overview_daily view (last 30 days)...')
    const viewData = await prisma.$queryRaw`
      SELECT 
        AVG(rebooking_rate) as avg_daily_rebooking_rate,
        MAX(rebooking_rate) as max_daily_rebooking_rate,
        MIN(rebooking_rate) as min_daily_rebooking_rate,
        COUNT(*) as days_with_data
      FROM analytics_overview_daily
      WHERE organization_id = ${orgId}::uuid
        AND date >= CURRENT_DATE - INTERVAL '30 days'
        AND rebooking_rate IS NOT NULL
    `

    if (viewData && viewData.length > 0) {
      const view = viewData[0]
      console.log(`   📈 Average Daily Rate (from view): ${(Number(view.avg_daily_rebooking_rate) * 100).toFixed(2)}%`)
      console.log(`   📊 Max Daily Rate: ${(Number(view.max_daily_rebooking_rate) * 100).toFixed(2)}%`)
      console.log(`   📊 Min Daily Rate: ${(Number(view.min_daily_rebooking_rate) * 100).toFixed(2)}%`)
      console.log(`   📅 Days with data: ${Number(view.days_with_data)}`)
    }

    // Compare
    console.log('\n' + '='.repeat(60))
    console.log('📊 COMPARISON')
    console.log('='.repeat(60))

    if (trueRate && trueRate.length > 0 && viewData && viewData.length > 0) {
      const trueRateValue = Number(trueRate[0].true_rebooking_rate)
      const viewRateValue = Number(viewData[0].avg_daily_rebooking_rate)
      const difference = Math.abs(trueRateValue - viewRateValue) * 100

      console.log(`\n   TRUE Overall Rate: ${(trueRateValue * 100).toFixed(2)}%`)
      console.log(`   View Average Rate: ${(viewRateValue * 100).toFixed(2)}%`)
      console.log(`   Difference: ${difference.toFixed(2)} percentage points`)

      if (difference > 5) {
        console.log(`\n   ⚠️  SIGNIFICANT DIFFERENCE DETECTED!`)
        console.log(`   The view is calculating daily averages, not overall rate.`)
        console.log(`   Recommendation: Update the view to use overall calculation.`)
      } else if (difference > 2) {
        console.log(`\n   ⚠️  Minor difference detected.`)
        console.log(`   The view calculation is close but not exact.`)
      } else {
        console.log(`\n   ✅ Rates are very close - calculation is accurate!`)
      }
    }

    // Show sample daily breakdown
    console.log('\n3️⃣  Sample daily rebooking rates (last 7 days)...')
    const dailyRates = await prisma.$queryRaw`
      SELECT 
        date,
        rebooking_rate,
        total_customers_with_bookings
      FROM analytics_overview_daily
      WHERE organization_id = ${orgId}::uuid
        AND date >= CURRENT_DATE - INTERVAL '7 days'
        AND rebooking_rate IS NOT NULL
      ORDER BY date DESC
    `

    if (dailyRates && dailyRates.length > 0) {
      dailyRates.forEach(row => {
        console.log(`   ${row.date.toISOString().split('T')[0]}: ${(Number(row.rebooking_rate) * 100).toFixed(1)}% (${Number(row.total_customers_with_bookings)} customers)`)
      })
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ Verification completed!')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

verifyRebookingRate()

