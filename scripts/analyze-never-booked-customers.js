#!/usr/bin/env node
/**
 * Analyze Customers Who Never Booked
 * Compares customers who never booked with those who had cancellations or refunds
 * 
 * Usage:
 *   node scripts/analyze-never-booked-customers.js
 *   node scripts/analyze-never-booked-customers.js --detailed
 *   node scripts/analyze-never-booked-customers.js --export
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const showDetailed = args.includes('--detailed')
const exportData = args.includes('--export')

function formatNumber(num) {
  return num ? Number(num).toLocaleString() : '0'
}

function formatDate(date) {
  if (!date) return 'N/A'
  try {
    return new Date(date).toISOString().split('T')[0]
  } catch {
    return 'N/A'
  }
}

async function analyzeNeverBookedCustomers() {
  console.log('🔍 Analyzing Customers Who Never Booked\n')
  console.log('='.repeat(80))
  console.log('Comparing with cancellations and refunds\n')
  console.log('='.repeat(80))

  try {
    // ============================================
    // SUMMARY STATISTICS
    // ============================================
    console.log('\n📊 SUMMARY STATISTICS')
    console.log('-'.repeat(80))

    const summary = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_customers,
        
        -- Never booked (any bookings)
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM bookings b WHERE b.customer_id = square_existing_clients.square_customer_id
          )
        )::int as never_booked,
        
        -- Never booked but has payments (walk-ins)
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM bookings b WHERE b.customer_id = square_existing_clients.square_customer_id
          )
          AND EXISTS (
            SELECT 1 FROM payments p WHERE p.customer_id = square_existing_clients.square_customer_id
          )
        )::int as never_booked_has_payments,
        
        -- Never booked, no payments
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM bookings b WHERE b.customer_id = square_existing_clients.square_customer_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM payments p WHERE p.customer_id = square_existing_clients.square_customer_id
          )
        )::int as never_booked_no_payments,
        
        -- Booked but all cancelled
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM bookings b WHERE b.customer_id = square_existing_clients.square_customer_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM bookings b 
            WHERE b.customer_id = square_existing_clients.square_customer_id 
            AND b.status != 'CANCELLED'
          )
        )::int as booked_all_cancelled,
        
        -- Has refunded payments
        COUNT(DISTINCT p.customer_id) FILTER (
          WHERE array_length(p.refund_ids, 1) > 0 OR p.status = 'REFUNDED'
        )::int as has_refunded_payments
        
      FROM square_existing_clients
      LEFT JOIN payments p ON p.customer_id = square_existing_clients.square_customer_id
      GROUP BY square_existing_clients.square_customer_id
    `

    // Get total counts (simpler query)
    const totalStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_customers,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM bookings b WHERE b.customer_id = square_existing_clients.square_customer_id
          )
        )::int as never_booked
      FROM square_existing_clients
    `

    const totalCustomers = totalStats[0]?.total_customers || 0
    const neverBooked = totalStats[0]?.never_booked || 0

    const refundStats = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT customer_id)::int as customers_with_refunds
      FROM payments
      WHERE array_length(refund_ids, 1) > 0 OR status = 'REFUNDED'
    `

    const cancelledStats = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT customer_id)::int as customers_all_cancelled
      FROM square_existing_clients sec
      WHERE EXISTS (
        SELECT 1 FROM bookings b WHERE b.customer_id = sec.square_customer_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings b 
        WHERE b.customer_id = sec.square_customer_id 
        AND b.status != 'CANCELLED'
      )
    `

    const walkInStats = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT sec.square_customer_id)::int as walk_ins
      FROM square_existing_clients sec
      WHERE NOT EXISTS (
        SELECT 1 FROM bookings b WHERE b.customer_id = sec.square_customer_id
      )
      AND EXISTS (
        SELECT 1 FROM payments p WHERE p.customer_id = sec.square_customer_id
      )
    `

    console.log(`   Total Customers:              ${formatNumber(totalCustomers)}`)
    console.log(`   Never Booked:                 ${formatNumber(neverBooked)} (${((neverBooked / totalCustomers) * 100).toFixed(1)}%)`)
    console.log(`   ├─ With Payments (Walk-ins): ${formatNumber(walkInStats[0]?.walk_ins || 0)}`)
    console.log(`   └─ No Payments:               ${formatNumber(neverBooked - (walkInStats[0]?.walk_ins || 0))}`)
    console.log(`   Booked (All Cancelled):       ${formatNumber(cancelledStats[0]?.customers_all_cancelled || 0)}`)
    console.log(`   Has Refunded Payments:        ${formatNumber(refundStats[0]?.customers_with_refunds || 0)}`)

    // ============================================
    // DETAILED BREAKDOWN
    // ============================================
    console.log('\n\n📋 DETAILED BREAKDOWN')
    console.log('-'.repeat(80))

    const detailedBreakdown = await prisma.$queryRaw`
      WITH customer_stats AS (
        SELECT 
          sec.square_customer_id,
          sec.given_name,
          sec.family_name,
          sec.email_address,
          sec.phone_number,
          sec.created_at,
          sec.first_payment_completed,
          sec.got_signup_bonus,
          sec.activated_as_referrer,
          
          -- Booking counts
          COUNT(DISTINCT b.id) FILTER (WHERE b.id IS NOT NULL) as total_bookings,
          COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'CANCELLED') as cancelled_bookings,
          COUNT(DISTINCT b.id) FILTER (WHERE b.status != 'CANCELLED' AND b.id IS NOT NULL) as active_bookings,
          
          -- Payment counts
          COUNT(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL) as total_payments,
          COUNT(DISTINCT p.id) FILTER (WHERE array_length(p.refund_ids, 1) > 0) as payments_with_refunds,
          COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'REFUNDED') as refunded_payments,
          
          -- Refund amount
          SUM(p.total_money_amount) FILTER (WHERE array_length(p.refund_ids, 1) > 0 OR p.status = 'REFUNDED') as total_refunded_cents
          
        FROM square_existing_clients sec
        LEFT JOIN bookings b ON b.customer_id = sec.square_customer_id
        LEFT JOIN payments p ON p.customer_id = sec.square_customer_id
        GROUP BY sec.square_customer_id, sec.given_name, sec.family_name, 
                 sec.email_address, sec.phone_number, sec.created_at, 
                 sec.first_payment_completed, sec.got_signup_bonus, sec.activated_as_referrer
      )
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE total_bookings = 0)::int as never_booked,
        COUNT(*) FILTER (WHERE total_bookings > 0 AND active_bookings = 0 AND cancelled_bookings > 0)::int as booked_all_cancelled,
        COUNT(*) FILTER (WHERE active_bookings > 0)::int as has_active_bookings,
        COUNT(*) FILTER (WHERE payments_with_refunds > 0 OR refunded_payments > 0)::int as has_refunds,
        COUNT(*) FILTER (WHERE total_bookings = 0 AND total_payments > 0)::int as never_booked_has_payments,
        COUNT(*) FILTER (WHERE total_bookings = 0 AND total_payments = 0)::int as never_booked_no_payments,
        COUNT(*) FILTER (WHERE cancelled_bookings > 0 AND active_bookings > 0)::int as has_cancellations_and_active
      FROM customer_stats
    `

    if (detailedBreakdown && detailedBreakdown.length > 0) {
      const stats = detailedBreakdown[0]
      console.log(`   Total Customers Analyzed:        ${formatNumber(stats.total)}`)
      console.log(`   Never Booked:                    ${formatNumber(stats.never_booked)}`)
      console.log(`   ├─ With Payments (Walk-ins):     ${formatNumber(stats.never_booked_has_payments)}`)
      console.log(`   └─ No Payments:                  ${formatNumber(stats.never_booked_no_payments)}`)
      console.log(`   Booked (All Cancelled):          ${formatNumber(stats.booked_all_cancelled)}`)
      console.log(`   Has Active Bookings:              ${formatNumber(stats.has_active_bookings)}`)
      console.log(`   Has Refunds:                     ${formatNumber(stats.has_refunds)}`)
      console.log(`   Has Cancellations + Active:      ${formatNumber(stats.has_cancellations_and_active)}`)
    }

    // ============================================
    // CANCELLATION ANALYSIS
    // ============================================
    console.log('\n\n🚫 CANCELLATION ANALYSIS')
    console.log('-'.repeat(80))

    const cancellationStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_bookings,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')::int as cancelled_bookings,
        COUNT(*) FILTER (WHERE status != 'CANCELLED')::int as active_bookings,
        COUNT(DISTINCT customer_id) FILTER (WHERE status = 'CANCELLED')::int as customers_with_cancellations
      FROM bookings
      WHERE customer_id IS NOT NULL
    `

    if (cancellationStats && cancellationStats.length > 0) {
      const stats = cancellationStats[0]
      const cancellationRate = stats.total_bookings > 0 
        ? ((stats.cancelled_bookings / stats.total_bookings) * 100).toFixed(1)
        : '0.0'
      
      console.log(`   Total Bookings:                  ${formatNumber(stats.total_bookings)}`)
      console.log(`   Cancelled Bookings:              ${formatNumber(stats.cancelled_bookings)} (${cancellationRate}%)`)
      console.log(`   Active Bookings:                 ${formatNumber(stats.active_bookings)}`)
      console.log(`   Customers with Cancellations:    ${formatNumber(stats.customers_with_cancellations)}`)
    }

    // ============================================
    // REFUND ANALYSIS
    // ============================================
    console.log('\n\n💰 REFUND ANALYSIS')
    console.log('-'.repeat(80))

    const refundAnalysis = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::int as total_payments,
        COUNT(*) FILTER (WHERE array_length(refund_ids, 1) > 0)::int as payments_with_refunds,
        COUNT(*) FILTER (WHERE status = 'REFUNDED')::int as refunded_status,
        COUNT(DISTINCT customer_id) FILTER (WHERE array_length(refund_ids, 1) > 0 OR status = 'REFUNDED')::int as customers_with_refunds,
        SUM(total_money_amount) FILTER (WHERE array_length(refund_ids, 1) > 0 OR status = 'REFUNDED')::bigint as total_refunded_cents
      FROM payments
      WHERE customer_id IS NOT NULL
    `

    if (refundAnalysis && refundAnalysis.length > 0) {
      const stats = refundAnalysis[0]
      const refundRate = stats.total_payments > 0
        ? ((stats.payments_with_refunds / stats.total_payments) * 100).toFixed(1)
        : '0.0'
      const totalRefunded = stats.total_refunded_cents 
        ? `$${((Number(stats.total_refunded_cents) || 0) / 100).toFixed(2)}`
        : '$0.00'
      
      console.log(`   Total Payments:                  ${formatNumber(stats.total_payments)}`)
      console.log(`   Payments with Refunds:           ${formatNumber(stats.payments_with_refunds)} (${refundRate}%)`)
      console.log(`   Payments (Status: REFUNDED):     ${formatNumber(stats.refunded_status)}`)
      console.log(`   Customers with Refunds:          ${formatNumber(stats.customers_with_refunds)}`)
      console.log(`   Total Refunded Amount:           ${totalRefunded}`)
    }

    // ============================================
    // DETAILED CUSTOMER LIST (if requested)
    // ============================================
    if (showDetailed || exportData) {
      console.log('\n\n📝 DETAILED CUSTOMER LIST')
      console.log('-'.repeat(80))

      const detailedCustomers = await prisma.$queryRaw`
        SELECT 
          sec.square_customer_id,
          sec.given_name,
          sec.family_name,
          sec.email_address,
          sec.phone_number,
          sec.created_at,
          sec.first_payment_completed,
          sec.got_signup_bonus,
          sec.activated_as_referrer,
          
          -- Booking info
          COUNT(DISTINCT b.id) as total_bookings,
          COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'CANCELLED') as cancelled_bookings,
          COUNT(DISTINCT b.id) FILTER (WHERE b.status != 'CANCELLED' AND b.id IS NOT NULL) as active_bookings,
          
          -- Payment info
          COUNT(DISTINCT p.id) as total_payments,
          COUNT(DISTINCT p.id) FILTER (WHERE array_length(p.refund_ids, 1) > 0) as payments_with_refunds,
          COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'REFUNDED') as refunded_payments,
          
          -- Categories
          CASE 
            WHEN COUNT(DISTINCT b.id) = 0 AND COUNT(DISTINCT p.id) = 0 THEN 'Never booked, no payments'
            WHEN COUNT(DISTINCT b.id) = 0 AND COUNT(DISTINCT p.id) > 0 THEN 'Never booked, has payments (walk-in)'
            WHEN COUNT(DISTINCT b.id) > 0 AND COUNT(DISTINCT b.id) FILTER (WHERE b.status != 'CANCELLED') = 0 THEN 'Booked but all cancelled'
            WHEN COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'CANCELLED') > 0 THEN 'Has cancelled bookings'
            ELSE 'Has active bookings'
          END as customer_category
          
        FROM square_existing_clients sec
        LEFT JOIN bookings b ON b.customer_id = sec.square_customer_id
        LEFT JOIN payments p ON p.customer_id = sec.square_customer_id
        GROUP BY sec.square_customer_id, sec.given_name, sec.family_name, 
                 sec.email_address, sec.phone_number, sec.created_at, 
                 sec.first_payment_completed, sec.got_signup_bonus, sec.activated_as_referrer
        HAVING COUNT(DISTINCT b.id) = 0  -- Only customers who never booked
        ORDER BY sec.created_at DESC
        LIMIT 100
      `

      if (detailedCustomers && detailedCustomers.length > 0) {
        console.log(`\n   Showing first ${detailedCustomers.length} customers who never booked:\n`)
        
        detailedCustomers.forEach((customer, idx) => {
          const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
          console.log(`   ${idx + 1}. ${name}`)
          console.log(`      ID: ${customer.square_customer_id}`)
          console.log(`      Email: ${customer.email_address || 'N/A'}`)
          console.log(`      Phone: ${customer.phone_number || 'N/A'}`)
          console.log(`      Created: ${formatDate(customer.created_at)}`)
          console.log(`      Category: ${customer.customer_category}`)
          console.log(`      Payments: ${customer.total_payments || 0}`)
          console.log(`      First Payment: ${customer.first_payment_completed ? 'Yes' : 'No'}`)
          console.log(`      Signup Bonus: ${customer.got_signup_bonus ? 'Yes' : 'No'}`)
          console.log(`      Activated Referrer: ${customer.activated_as_referrer ? 'Yes' : 'No'}`)
          console.log('')
        })

        // Export to JSON if requested
        if (exportData) {
          const exportPath = path.join(__dirname, '..', 'reports', 'never-booked-customers.json')
          const exportDir = path.dirname(exportPath)
          
          if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true })
          }

          const exportData = {
            generated_at: new Date().toISOString(),
            summary: {
              total_customers: totalCustomers,
              never_booked: neverBooked,
              never_booked_percentage: ((neverBooked / totalCustomers) * 100).toFixed(1),
              walk_ins: walkInStats[0]?.walk_ins || 0,
              never_booked_no_payments: neverBooked - (walkInStats[0]?.walk_ins || 0),
              booked_all_cancelled: cancelledStats[0]?.customers_all_cancelled || 0,
              customers_with_refunds: refundStats[0]?.customers_with_refunds || 0
            },
            customers: detailedCustomers.map(c => ({
              square_customer_id: c.square_customer_id,
              name: `${c.given_name || ''} ${c.family_name || ''}`.trim() || 'Unknown',
              email: c.email_address,
              phone: c.phone_number,
              created_at: c.created_at?.toISOString(),
              customer_category: c.customer_category,
              total_payments: Number(c.total_payments || 0),
              payments_with_refunds: Number(c.payments_with_refunds || 0),
              refunded_payments: Number(c.refunded_payments || 0),
              first_payment_completed: c.first_payment_completed,
              got_signup_bonus: c.got_signup_bonus,
              activated_as_referrer: c.activated_as_referrer
            }))
          }

          fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2))
          console.log(`\n✅ Data exported to: ${exportPath}`)
        }
      } else {
        console.log('   No customers found who never booked')
      }
    }

    // ============================================
    // FINAL SUMMARY
    // ============================================
    console.log('\n' + '='.repeat(80))
    console.log('✅ ANALYSIS COMPLETE')
    console.log('='.repeat(80))
    console.log(`\n   Total Customers: ${formatNumber(totalCustomers)}`)
    console.log(`   Never Booked: ${formatNumber(neverBooked)} (${((neverBooked / totalCustomers) * 100).toFixed(1)}%)`)
    console.log(`   ├─ Walk-ins (has payments): ${formatNumber(walkInStats[0]?.walk_ins || 0)}`)
    console.log(`   └─ No activity: ${formatNumber(neverBooked - (walkInStats[0]?.walk_ins || 0))}`)
    console.log(`\n   Booked but All Cancelled: ${formatNumber(cancelledStats[0]?.customers_all_cancelled || 0)}`)
    console.log(`   Customers with Refunds: ${formatNumber(refundStats[0]?.customers_with_refunds || 0)}`)

  } catch (error) {
    console.error('\n❌ Analysis failed:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

analyzeNeverBookedCustomers()



