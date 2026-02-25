require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function refreshCustomerAnalytics(mode = 'full', organizationId = null) {
  console.log(`\n📊 Refreshing Enterprise Customer Analytics (mode: ${mode})...\n`)
  console.log('='.repeat(80))

  const startTime = Date.now()

  try {
    const bookingsDateFilter = mode === 'full' ? '' : "AND b.start_at >= now() - interval '90 days'"
    const paymentsDateFilter = mode === 'full' ? '' : "AND p.created_at >= now() - interval '90 days'"
    const ordersDateFilter = mode === 'full' ? '' : "AND o.created_at >= now() - interval '90 days'"
    
    const orgFilterB = organizationId ? `AND b.organization_id = '${organizationId}'::uuid` : ''
    const orgFilterP = organizationId ? `AND p.organization_id = '${organizationId}'::uuid` : ''
    const orgFilterO = organizationId ? `AND o.organization_id = '${organizationId}'::uuid` : ''

    const refreshSQL = `
WITH
-- 1. Classify all line items (one pass) using word boundaries
li_classified AS (
  SELECT
    organization_id, customer_id, order_id,
    COUNT(*) FILTER (WHERE name ~* '\\m(manicure|pedicure|gel|removal|extension|polish)\\M') AS salon_items,
    COUNT(*) FILTER (WHERE name ~* '\\m(class|training|course|level up|workshop)\\M') AS training_items,
    COUNT(*) FILTER (WHERE name ~* '\\m(cream|oil|product|kit)\\M') AS retail_items
  FROM order_line_items
  WHERE customer_id IS NOT NULL
  GROUP BY 1,2,3
),
-- 2. Aggregate orders (POS visits)
orders_agg AS (
  SELECT
    o.organization_id, o.customer_id,
    -- Dates of ANY visit (salon, training or retail)
    MIN(o.created_at) FILTER (WHERE COALESCE(lic.salon_items,0) + COALESCE(lic.training_items,0) + COALESCE(lic.retail_items,0) > 0) AS first_any_o,
    MAX(o.created_at) FILTER (WHERE COALESCE(lic.salon_items,0) + COALESCE(lic.training_items,0) + COALESCE(lic.retail_items,0) > 0) AS last_any_o,
    -- Counters (COMPLETED only for visits)
    COUNT(DISTINCT o.order_id) FILTER (WHERE o.state = 'COMPLETED' AND COALESCE(lic.salon_items,0) > 0) AS service_order_count,
    COUNT(DISTINCT o.order_id) FILTER (WHERE o.state = 'COMPLETED' AND COALESCE(lic.training_items,0) > 0 AND COALESCE(lic.salon_items,0) = 0) AS training_order_count,
    COUNT(DISTINCT o.order_id) FILTER (WHERE o.state = 'COMPLETED' AND COALESCE(lic.retail_items,0) > 0 AND COALESCE(lic.salon_items,0) = 0 AND COALESCE(lic.training_items,0) = 0) AS retail_order_count,
    -- For Type classification (including OPEN orders)
    COUNT(DISTINCT o.order_id) FILTER (WHERE o.state IN ('COMPLETED', 'OPEN') AND COALESCE(lic.training_items,0) > 0) AS type_training_count,
    COUNT(DISTINCT o.order_id) FILTER (WHERE o.state IN ('COMPLETED', 'OPEN') AND COALESCE(lic.salon_items,0) > 0) AS type_salon_count
  FROM orders o
  LEFT JOIN li_classified lic ON lic.order_id = o.id
  WHERE o.customer_id IS NOT NULL
    ${ordersDateFilter}
    ${orgFilterO}
  GROUP BY 1,2
),
-- 3. Aggregate payments
payments_agg AS (
  SELECT
    organization_id, customer_id,
    SUM(total_money_amount) FILTER (WHERE status = 'COMPLETED') AS gross_revenue_cents,
    MAX(created_at) FILTER (WHERE status = 'COMPLETED') AS last_pay_at
  FROM payments
  WHERE customer_id IS NOT NULL
    ${paymentsDateFilter}
    ${orgFilterP}
  GROUP BY 1,2
),
-- 4. Aggregate bookings
bookings_agg AS (
  SELECT
    organization_id, customer_id,
    MIN(start_at) AS first_b, MAX(start_at) AS last_b,
    COUNT(*) AS b_count
  FROM bookings
  WHERE status IN ('ACCEPTED','COMPLETED') AND customer_id IS NOT NULL
    ${bookingsDateFilter}
    ${orgFilterB}
  GROUP BY 1,2
),
-- 5. Collect all unique customer keys from ALL sources
keys AS (
  SELECT organization_id, customer_id FROM bookings_agg
  UNION
  SELECT organization_id, customer_id FROM orders_agg
  UNION
  SELECT organization_id, customer_id FROM payments_agg
  UNION
  SELECT organization_id, square_customer_id FROM square_existing_clients
),
-- 6. Final calculation
final_data AS (
  SELECT
    k.organization_id, k.customer_id,
    -- NULL-safe Visit Dates
    CASE WHEN b.first_b IS NULL THEN oa.first_any_o WHEN oa.first_any_o IS NULL THEN b.first_b ELSE LEAST(b.first_b, oa.first_any_o) END AS first_visit_at,
    CASE WHEN b.last_b IS NULL THEN oa.last_any_o WHEN oa.last_any_o IS NULL THEN b.last_b ELSE GREATEST(b.last_b, oa.last_any_o) END AS last_visit_at,
    -- Visit Counts (COMPLETED only)
    (COALESCE(b.b_count,0) + COALESCE(oa.service_order_count,0) + COALESCE(oa.training_order_count,0)) AS total_visits,
    COALESCE(b.b_count,0) AS booking_visits,
    COALESCE(oa.service_order_count,0) AS service_order_visits,
    COALESCE(oa.training_order_count,0) AS training_visits,
    COALESCE(oa.retail_order_count,0) AS retail_visits,
    -- Customer Type (STUDENT priority, includes OPEN orders)
    CASE
      WHEN COALESCE(oa.type_training_count,0) > 0 THEN 'STUDENT'
      WHEN COALESCE(oa.type_salon_count,0) > 0 OR COALESCE(b.b_count,0) > 0 THEN 'SALON_CLIENT'
      WHEN COALESCE(p.gross_revenue_cents,0) > 0 THEN 'RETAIL'
      ELSE 'POTENTIAL'
    END AS customer_type,
    COALESCE(p.gross_revenue_cents,0) AS gross_revenue_cents,
    p.last_pay_at AS last_payment_at
  FROM keys k
  LEFT JOIN bookings_agg b ON b.organization_id=k.organization_id AND b.customer_id=k.customer_id
  LEFT JOIN orders_agg oa ON oa.organization_id=k.organization_id AND oa.customer_id=k.customer_id
  LEFT JOIN payments_agg p ON p.organization_id=k.organization_id AND p.customer_id=k.customer_id
)
-- 7. Idempotent UPSERT
INSERT INTO customer_analytics (
  organization_id, square_customer_id, first_visit_at, last_visit_at,
  total_visits, booking_visits, service_order_visits, training_visits, retail_visits,
  customer_type, gross_revenue_cents, last_payment_at, updated_at, customer_segment
)
SELECT
  fd.organization_id, fd.customer_id, fd.first_visit_at, fd.last_visit_at,
  fd.total_visits, fd.booking_visits, fd.service_order_visits, fd.training_visits, fd.retail_visits,
  fd.customer_type, fd.gross_revenue_cents, fd.last_payment_at, NOW(),
  -- Segment calculation (uses the merged last_visit_at)
  CASE
    WHEN fd.first_visit_at IS NULL THEN 'NEVER_BOOKED'
    WHEN fd.first_visit_at >= NOW() - INTERVAL '30 days' THEN 'NEW'
    WHEN fd.last_visit_at >= NOW() - INTERVAL '30 days' THEN 'ACTIVE'
    WHEN fd.last_visit_at >= NOW() - INTERVAL '90 days' THEN 'AT_RISK'
    ELSE 'LOST'
  END
FROM final_data fd
ON CONFLICT (organization_id, square_customer_id) DO UPDATE SET
  first_visit_at = EXCLUDED.first_visit_at,
  last_visit_at = EXCLUDED.last_visit_at,
  total_visits = EXCLUDED.total_visits,
  booking_visits = EXCLUDED.booking_visits,
  service_order_visits = EXCLUDED.service_order_visits,
  training_visits = EXCLUDED.training_visits,
  retail_visits = EXCLUDED.retail_visits,
  customer_type = EXCLUDED.customer_type,
  gross_revenue_cents = EXCLUDED.gross_revenue_cents,
  last_payment_at = EXCLUDED.last_payment_at,
  customer_segment = EXCLUDED.customer_segment,
  updated_at = NOW();
    `

    console.log('Executing Enterprise Refresh query...')
    const result = await prisma.$executeRawUnsafe(refreshSQL)
    
    const elapsed = Date.now() - startTime
    console.log(`✅ Refresh completed in ${(elapsed / 1000).toFixed(2)}s`)
    console.log(`   Mode: ${mode}`)
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error during refresh:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

const mode = process.argv[2] || 'full'
const orgId = process.argv[3] || null
refreshCustomerAnalytics(mode, orgId)
