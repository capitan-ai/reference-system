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

    // Create/update the bookings analytics view (same logic as update-analytics-appointments-view.js)
    const createViewSQL = `
-- ============================================================================
-- ANALYTICS APPOINTMENTS BY LOCATION DAILY VIEW
-- Keep in sync with scripts/update-analytics-appointments-view.js
-- new_customers: COALESCE(sec.first_visit_at, MIN bookings ACCEPTED|COMPLETED), Pacific date — see docs/NEW_CUSTOMERS_FIRST_VISIT_AT.md
-- ============================================================================

CREATE OR REPLACE VIEW analytics_appointments_by_location_daily AS
WITH booking_base AS (
  SELECT
    b.id,
    b.organization_id,
    b.location_id,
    b.customer_id,
    b.status,
    b.start_at,
    b.version,
    b.updated_at,
    CASE
      WHEN b.booking_id ~ '^[a-z0-9]+-[A-Z0-9]{20,}$'
        THEN split_part(b.booking_id, '-', 1)
      ELSE b.booking_id
    END AS square_booking_base_id,
    EXISTS (
      SELECT 1
      FROM booking_segments bs
      WHERE bs.booking_id = b.id
        AND bs.is_active = true
    ) AS has_active_segment_rank
  FROM bookings b
),
booking_ranked AS (
  SELECT
    bb.*,
    ROW_NUMBER() OVER (
      PARTITION BY bb.organization_id, bb.square_booking_base_id
      ORDER BY bb.version DESC, bb.has_active_segment_rank DESC, bb.updated_at DESC
    ) AS rn
  FROM booking_base bb
),
booking_canonical AS (
  SELECT
    br.organization_id,
    br.location_id,
    br.customer_id,
    br.status,
    br.start_at,
    EXISTS (
      SELECT 1
      FROM booking_segments bs
      WHERE bs.booking_id = br.id
        AND bs.is_active = true
    ) AS has_active_segment
  FROM booking_ranked br
  WHERE br.rn = 1
),
booking_dates AS (
  SELECT
    organization_id,
    location_id,
    customer_id,
    status,
    DATE((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles') AS booking_date_pacific,
    has_active_segment
  FROM booking_canonical
),
customer_first_visit_effective AS (
  SELECT
    sec.organization_id,
    sec.square_customer_id AS customer_id,
    COALESCE(
      sec.first_visit_at,
      (
        SELECT MIN(b.start_at) AT TIME ZONE 'UTC'
        FROM bookings b
        WHERE b.organization_id = sec.organization_id
          AND b.customer_id = sec.square_customer_id
          AND b.customer_id IS NOT NULL
          AND b.status IN ('ACCEPTED', 'COMPLETED')
      )
    ) AS first_visit_effective_at
  FROM square_existing_clients sec
),
per_location AS (
  SELECT
    bd.organization_id,
    bd.location_id,
    l.name AS location_name,
    bd.booking_date_pacific,
    COUNT(*) FILTER (WHERE bd.status = 'ACCEPTED' AND bd.has_active_segment) AS canon_accept,
    COUNT(*) FILTER (WHERE bd.status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER')) AS canon_cancelled,
    COUNT(*) FILTER (WHERE bd.status = 'NO_SHOW') AS canon_no_show,
    COUNT(*) FILTER (WHERE bd.status = 'CANCELLED_BY_CUSTOMER') AS canon_cust_cancel,
    COUNT(*) FILTER (WHERE bd.status = 'CANCELLED_BY_SELLER') AS canon_seller_cancel,
    COUNT(DISTINCT bd.customer_id) FILTER (WHERE bd.customer_id IS NOT NULL AND bd.status = 'ACCEPTED' AND bd.has_active_segment) AS canon_unique,
    COUNT(DISTINCT bd.customer_id) FILTER (
      WHERE bd.customer_id IS NOT NULL
        AND bd.status = 'ACCEPTED'
        AND bd.has_active_segment
        AND fv.first_visit_effective_at IS NOT NULL
        AND DATE(fv.first_visit_effective_at AT TIME ZONE 'America/Los_Angeles') = bd.booking_date_pacific
    ) AS canon_new
  FROM booking_dates bd
  INNER JOIN locations l ON bd.location_id = l.id AND bd.organization_id = l.organization_id
  LEFT JOIN customer_first_visit_effective fv
    ON bd.organization_id = fv.organization_id AND bd.customer_id = fv.customer_id
  GROUP BY bd.organization_id, bd.location_id, l.name, bd.booking_date_pacific
),
org_day_total AS (
  SELECT organization_id, booking_date_pacific, SUM(canon_accept)::bigint AS total_accept
  FROM per_location
  GROUP BY organization_id, booking_date_pacific
),
union_raw AS (
  SELECT
    b.organization_id,
    DATE((b.start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles') AS booking_date_pacific,
    COUNT(*)::bigint AS raw_union_accept
  FROM bookings b
  INNER JOIN locations lu ON lu.id = b.location_id AND lu.organization_id = b.organization_id
  WHERE b.status = 'ACCEPTED'
    AND lu.name ILIKE '%Union St%'
  GROUP BY b.organization_id, DATE((b.start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')
),
org_loc_count AS (
  SELECT organization_id, COUNT(*)::int AS nloc
  FROM locations
  GROUP BY organization_id
)
SELECT
  pla.organization_id,
  pla.location_id,
  pla.location_name,
  pla.booking_date_pacific AS date,
  CASE
    WHEN pla.location_name ILIKE '%Union St%'
      THEN COALESCE(ur.raw_union_accept, 0)::bigint
    WHEN pla.location_name ILIKE '%Pacific Ave%'
      AND COALESCE(olc.nloc, 0) = 2
      THEN GREATEST(0, COALESCE(odt.total_accept, 0) - COALESCE(ur.raw_union_accept, 0))::bigint
    ELSE pla.canon_accept
  END::bigint AS appointments_count,
  CASE
    WHEN pla.location_name ILIKE '%Union St%'
      THEN COALESCE(ur.raw_union_accept, 0)::bigint
    WHEN pla.location_name ILIKE '%Pacific Ave%'
      AND COALESCE(olc.nloc, 0) = 2
      THEN GREATEST(0, COALESCE(odt.total_accept, 0) - COALESCE(ur.raw_union_accept, 0))::bigint
    ELSE pla.canon_accept
  END::bigint AS accepted_appointments,
  pla.canon_cancelled::bigint AS cancelled_appointments,
  pla.canon_no_show::bigint AS no_show_appointments,
  pla.canon_cust_cancel::bigint AS cancelled_by_customer,
  pla.canon_seller_cancel::bigint AS cancelled_by_seller,
  pla.canon_unique::bigint AS unique_customers,
  pla.canon_new::bigint AS new_customers
FROM per_location pla
LEFT JOIN org_day_total odt
  ON odt.organization_id = pla.organization_id AND odt.booking_date_pacific = pla.booking_date_pacific
LEFT JOIN union_raw ur
  ON ur.organization_id = pla.organization_id AND ur.booking_date_pacific = pla.booking_date_pacific
LEFT JOIN org_loc_count olc ON olc.organization_id = pla.organization_id;
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

