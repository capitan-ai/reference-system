#!/usr/bin/env node
/**
 * Investigate Missing Revenue Data
 * Checks why revenue data stops on January 16, 2026
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'

async function investigateMissingRevenue() {
  console.log('🔍 Investigating Missing Revenue Data\n')
  console.log('='.repeat(80))
  console.log(`Organization ID: ${ORG_ID}\n`)

  try {
    // 1. Check current date
    const currentDate = await prisma.$queryRaw`SELECT CURRENT_DATE as today`
    console.log(`📅 Current Date: ${currentDate[0].today}\n`)

    // 2. Check latest date in analytics view
    console.log('1️⃣ Checking analytics_revenue_by_location_daily view...')
    const latestAnalytics = await prisma.$queryRaw`
      SELECT 
        MAX(date) as latest_date,
        COUNT(*) as total_records,
        COUNT(DISTINCT date) as unique_dates
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = ${ORG_ID}::uuid
    `
    console.log(`   Latest date in view: ${latestAnalytics[0].latest_date}`)
    console.log(`   Total records: ${latestAnalytics[0].total_records}`)
    console.log(`   Unique dates: ${latestAnalytics[0].unique_dates}`)

    // 3. Check raw payments table
    console.log('\n2️⃣ Checking raw payments table...')
    const latestPayments = await prisma.$queryRaw`
      SELECT 
        MAX(DATE(created_at)) as latest_payment_date,
        MIN(DATE(created_at)) as earliest_payment_date,
        COUNT(*) as total_payments,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_payments,
        COUNT(*) FILTER (WHERE status != 'COMPLETED') as other_status_payments
      FROM payments
      WHERE organization_id = ${ORG_ID}::uuid
    `
    console.log(`   Latest payment date: ${latestPayments[0].latest_payment_date}`)
    console.log(`   Earliest payment date: ${latestPayments[0].earliest_payment_date}`)
    console.log(`   Total payments: ${latestPayments[0].total_payments}`)
    console.log(`   Completed payments: ${latestPayments[0].completed_payments}`)
    console.log(`   Other status payments: ${latestPayments[0].other_status_payments}`)

    // 4. Check payments after January 16, 2026
    console.log('\n3️⃣ Checking payments after January 16, 2026...')
    const paymentsAfterJan16 = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as payment_date,
        COUNT(*) as payment_count,
        SUM(total_money_amount) as total_cents,
        COUNT(DISTINCT status) as status_count,
        array_agg(DISTINCT status) as statuses
      FROM payments
      WHERE organization_id = ${ORG_ID}::uuid
        AND DATE(created_at) > '2026-01-16'
      GROUP BY DATE(created_at)
      ORDER BY payment_date DESC
      LIMIT 30
    `
    
    if (paymentsAfterJan16 && paymentsAfterJan16.length > 0) {
      console.log(`   ✅ Found ${paymentsAfterJan16.length} days with payments after Jan 16:`)
      paymentsAfterJan16.forEach(p => {
        console.log(`      ${p.payment_date}: ${p.payment_count} payments, $${(Number(p.total_cents) / 100).toFixed(2)}, statuses: ${p.statuses.join(', ')}`)
      })
    } else {
      console.log(`   ⚠️  No payments found after January 16, 2026`)
    }

    // 5. Check payments by status
    console.log('\n4️⃣ Checking payments by status (after Jan 16)...')
    const paymentsByStatus = await prisma.$queryRaw`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(total_money_amount) as total_cents
      FROM payments
      WHERE organization_id = ${ORG_ID}::uuid
        AND DATE(created_at) > '2026-01-16'
      GROUP BY status
      ORDER BY count DESC
    `
    
    if (paymentsByStatus && paymentsByStatus.length > 0) {
      console.log(`   Payment statuses after Jan 16:`)
      paymentsByStatus.forEach(p => {
        console.log(`      ${p.status}: ${p.count} payments, $${(Number(p.total_cents) / 100).toFixed(2)}`)
      })
    }

    // 6. Check if analytics view is filtering correctly
    console.log('\n5️⃣ Checking analytics view logic...')
    const viewLogic = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as payment_date,
        COUNT(*) as total_payments,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_payments,
        SUM(total_money_amount) FILTER (WHERE status = 'COMPLETED') as completed_revenue_cents
      FROM payments
      WHERE organization_id = ${ORG_ID}::uuid
        AND DATE(created_at) > '2026-01-16'
      GROUP BY DATE(created_at)
      ORDER BY payment_date DESC
      LIMIT 10
    `
    
    if (viewLogic && viewLogic.length > 0) {
      console.log(`   Payments that SHOULD appear in analytics view (status = 'COMPLETED'):`)
      viewLogic.forEach(p => {
        if (p.completed_payments > 0) {
          console.log(`      ${p.payment_date}: ${p.completed_payments} completed payments, $${(Number(p.completed_revenue_cents) / 100).toFixed(2)}`)
        } else {
          console.log(`      ${p.payment_date}: ${p.total_payments} payments, but NONE are COMPLETED`)
        }
      })
    }

    // 7. Check what the view actually shows
    console.log('\n6️⃣ Checking what analytics view shows for recent dates...')
    const viewData = await prisma.$queryRaw`
      SELECT 
        date,
        location_name,
        revenue_dollars,
        payment_count
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = ${ORG_ID}::uuid
        AND date > '2026-01-16'
      ORDER BY date DESC
      LIMIT 20
    `
    
    if (viewData && viewData.length > 0) {
      console.log(`   Analytics view shows:`)
      viewData.forEach(v => {
        console.log(`      ${v.date} - ${v.location_name}: $${Number(v.revenue_dollars).toFixed(2)} (${v.payment_count} payments)`)
      })
    } else {
      console.log(`   ⚠️  Analytics view shows NO data after January 16, 2026`)
    }

    // 8. Check for date range issues
    console.log('\n7️⃣ Checking date range coverage...')
    const dateRange = await prisma.$queryRaw`
      SELECT 
        MIN(date) as earliest_date,
        MAX(date) as latest_date,
        COUNT(DISTINCT date) as days_with_data
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = ${ORG_ID}::uuid
    `
    console.log(`   View date range: ${dateRange[0].earliest_date} to ${dateRange[0].latest_date}`)
    console.log(`   Days with data: ${dateRange[0].days_with_data}`)

    // 9. Check if there are payments but they're not COMPLETED
    console.log('\n8️⃣ Summary of issue...')
    const summary = await prisma.$queryRaw`
      WITH payment_summary AS (
        SELECT 
          DATE(created_at) as payment_date,
          COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_count,
          COUNT(*) FILTER (WHERE status != 'COMPLETED') as other_count,
          array_agg(DISTINCT status) FILTER (WHERE status != 'COMPLETED') as other_statuses
        FROM payments
        WHERE organization_id = ${ORG_ID}::uuid
          AND DATE(created_at) > '2026-01-16'
        GROUP BY DATE(created_at)
      )
      SELECT 
        COUNT(*) as days_with_payments,
        SUM(completed_count) as total_completed,
        SUM(other_count) as total_other_status,
        COUNT(*) FILTER (WHERE completed_count = 0 AND other_count > 0) as days_with_only_non_completed
      FROM payment_summary
    `
    
    console.log(`   Days with payments after Jan 16: ${summary[0].days_with_payments}`)
    console.log(`   Total completed payments: ${summary[0].total_completed}`)
    console.log(`   Total other status payments: ${summary[0].total_other_status}`)
    console.log(`   Days with ONLY non-completed payments: ${summary[0].days_with_only_non_completed}`)

    console.log('\n' + '='.repeat(80))
    console.log('✅ Investigation completed!')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('\n❌ Error investigating:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

investigateMissingRevenue()

