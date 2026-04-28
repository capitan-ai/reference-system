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

-- 2. Line item classification
li_classified AS (
  SELECT
    o.organization_id,
    COALESCE(m.canonical_id, o.customer_id, p.customer_id) as customer_id,
    li.order_id,
    COUNT(*) FILTER (WHERE li.name ~* '(class|training|course|level up|workshop|lesson|education|deposit|school|license|trainig|days russian)') AS training_items,
    COUNT(*) FILTER (WHERE li.name ~* '(manicure|pedicure|gel|removal|extension|polish|full set|fill|nail)'
                     AND li.name !~* '(class|training|course|level up|workshop|lesson|education|deposit|school|license|trainig|days russian)') AS salon_items,
    COUNT(*) FILTER (WHERE li.name ~* '(cream|oil|product|kit|buffer|file)') AS retail_items
  FROM order_line_items li
  JOIN orders o ON li.order_id = o.id
  LEFT JOIN payments p ON o.id = p.order_id
  LEFT JOIN id_mapping m ON COALESCE(o.customer_id, p.customer_id) = m.square_customer_id
  WHERE o.organization_id = ${organizationId}::uuid
    AND COALESCE(o.customer_id, p.customer_id) IS NOT NULL
  GROUP BY 1,2,3
),

-- 3. Orders aggregation
orders_agg AS (
  SELECT
    o_inner.organization_id,
    COALESCE(m.canonical_id, o_inner.customer_id, p_inner.customer_id) as customer_id,
    MIN(COALESCE(o_inner.closed_at, o_inner.created_at)) FILTER (WHERE o_inner.state = 'COMPLETED') AS first_any_o,
    MAX(COALESCE(o_inner.closed_at, o_inner.created_at)) FILTER (WHERE o_inner.state = 'COMPLETED') AS last_any_o,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED' AND COALESCE(lic.salon_items,0) > 0) AS service_order_count,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED' AND COALESCE(lic.training_items,0) > 0 AND COALESCE(lic.salon_items,0) = 0) AS training_order_count,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED' AND COALESCE(lic.retail_items,0) > 0 AND COALESCE(lic.salon_items,0) = 0 AND COALESCE(lic.training_items,0) = 0) AS retail_order_count,
    SUM(COALESCE(lic.training_items, 0)) AS total_training_items,
    SUM(COALESCE(lic.salon_items, 0)) AS total_salon_items
  FROM orders o_inner
  LEFT JOIN payments p_inner ON o_inner.id = p_inner.order_id
  LEFT JOIN id_mapping m ON COALESCE(o_inner.customer_id, p_inner.customer_id) = m.square_customer_id
  LEFT JOIN li_classified lic ON lic.order_id = o_inner.id
  WHERE o_inner.organization_id = ${organizationId}::uuid
    AND COALESCE(o_inner.customer_id, p_inner.customer_id) IS NOT NULL
    AND COALESCE(m.canonical_id, o_inner.customer_id, p_inner.customer_id) = COALESCE(
        (SELECT canonical_id FROM id_mapping WHERE square_customer_id = ${squareCustomerId}),
        ${squareCustomerId}
      )
  GROUP BY 1,2
),

-- 4. Payments aggregation
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

-- 5. Single customer select
single_customer AS (
  SELECT ${organizationId}::uuid as organization_id, ${squareCustomerId} as square_customer_id
),

-- 6. Final calculation
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
      WHEN COALESCE(b.b_count, 0) > 0 OR COALESCE(oa.total_salon_items, 0) > 0 THEN 'SALON_CLIENT'
      WHEN COALESCE(oa.total_training_items, 0) > 0 THEN 'STUDENT'
      WHEN COALESCE(oa.retail_order_count, 0) > 0 OR COALESCE(p.gross_revenue_cents, 0) > 0 THEN 'RETAIL'
      WHEN COALESCE(b.b_no_shows, 0) + COALESCE(b.b_cancelled_by_customer, 0) + COALESCE(b.b_cancelled_by_seller, 0) > 0 THEN 'CANCELLED_ONLY'
      ELSE 'POTENTIAL'
    END AS customer_type,
    COALESCE(b.b_count, 0) AS booking_visits,
    COALESCE(oa.service_order_count, 0) AS service_order_visits,
    COALESCE(oa.training_order_count, 0) AS training_visits,
    COALESCE(oa.retail_order_count, 0) AS retail_visits,
    (COALESCE(b.b_count, 0) + COALESCE(oa.service_order_count, 0) + COALESCE(oa.training_order_count, 0)) AS total_visits,
    c.acquisition_source
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

-- 7. Idempotent UPSERT
INSERT INTO customer_analytics (
  organization_id, square_customer_id, given_name, family_name, email_address, phone_number,
  first_booking_at, last_booking_at, total_accepted_bookings,
  total_no_shows, total_cancelled_by_customer, total_cancelled_by_seller,
  gross_revenue_cents, total_revenue_cents, total_tips_cents, total_payments, avg_ticket_cents,
  booking_visits, service_order_visits, training_visits, retail_visits, total_visits,
  first_visit_at, last_visit_at, customer_type,
  last_payment_at, updated_at, customer_segment, referral_source
)
SELECT
  fd.organization_id, fd.square_customer_id, fd.given_name, fd.family_name,
  fd.email_address, fd.phone_number,
  fd.first_booking_at, fd.last_booking_at, fd.total_accepted_bookings,
  fd.total_no_shows, fd.total_cancelled_by_customer, fd.total_cancelled_by_seller,
  fd.gross_revenue_cents, fd.gross_revenue_cents, fd.total_tips_cents, fd.total_payments, fd.avg_ticket_cents,
  fd.booking_visits, fd.service_order_visits, fd.training_visits, fd.retail_visits, fd.total_visits,
  fd.first_visit_at, fd.last_visit_at, fd.customer_type,
  fd.last_payment_at, NOW(),
  CASE
    WHEN fd.first_visit_at IS NULL THEN 'NEVER_VISITED'
    WHEN fd.first_visit_at >= NOW() - INTERVAL '30 days' THEN 'NEW'
    WHEN fd.last_visit_at >= NOW() - INTERVAL '42 days' THEN 'ACTIVE'
    WHEN fd.last_visit_at >= NOW() - INTERVAL '90 days' THEN 'AT_RISK'
    ELSE 'LOST'
  END,
  fd.acquisition_source
FROM final_data fd
ON CONFLICT (organization_id, square_customer_id) DO UPDATE SET
  given_name = COALESCE(EXCLUDED.given_name, customer_analytics.given_name),
  family_name = COALESCE(EXCLUDED.family_name, customer_analytics.family_name),
  email_address = COALESCE(EXCLUDED.email_address, customer_analytics.email_address),
  phone_number = COALESCE(EXCLUDED.phone_number, customer_analytics.phone_number),
  first_booking_at = LEAST(EXCLUDED.first_booking_at, customer_analytics.first_booking_at),
  last_booking_at = GREATEST(EXCLUDED.last_booking_at, customer_analytics.last_booking_at),
  total_accepted_bookings = EXCLUDED.total_accepted_bookings,
  total_no_shows = EXCLUDED.total_no_shows,
  total_cancelled_by_customer = EXCLUDED.total_cancelled_by_customer,
  total_cancelled_by_seller = EXCLUDED.total_cancelled_by_seller,
  gross_revenue_cents = EXCLUDED.gross_revenue_cents,
  total_revenue_cents = EXCLUDED.total_revenue_cents,
  total_tips_cents = EXCLUDED.total_tips_cents,
  total_payments = EXCLUDED.total_payments,
  avg_ticket_cents = EXCLUDED.avg_ticket_cents,
  booking_visits = EXCLUDED.booking_visits,
  service_order_visits = EXCLUDED.service_order_visits,
  training_visits = EXCLUDED.training_visits,
  retail_visits = EXCLUDED.retail_visits,
  total_visits = EXCLUDED.total_visits,
  first_visit_at = LEAST(EXCLUDED.first_visit_at, customer_analytics.first_visit_at),
  last_visit_at = GREATEST(EXCLUDED.last_visit_at, customer_analytics.last_visit_at),
  customer_type = EXCLUDED.customer_type,
  last_payment_at = EXCLUDED.last_payment_at,
  customer_segment = EXCLUDED.customer_segment,
  referral_source = COALESCE(customer_analytics.referral_source, EXCLUDED.referral_source),
  updated_at = NOW()
  `;
}

module.exports = {
  refreshCustomerAnalyticsForSingleCustomer,
};
