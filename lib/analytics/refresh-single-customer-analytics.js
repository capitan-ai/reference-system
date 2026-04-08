const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Refresh customer_analytics for a single customer (after booking.updated webhook).
 * Recalculates first_visit_at, customer_segment, acceptance counts, etc. in real-time.
 *
 * @param {string} organizationId - UUID of organization
 * @param {string} squareCustomerId - Square customer ID
 * @returns {Promise<void>}
 */
async function refreshCustomerAnalyticsForSingleCustomer(
  organizationId,
  squareCustomerId
) {
  if (!organizationId || !squareCustomerId) {
    throw new Error('organizationId and squareCustomerId are required');
  }

  // Run per-customer analytics refresh SQL
  await prisma.$executeRaw`
WITH
-- 0. Email and Phone based ID mapping for deduplication
normalized_clients AS (
  SELECT
    square_customer_id,
    organization_id,
    created_at,
    email_address,
    CASE
      WHEN phone_number LIKE '+1%' THEN SUBSTRING(phone_number FROM 3)
      WHEN phone_number LIKE '1%' AND LENGTH(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')) = 11
        THEN SUBSTRING(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g') FROM 2)
      ELSE REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')
    END as normalized_phone
  FROM square_existing_clients
  WHERE organization_id = ${organizationId}::uuid
    AND (email_address IS NOT NULL AND email_address != ''
         OR phone_number IS NOT NULL AND phone_number != '')
),

phone_canonical AS (
  SELECT
    square_customer_id,
    FIRST_VALUE(square_customer_id) OVER (
      PARTITION BY normalized_phone, organization_id
      ORDER BY created_at ASC
    ) as phone_canonical_id
  FROM normalized_clients
  WHERE normalized_phone IS NOT NULL AND normalized_phone != ''
),

email_canonical AS (
  SELECT
    square_customer_id,
    FIRST_VALUE(square_customer_id) OVER (
      PARTITION BY email_address, organization_id
      ORDER BY created_at ASC
    ) as email_canonical_id
  FROM normalized_clients
  WHERE email_address IS NOT NULL AND email_address != ''
),

id_mapping AS (
  SELECT
    nc.square_customer_id,
    COALESCE(pc.phone_canonical_id, ec.email_canonical_id, nc.square_customer_id) as canonical_id
  FROM normalized_clients nc
  LEFT JOIN phone_canonical pc ON nc.square_customer_id = pc.square_customer_id
  LEFT JOIN email_canonical ec ON nc.square_customer_id = ec.square_customer_id
),

-- 1. Bookings aggregation (ONLY ACCEPTED/COMPLETED)
bookings_agg AS (
  SELECT
    b_inner.organization_id,
    COALESCE(m.canonical_id, b_inner.customer_id) as customer_id,
    MIN(b_inner.start_at) FILTER (WHERE b_inner.status IN ('ACCEPTED','COMPLETED')) AS first_b,
    MAX(b_inner.start_at) FILTER (WHERE b_inner.status IN ('ACCEPTED','COMPLETED')) AS last_b,
    COUNT(*) FILTER (WHERE b_inner.status IN ('ACCEPTED','COMPLETED')) AS b_count,
    COUNT(*) FILTER (WHERE b_inner.status = 'NO_SHOW') AS b_no_shows,
    COUNT(*) FILTER (WHERE b_inner.status = 'CANCELLED_BY_CUSTOMER') AS b_cancelled_by_customer,
    COUNT(*) FILTER (WHERE b_inner.status = 'CANCELLED_BY_SELLER') AS b_cancelled_by_seller
  FROM bookings b_inner
  LEFT JOIN id_mapping m ON b_inner.customer_id = m.square_customer_id
  WHERE b_inner.organization_id = ${organizationId}::uuid
    AND b_inner.customer_id IS NOT NULL
    AND COALESCE(m.canonical_id, b_inner.customer_id) = COALESCE(
        (SELECT canonical_id FROM id_mapping WHERE square_customer_id = ${squareCustomerId}),
        ${squareCustomerId}
      )
  GROUP BY 1,2
),

-- 2. Orders aggregation (simplified for single customer)
orders_agg AS (
  SELECT
    o_inner.organization_id,
    COALESCE(m.canonical_id, o_inner.customer_id, p_inner.customer_id) as customer_id,
    MIN(COALESCE(o_inner.closed_at, o_inner.created_at)) FILTER (WHERE o_inner.state = 'COMPLETED') AS first_any_o,
    MAX(COALESCE(o_inner.closed_at, o_inner.created_at)) FILTER (WHERE o_inner.state = 'COMPLETED') AS last_any_o,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED') AS total_orders
  FROM orders o_inner
  LEFT JOIN payments p_inner ON o_inner.id = p_inner.order_id
  LEFT JOIN id_mapping m ON COALESCE(o_inner.customer_id, p_inner.customer_id) = m.square_customer_id
  WHERE o_inner.organization_id = ${organizationId}::uuid
    AND COALESCE(o_inner.customer_id, p_inner.customer_id) IS NOT NULL
    AND COALESCE(m.canonical_id, o_inner.customer_id, p_inner.customer_id) = COALESCE(
        (SELECT canonical_id FROM id_mapping WHERE square_customer_id = ${squareCustomerId}),
        ${squareCustomerId}
      )
  GROUP BY 1,2
),

-- 3. Payments aggregation (simplified for single customer)
payments_agg AS (
  SELECT
    p_inner.organization_id,
    COALESCE(m.canonical_id, p_inner.customer_id) as customer_id,
    SUM(p_inner.total_money_amount) FILTER (WHERE p_inner.status = 'COMPLETED') AS gross_revenue_cents,
    SUM(COALESCE(p_inner.tip_money_amount, 0)) FILTER (WHERE p_inner.status = 'COMPLETED') AS total_tips_cents,
    COUNT(*) FILTER (WHERE p_inner.status = 'COMPLETED') AS total_payments,
    CASE WHEN COUNT(*) FILTER (WHERE p_inner.status = 'COMPLETED') > 0
      THEN AVG(p_inner.total_money_amount) FILTER (WHERE p_inner.status = 'COMPLETED')
      ELSE 0
    END AS avg_ticket_cents,
    MAX(p_inner.created_at) FILTER (WHERE p_inner.status = 'COMPLETED') AS last_payment_at
  FROM payments p_inner
  LEFT JOIN id_mapping m ON p_inner.customer_id = m.square_customer_id
  WHERE p_inner.organization_id = ${organizationId}::uuid
    AND p_inner.customer_id IS NOT NULL
    AND COALESCE(m.canonical_id, p_inner.customer_id) = COALESCE(
        (SELECT canonical_id FROM id_mapping WHERE square_customer_id = ${squareCustomerId}),
        ${squareCustomerId}
      )
  GROUP BY 1,2
),

-- 4. Single customer select
single_customer AS (
  SELECT ${organizationId}::uuid as organization_id, ${squareCustomerId} as square_customer_id
),

-- 5. Final calculation
final_data AS (
  SELECT
    sc.organization_id,
    sc.square_customer_id,
    c.given_name,
    c.family_name,
    c.email_address,
    c.phone_number,
    b.first_b AS first_booking_at,
    b.last_b AS last_booking_at,
    CASE
      WHEN b.first_b IS NULL THEN oa.first_any_o
      WHEN oa.first_any_o IS NULL THEN b.first_b
      ELSE LEAST(b.first_b, oa.first_any_o)
    END AS first_visit_at,
    CASE
      WHEN b.last_b IS NULL THEN oa.last_any_o
      WHEN oa.last_any_o IS NULL THEN b.last_b
      ELSE GREATEST(b.last_b, oa.last_any_o)
    END AS last_visit_at,
    COALESCE(b.b_count, 0) AS total_accepted_bookings,
    COALESCE(b.b_no_shows, 0) AS total_no_shows,
    COALESCE(b.b_cancelled_by_customer, 0) AS total_cancelled_by_customer,
    COALESCE(b.b_cancelled_by_seller, 0) AS total_cancelled_by_seller,
    COALESCE(p.gross_revenue_cents, 0) AS gross_revenue_cents,
    COALESCE(p.total_tips_cents, 0) AS total_tips_cents,
    COALESCE(p.total_payments, 0) AS total_payments,
    COALESCE(p.avg_ticket_cents, 0) AS avg_ticket_cents,
    COALESCE(p.last_payment_at) AS last_payment_at,
    CASE
      WHEN COALESCE(b.b_count, 0) > 0 THEN 'SALON_CLIENT'
      WHEN COALESCE(oa.total_orders, 0) > 0 THEN 'RETAIL'
      WHEN COALESCE(b.b_no_shows, 0) + COALESCE(b.b_cancelled_by_customer, 0) + COALESCE(b.b_cancelled_by_seller, 0) > 0 THEN 'CANCELLED_ONLY'
      ELSE 'POTENTIAL'
    END AS customer_type,
    COALESCE(b.b_count, 0) + COALESCE(oa.total_orders, 0) AS total_visits
  FROM single_customer sc
  LEFT JOIN square_existing_clients c
    ON c.organization_id = sc.organization_id AND c.square_customer_id = sc.square_customer_id
  LEFT JOIN id_mapping m ON sc.square_customer_id = m.square_customer_id
  LEFT JOIN bookings_agg b
    ON b.organization_id = sc.organization_id AND b.customer_id = COALESCE(m.canonical_id, sc.square_customer_id)
  LEFT JOIN orders_agg oa
    ON oa.organization_id = sc.organization_id AND oa.customer_id = COALESCE(m.canonical_id, sc.square_customer_id)
  LEFT JOIN payments_agg p
    ON p.organization_id = sc.organization_id AND p.customer_id = COALESCE(m.canonical_id, sc.square_customer_id)
)

-- 6. Idempotent UPSERT
INSERT INTO customer_analytics (
  organization_id, square_customer_id, given_name, family_name, email_address, phone_number,
  first_booking_at, last_booking_at, total_accepted_bookings,
  total_no_shows, total_cancelled_by_customer, total_cancelled_by_seller,
  gross_revenue_cents, total_tips_cents, total_payments, avg_ticket_cents,
  first_visit_at, last_visit_at, customer_type, total_visits,
  last_payment_at, updated_at, customer_segment
)
SELECT
  fd.organization_id, fd.square_customer_id, fd.given_name, fd.family_name,
  fd.email_address, fd.phone_number,
  fd.first_booking_at, fd.last_booking_at, fd.total_accepted_bookings,
  fd.total_no_shows, fd.total_cancelled_by_customer, fd.total_cancelled_by_seller,
  fd.gross_revenue_cents, fd.total_tips_cents, fd.total_payments, fd.avg_ticket_cents,
  fd.first_visit_at, fd.last_visit_at, fd.customer_type, fd.total_visits,
  fd.last_payment_at, NOW(),
  CASE
    WHEN fd.first_visit_at IS NULL THEN 'NEVER_BOOKED'
    WHEN fd.first_visit_at >= NOW() - INTERVAL '30 days' THEN 'NEW'
    WHEN fd.last_visit_at >= NOW() - INTERVAL '30 days' THEN 'ACTIVE'
    WHEN fd.last_visit_at >= NOW() - INTERVAL '90 days' THEN 'AT_RISK'
    ELSE 'LOST'
  END
FROM final_data fd
ON CONFLICT (organization_id, square_customer_id) DO UPDATE SET
  given_name = COALESCE(EXCLUDED.given_name, customer_analytics.given_name),
  family_name = COALESCE(EXCLUDED.family_name, customer_analytics.family_name),
  email_address = COALESCE(EXCLUDED.email_address, customer_analytics.email_address),
  phone_number = COALESCE(EXCLUDED.phone_number, customer_analytics.phone_number),
  first_booking_at = EXCLUDED.first_booking_at,
  last_booking_at = EXCLUDED.last_booking_at,
  total_accepted_bookings = EXCLUDED.total_accepted_bookings,
  total_no_shows = EXCLUDED.total_no_shows,
  total_cancelled_by_customer = EXCLUDED.total_cancelled_by_customer,
  total_cancelled_by_seller = EXCLUDED.total_cancelled_by_seller,
  gross_revenue_cents = EXCLUDED.gross_revenue_cents,
  total_tips_cents = EXCLUDED.total_tips_cents,
  total_payments = EXCLUDED.total_payments,
  avg_ticket_cents = EXCLUDED.avg_ticket_cents,
  first_visit_at = EXCLUDED.first_visit_at,
  last_visit_at = EXCLUDED.last_visit_at,
  customer_type = EXCLUDED.customer_type,
  total_visits = EXCLUDED.total_visits,
  last_payment_at = EXCLUDED.last_payment_at,
  customer_segment = EXCLUDED.customer_segment,
  updated_at = NOW()
  `;
}

module.exports = {
  refreshCustomerAnalyticsForSingleCustomer,
};
