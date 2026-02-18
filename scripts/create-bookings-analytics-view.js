#!/usr/bin/env node
/**
 * Create or update analytics view for bookings/appointments
 * This should show bookings count, not just payments
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function createBookingsAnalyticsView() {
  console.log('🔧 Creating/Updating Bookings Analytics View...\n')
  console.log('='.repeat(80))

  try {
    // Check if view exists
    const viewExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.views 
        WHERE table_name = 'analytics_appointments_by_location_daily'
      ) as exists
    `

    if (viewExists[0].exists) {
      console.log('View exists, dropping and recreating...')
      await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS analytics_appointments_by_location_daily CASCADE;`)
    } else {
      console.log('View does not exist, creating...')
    }

    // Create/update the bookings analytics view
    const createViewSQL = `
-- ============================================================================
-- ANALYTICS APPOINTMENTS BY LOCATION DAILY VIEW
-- Shows bookings/appointments by location and date (Pacific timezone)
-- ============================================================================

CREATE OR REPLACE VIEW analytics_appointments_by_location_daily AS
WITH booking_dates AS (
  SELECT
    b.organization_id,
    b.location_id,
    b.customer_id,
    b.status,
    DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as booking_date_pacific
  FROM bookings b
),
customer_dates AS (
  SELECT
    c.organization_id,
    c.square_customer_id,
    DATE(c.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as customer_created_date_pacific
  FROM square_existing_clients c
  WHERE c.created_at IS NOT NULL
)
SELECT
  bd.organization_id,
  bd.location_id,
  l.name as location_name,
  bd.booking_date_pacific as date,
  COUNT(*) FILTER (WHERE bd.status = 'ACCEPTED') as appointments_count,
  COUNT(*) FILTER (WHERE bd.status = 'ACCEPTED') as accepted_appointments,
  COUNT(*) FILTER (WHERE bd.status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER')) as cancelled_appointments,
  COUNT(*) FILTER (WHERE bd.status = 'NO_SHOW') as no_show_appointments,
  COUNT(*) FILTER (WHERE bd.status = 'CANCELLED_BY_CUSTOMER') as cancelled_by_customer,
  COUNT(*) FILTER (WHERE bd.status = 'CANCELLED_BY_SELLER') as cancelled_by_seller,
  COUNT(DISTINCT bd.customer_id) FILTER (WHERE bd.customer_id IS NOT NULL AND bd.status = 'ACCEPTED') as unique_customers,
  COUNT(DISTINCT bd.customer_id) FILTER (
    WHERE bd.customer_id IS NOT NULL 
    AND bd.status = 'ACCEPTED'
    AND cd.customer_created_date_pacific = bd.booking_date_pacific
  ) as new_customers
FROM booking_dates bd
INNER JOIN locations l 
  ON bd.location_id = l.id
  AND bd.organization_id = l.organization_id
LEFT JOIN customer_dates cd
  ON bd.customer_id = cd.square_customer_id
  AND bd.organization_id = cd.organization_id
GROUP BY bd.organization_id, bd.location_id, l.name, bd.booking_date_pacific;
    `

    await prisma.$executeRawUnsafe(createViewSQL)
    console.log('✅ View created/updated successfully')

    // Verify the view
    console.log('\n\n🔍 Verifying bookings analytics view...')
    console.log('-'.repeat(80))

    const orgId = 'd0e24178-2f94-4033-bc91-41f22df58278'

    // Check Feb 2 and Feb 3 data
    const bookingsData = await prisma.$queryRaw`
      SELECT 
        date,
        location_name,
        appointments_count,
        accepted_appointments,
        cancelled_by_customer,
        cancelled_by_seller,
        unique_customers,
        new_customers
      FROM analytics_appointments_by_location_daily
      WHERE organization_id = ${orgId}::uuid
        AND date IN ('2026-02-02'::date, '2026-02-03'::date, '2026-02-04'::date)
      ORDER BY date, location_name
    `

    console.log('\nBookings Analytics View Data:')
    bookingsData.forEach(bd => {
      console.log(`\n${bd.date} - ${bd.location_name}:`)
      console.log(`  Total appointments: ${bd.appointments_count}`)
      console.log(`  Accepted: ${bd.accepted_appointments}`)
      console.log(`  Cancelled by customer: ${bd.cancelled_by_customer || 0}`)
      console.log(`  Cancelled by seller: ${bd.cancelled_by_seller || 0}`)
      console.log(`  Unique customers: ${bd.unique_customers || 0}`)
      console.log(`  New customers: ${bd.new_customers || 0}`)
    })

    // Compare with revenue view
    console.log('\n\n📊 Comparison: Bookings vs Payments:')
    console.log('-'.repeat(80))
    
    const comparison = await prisma.$queryRaw`
      SELECT 
        COALESCE(a.date, r.date) as date,
        COALESCE(a.location_name, r.location_name) as location_name,
        a.accepted_appointments,
        r.payment_count,
        r.revenue_dollars
      FROM analytics_appointments_by_location_daily a
      FULL OUTER JOIN analytics_revenue_by_location_daily r 
        ON a.date = r.date 
        AND a.location_name = r.location_name
        AND a.organization_id = r.organization_id
      WHERE COALESCE(a.organization_id, r.organization_id) = ${orgId}::uuid
        AND COALESCE(a.date, r.date) IN ('2026-02-02'::date, '2026-02-03'::date, '2026-02-04'::date)
      ORDER BY date, location_name
    `

    console.log('\nDate | Location | Accepted Bookings | Payments | Revenue')
    console.log('-'.repeat(80))
    comparison.forEach(c => {
      const revenue = Number(c.revenue_dollars || 0).toFixed(2)
      console.log(`${c.date} | ${c.location_name} | ${c.accepted_appointments || 0} | ${c.payment_count || 0} | $${revenue}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('✅ Bookings analytics view created/updated!')
    console.log('='.repeat(80))
    console.log('\nNote: This view shows BOOKINGS/APPOINTMENTS, not payments.')
    console.log('      Use analytics_revenue_by_location_daily for payment data.')

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

createBookingsAnalyticsView()

