require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function runSanityChecks() {
  console.log('\n✅ SANITY CHECKS FOR CUSTOMER_ANALYTICS\n')
  console.log('='.repeat(80))

  try {
    // Check 1: Table exists
    console.log('\n📋 Check 1: Verify customer_analytics table exists...')
    const tableCheck = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'customer_analytics'
      ) as exists
    `
    if (tableCheck[0].exists) {
      console.log('✅ Table exists')
    } else {
      console.log('❌ Table does not exist')
      return
    }

    // Check 2: Row count
    console.log('\n📋 Check 2: Count records in customer_analytics...')
    const rowCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM customer_analytics
    `
    console.log(`✅ Total records: ${rowCount[0].count}`)

    // Check 3: Sample data
    console.log('\n📋 Check 3: Sample customer record...')
    const sampleRecord = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        first_booking_at,
        total_accepted_bookings,
        total_revenue_cents::text as total_revenue_cents,
        avg_ticket_cents::text as avg_ticket_cents,
        customer_segment
      FROM customer_analytics
      LIMIT 1
    `
    if (sampleRecord.length > 0) {
      console.log('✅ Sample record:')
      console.log(JSON.stringify(sampleRecord[0], null, 2))
    } else {
      console.log('⚠️ No records found yet')
    }

    // Check 4: Segment distribution
    console.log('\n📋 Check 4: Customer segment distribution...')
    const segments = await prisma.$queryRaw`
      SELECT 
        customer_segment,
        COUNT(*) as count,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as pct,
        ROUND(AVG(total_revenue_cents) / 100.0, 2) as avg_revenue
      FROM customer_analytics
      GROUP BY customer_segment
      ORDER BY count DESC
    `
    console.log('✅ Segment distribution:')
    console.table(segments)

    // Check 5: avg_ticket calculations
    console.log('\n📋 Check 5: Verify avg_ticket_cents calculations (sample)...')
    const avgTicketCheck = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        total_revenue_cents,
        total_payments,
        avg_ticket_cents as stored_avg,
        CASE 
          WHEN total_payments > 0 
          THEN (total_revenue_cents::numeric / total_payments)
          ELSE 0 
        END AS calculated_avg,
        CASE 
          WHEN total_payments > 0 AND 
               ABS((total_revenue_cents::numeric / total_payments) - avg_ticket_cents) < 1 THEN '✅'
          ELSE '❌'
        END as check_pass
      FROM customer_analytics
      WHERE total_payments > 0
      LIMIT 5
    `
    console.log('✅ avg_ticket verification:')
    console.table(avgTicketCheck)

    // Check 6: first_booking_at correctness
    console.log('\n📋 Check 6: Verify first_booking_at is correct (sample mismatch check)...')
    const firstBookingCheck = await prisma.$queryRaw`
      SELECT 
        ca.square_customer_id,
        ca.first_booking_at as analytics_first,
        MIN(b.start_at) FILTER (WHERE b.status = 'ACCEPTED') as calculated_first,
        CASE 
          WHEN ca.first_booking_at = MIN(b.start_at) FILTER (WHERE b.status = 'ACCEPTED') THEN '✅'
          ELSE '❌'
        END as match
      FROM customer_analytics ca
      LEFT JOIN bookings b
        ON ca.organization_id = b.organization_id
        AND ca.square_customer_id = b.customer_id
      GROUP BY ca.square_customer_id, ca.first_booking_at
      HAVING ca.first_booking_at != MIN(b.start_at) FILTER (WHERE b.status = 'ACCEPTED')
      LIMIT 10
    `
    if (firstBookingCheck.length === 0) {
      console.log('✅ All first_booking_at values are correct (no mismatches)')
    } else {
      console.log('⚠️ Found mismatches in first_booking_at:')
      console.table(firstBookingCheck)
    }

    // Check 7: Referral data
    console.log('\n📋 Check 7: Referral customers...')
    const referralData = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_referrer = true) as referrers,
        COUNT(*) FILTER (WHERE referral_source IS NOT NULL) as came_via_referral,
        ROUND(100.0 * COUNT(*) FILTER (WHERE is_referrer = true) / NULLIF(COUNT(*), 0), 1) as referrer_pct
      FROM customer_analytics
    `
    console.log('✅ Referral stats:')
    console.table(referralData)

    // Check 8: VIEW works correctly
    console.log('\n📋 Check 8: Verify analytics_appointments_by_location_daily VIEW...')
    const viewData = await prisma.$queryRaw`
      SELECT 
        date,
        unique_customers,
        new_customers,
        ROUND(100.0 * new_customers / NULLIF(unique_customers, 0), 1) as new_pct
      FROM analytics_appointments_by_location_daily
      ORDER BY date DESC
      LIMIT 5
    `
    if (viewData.length > 0) {
      console.log('✅ VIEW data (latest 5 days):')
      console.table(viewData)
    } else {
      console.log('⚠️ No data in VIEW yet')
    }

    console.log('\n' + '='.repeat(80))
    console.log('✅ All sanity checks completed!\n')

  } catch (error) {
    console.error('❌ Error during sanity checks:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runSanityChecks()

