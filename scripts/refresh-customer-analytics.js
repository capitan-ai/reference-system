require('dotenv').config()
const prisma = require('../lib/prisma-client')

/**
 * Refresh customer_analytics table
 * 
 * Modes:
 * - "full" — recalculate all customers (slow, for nightly backups)
 * - "recent" — update last 90 days (fast, for hourly cron)
 * - "org" — recalculate specific organization
 */
async function refreshCustomerAnalytics(mode = 'recent', organizationId = null) {
  console.log(`\n📊 Refreshing customer_analytics (mode: ${mode})...\n`)
  console.log('='.repeat(80))

  const startTime = Date.now()

  try {
    // Determine the time filter based on mode
    let dateFilter = mode === 'full' ? '' : "AND b.start_at >= now() - interval '90 days'"
    let orgFilter = organizationId ? `AND b.organization_id = '${organizationId}'::uuid` : ''

    // Main refresh query: calculate all aggregates
    const refreshSQL = `
WITH bookings_agg AS (
  -- Aggregate all booking metrics per customer
  SELECT
    b.organization_id,
    b.customer_id AS square_customer_id,
    
    MIN(b.start_at) FILTER (WHERE b.status = 'ACCEPTED') AS first_booking_at,
    MAX(b.start_at) FILTER (WHERE b.status = 'ACCEPTED') AS last_booking_at,
    
    COUNT(*) FILTER (WHERE b.status = 'ACCEPTED') AS total_accepted_bookings,
    COUNT(*) FILTER (WHERE b.status = 'CANCELLED_BY_CUSTOMER') AS total_cancelled_by_customer,
    COUNT(*) FILTER (WHERE b.status = 'CANCELLED_BY_SELLER') AS total_cancelled_by_seller,
    COUNT(*) FILTER (WHERE b.status = 'NO_SHOW') AS total_no_shows,
    
    -- Top technician (by booking count)
    (
      SELECT b2.technician_id
      FROM bookings b2
      WHERE b2.customer_id = b.customer_id
        AND b2.organization_id = b.organization_id
        AND b2.status = 'ACCEPTED'
        AND b2.technician_id IS NOT NULL
      GROUP BY b2.technician_id
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ) AS preferred_technician_id,
    
    -- Top service (by booking count)
    (
      SELECT b2.service_variation_id
      FROM bookings b2
      WHERE b2.customer_id = b.customer_id
        AND b2.organization_id = b.organization_id
        AND b2.status = 'ACCEPTED'
        AND b2.service_variation_id IS NOT NULL
      GROUP BY b2.service_variation_id
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ) AS preferred_service_variation_id,
    
    -- Distinct locations
    COUNT(DISTINCT b.location_id) FILTER (WHERE b.status = 'ACCEPTED') AS distinct_locations,
    
    -- Notes (JSONB array of booking notes)
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'booking_id', b.id,
        'start_at', b.start_at,
        'status', b.status,
        'customer_note', b.customer_note,
        'seller_note', b.seller_note,
        'technician_id', b.technician_id
      ) ORDER BY b.start_at DESC
    ) FILTER (WHERE b.customer_note IS NOT NULL OR b.seller_note IS NOT NULL) AS booking_notes
  
  FROM bookings b
  WHERE b.customer_id IS NOT NULL
    ${dateFilter}
    ${orgFilter}
  GROUP BY b.organization_id, b.customer_id
),
payments_agg AS (
  -- Aggregate all payment metrics per customer
  SELECT
    p.organization_id,
    p.customer_id AS square_customer_id,
    
    SUM(p.amount_money_amount) FILTER (WHERE p.status = 'COMPLETED') AS total_revenue_cents,
    SUM(p.tip_money_amount) FILTER (WHERE p.status = 'COMPLETED') AS total_tips_cents,
    COUNT(*) FILTER (WHERE p.status = 'COMPLETED') AS total_payments,
    MAX(p.created_at) FILTER (WHERE p.status = 'COMPLETED') AS last_payment_at
  
  FROM payments p
  WHERE p.customer_id IS NOT NULL
    ${dateFilter}
    ${orgFilter}
  GROUP BY p.organization_id, p.customer_id
),
referral_agg AS (
  -- Referral info (from referral_profiles or square_existing_clients)
  SELECT
    rp.organization_id,
    rp.square_customer_id,
    rp.used_referral_code AS referral_source,
    rp.activated_as_referrer AS is_referrer,
    rp.activated_at AS activated_as_referrer_at,
    rp.total_referrals_count AS total_referrals,
    rp.total_rewards_cents
  FROM referral_profiles rp
),
square_clients AS (
  -- Get customer personal data
  SELECT
    organization_id,
    square_customer_id,
    given_name,
    family_name,
    email_address,
    phone_number
  FROM square_existing_clients
),
merged_data AS (
  SELECT
    COALESCE(b.organization_id, p.organization_id, r.organization_id, sc.organization_id) AS organization_id,
    COALESCE(b.square_customer_id, p.square_customer_id, r.square_customer_id, sc.square_customer_id) AS square_customer_id,
    
    sc.given_name,
    sc.family_name,
    sc.email_address,
    sc.phone_number,
    
    b.first_booking_at,
    b.last_booking_at,
    p.last_payment_at,
    
    COALESCE(b.total_accepted_bookings, 0) AS total_accepted_bookings,
    COALESCE(b.total_cancelled_by_customer, 0) AS total_cancelled_by_customer,
    COALESCE(b.total_cancelled_by_seller, 0) AS total_cancelled_by_seller,
    COALESCE(b.total_no_shows, 0) AS total_no_shows,
    
    COALESCE(p.total_revenue_cents, 0) AS total_revenue_cents,
    COALESCE(p.total_tips_cents, 0) AS total_tips_cents,
    COALESCE(p.total_payments, 0) AS total_payments,
    CASE
      WHEN COALESCE(p.total_payments, 0) > 0
      THEN ROUND(COALESCE(p.total_revenue_cents, 0)::numeric / p.total_payments)::bigint
      ELSE 0
    END AS avg_ticket_cents,
    
    b.booking_notes,
    b.preferred_technician_id,
    b.preferred_service_variation_id,
    COALESCE(b.distinct_locations, 0) AS distinct_locations,
    
    COALESCE(r.is_referrer, false) AS is_referrer,
    r.activated_as_referrer_at,
    r.referral_source,
    COALESCE(r.total_referrals, 0) AS total_referrals,
    COALESCE(r.total_rewards_cents, 0) AS total_rewards_cents,
    
    -- Segment calculation
    CASE
      WHEN b.first_booking_at >= NOW() - INTERVAL '30 days' THEN 'NEW'
      WHEN b.last_booking_at >= NOW() - INTERVAL '30 days' THEN 'ACTIVE'
      WHEN b.last_booking_at >= NOW() - INTERVAL '90 days' THEN 'AT_RISK'
      ELSE 'LOST'
    END AS customer_segment
  
  FROM bookings_agg b
  FULL OUTER JOIN payments_agg p
    ON b.organization_id = p.organization_id
    AND b.square_customer_id = p.square_customer_id
  LEFT JOIN referral_agg r
    ON COALESCE(b.organization_id, p.organization_id) = r.organization_id
    AND COALESCE(b.square_customer_id, p.square_customer_id) = r.square_customer_id
  LEFT JOIN square_clients sc
    ON COALESCE(b.organization_id, p.organization_id, r.organization_id) = sc.organization_id
    AND COALESCE(b.square_customer_id, p.square_customer_id, r.square_customer_id) = sc.square_customer_id
)
INSERT INTO customer_analytics (
  organization_id,
  square_customer_id,
  given_name,
  family_name,
  email_address,
  phone_number,
  first_booking_at,
  last_booking_at,
  last_payment_at,
  total_accepted_bookings,
  total_cancelled_by_customer,
  total_cancelled_by_seller,
  total_no_shows,
  total_revenue_cents,
  total_tips_cents,
  total_payments,
  avg_ticket_cents,
  booking_notes,
  preferred_technician_id,
  preferred_service_variation_id,
  distinct_locations,
  is_referrer,
  activated_as_referrer_at,
  referral_source,
  total_referrals,
  total_rewards_cents,
  customer_segment,
  created_at,
  updated_at
)
SELECT *, NOW(), NOW() FROM merged_data
ON CONFLICT (organization_id, square_customer_id) DO UPDATE SET
  given_name = EXCLUDED.given_name,
  family_name = EXCLUDED.family_name,
  email_address = EXCLUDED.email_address,
  phone_number = EXCLUDED.phone_number,
  first_booking_at = EXCLUDED.first_booking_at,
  last_booking_at = EXCLUDED.last_booking_at,
  last_payment_at = EXCLUDED.last_payment_at,
  total_accepted_bookings = EXCLUDED.total_accepted_bookings,
  total_cancelled_by_customer = EXCLUDED.total_cancelled_by_customer,
  total_cancelled_by_seller = EXCLUDED.total_cancelled_by_seller,
  total_no_shows = EXCLUDED.total_no_shows,
  total_revenue_cents = EXCLUDED.total_revenue_cents,
  total_tips_cents = EXCLUDED.total_tips_cents,
  total_payments = EXCLUDED.total_payments,
  avg_ticket_cents = EXCLUDED.avg_ticket_cents,
  booking_notes = EXCLUDED.booking_notes,
  preferred_technician_id = EXCLUDED.preferred_technician_id,
  preferred_service_variation_id = EXCLUDED.preferred_service_variation_id,
  distinct_locations = EXCLUDED.distinct_locations,
  is_referrer = EXCLUDED.is_referrer,
  activated_as_referrer_at = EXCLUDED.activated_as_referrer_at,
  referral_source = EXCLUDED.referral_source,
  total_referrals = EXCLUDED.total_referrals,
  total_rewards_cents = EXCLUDED.total_rewards_cents,
  customer_segment = EXCLUDED.customer_segment,
  updated_at = NOW();
    `

    console.log('Executing refresh query...')
    const result = await prisma.$executeRawUnsafe(refreshSQL)
    
    const elapsed = Date.now() - startTime
    console.log(`✅ Refresh completed in ${(elapsed / 1000).toFixed(2)}s`)
    console.log(`   Mode: ${mode}`)
    if (organizationId) console.log(`   Organization: ${organizationId}`)
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error during refresh:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Parse command-line arguments
const mode = process.argv[2] || 'recent' // 'full' | 'recent'
const orgId = process.argv[3] || null

refreshCustomerAnalytics(mode, orgId)

