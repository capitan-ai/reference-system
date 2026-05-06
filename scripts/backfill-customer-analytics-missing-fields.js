require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function backfillMissingFields() {
  console.log('\n🔄 Backfilling Missing Fields in Customer Analytics\n')
  console.log('='.repeat(80))
  console.log('This script will recalculate the following fields for all customers:')
  console.log('  - total_no_shows')
  console.log('  - total_cancelled_by_customer')
  console.log('  - total_cancelled_by_seller')
  console.log('  - total_tips_cents')
  console.log('  - total_payments')
  console.log('  - avg_ticket_cents')
  console.log('='.repeat(80))

  const startTime = Date.now()

  try {
    // Check current state before backfill
    console.log('\n📊 Checking current state...')
    const beforeStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE total_no_shows > 0) as has_no_shows,
        COUNT(*) FILTER (WHERE total_cancelled_by_customer > 0) as has_cancelled_by_customer,
        COUNT(*) FILTER (WHERE total_cancelled_by_seller > 0) as has_cancelled_by_seller,
        COUNT(*) FILTER (WHERE total_tips_cents > 0) as has_tips,
        COUNT(*) FILTER (WHERE avg_ticket_cents > 0) as has_avg_ticket
      FROM customer_analytics
    `
    console.log('Before backfill:')
    console.table(beforeStats)

    // Use the same SQL as refresh-customer-analytics.js but with full mode
    const refreshSQL = `
WITH
-- 0. Email and Phone based ID mapping for deduplication
-- Group by normalized phone OR email (not AND)
normalized_clients AS (
  SELECT 
    square_customer_id,
    organization_id,
    created_at,
    email_address,
    CASE 
      WHEN phone_number LIKE '+1%' THEN SUBSTRING(phone_number FROM 3)
      WHEN phone_number LIKE '1%' AND LENGTH(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')) = 11 THEN SUBSTRING(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g') FROM 2)
      ELSE REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')
    END as normalized_phone
  FROM square_existing_clients
  WHERE (email_address IS NOT NULL AND email_address != '') 
     OR (phone_number IS NOT NULL AND phone_number != '')
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
    -- Priority: phone match > email match > self
    -- If phone matches, use phone canonical (even if email is different)
    COALESCE(pc.phone_canonical_id, ec.email_canonical_id, nc.square_customer_id) as canonical_id
  FROM normalized_clients nc
  LEFT JOIN phone_canonical pc ON nc.square_customer_id = pc.square_customer_id
  LEFT JOIN email_canonical ec ON nc.square_customer_id = ec.square_customer_id
),

-- 1. Classify all line items
li_classified AS (
  SELECT
    o.organization_id, COALESCE(m.canonical_id, o.customer_id, p.customer_id) as customer_id, li.order_id,
    COUNT(*) FILTER (WHERE li.name ~* '(class|training|course|level up|workshop|lesson|education|deposit|school|license|trainig|days russian)') AS training_items,
    COUNT(*) FILTER (WHERE li.name ~* '(manicure|pedicure|gel|removal|extension|polish|full set|fill|nail)' 
                     AND li.name !~* '(class|training|course|level up|workshop|lesson|education|deposit|school|license|trainig|days russian)') AS salon_items,
    COUNT(*) FILTER (WHERE li.name ~* '(cream|oil|product|kit|buffer|file)') AS retail_items
  FROM order_line_items li
  JOIN orders o ON li.order_id = o.id
  LEFT JOIN payments p ON o.id = p.order_id
  LEFT JOIN id_mapping m ON COALESCE(o.customer_id, p.customer_id) = m.square_customer_id
  WHERE COALESCE(o.customer_id, p.customer_id) IS NOT NULL
  GROUP BY 1,2,3
),

-- 2. Aggregate orders
orders_agg AS (
  SELECT
    o_inner.organization_id, COALESCE(m.canonical_id, o_inner.customer_id, p_inner.customer_id) as customer_id,
    MIN(o_inner.created_at) AS first_any_o,
    MAX(o_inner.created_at) AS last_any_o,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED' AND COALESCE(lic.salon_items,0) > 0) AS service_order_count,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED' AND COALESCE(lic.training_items,0) > 0 AND COALESCE(lic.salon_items,0) = 0) AS training_order_count,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED' AND COALESCE(lic.retail_items,0) > 0 AND COALESCE(lic.salon_items,0) = 0 AND COALESCE(lic.training_items,0) = 0) AS retail_order_count,
    SUM(COALESCE(lic.training_items, 0)) as total_training_items,
    SUM(COALESCE(lic.salon_items, 0)) as total_salon_items
  FROM orders o_inner
  LEFT JOIN payments p_inner ON o_inner.id = p_inner.order_id
  LEFT JOIN id_mapping m ON COALESCE(o_inner.customer_id, p_inner.customer_id) = m.square_customer_id
  LEFT JOIN li_classified lic ON lic.order_id = o_inner.id
  WHERE COALESCE(o_inner.customer_id, p_inner.customer_id) IS NOT NULL
  GROUP BY 1,2
),

-- 3. Aggregate payments
payments_agg AS (
  SELECT
    p_inner.organization_id, COALESCE(m.canonical_id, p_inner.customer_id) as customer_id,
    SUM(p_inner.total_money_amount) FILTER (WHERE p_inner.status = 'COMPLETED') AS gross_revenue_cents,
    SUM(COALESCE(p_inner.tip_money_amount, 0)) FILTER (WHERE p_inner.status = 'COMPLETED') AS total_tips_cents,
    COUNT(*) FILTER (WHERE p_inner.status = 'COMPLETED') AS total_payments,
    AVG(p_inner.total_money_amount) FILTER (WHERE p_inner.status = 'COMPLETED') AS avg_ticket_cents,
    MAX(p_inner.created_at) FILTER (WHERE p_inner.status = 'COMPLETED') AS last_pay_at
  FROM payments p_inner
  LEFT JOIN id_mapping m ON p_inner.customer_id = m.square_customer_id
  WHERE p_inner.customer_id IS NOT NULL
  GROUP BY 1,2
),

-- 4. Aggregate bookings
bookings_agg AS (
  SELECT
    b_inner.organization_id, COALESCE(m.canonical_id, b_inner.customer_id) as customer_id,
    MIN(b_inner.start_at) FILTER (WHERE b_inner.status IN ('ACCEPTED','COMPLETED')) AS first_b,
    MAX(b_inner.start_at) FILTER (WHERE b_inner.status IN ('ACCEPTED','COMPLETED')) AS last_b,
    COUNT(*) FILTER (WHERE b_inner.status IN ('ACCEPTED','COMPLETED')) AS b_count,
    COUNT(*) FILTER (WHERE b_inner.status = 'NO_SHOW') AS b_no_shows,
    COUNT(*) FILTER (WHERE b_inner.status = 'CANCELLED_BY_CUSTOMER') AS b_cancelled_by_customer,
    COUNT(*) FILTER (WHERE b_inner.status = 'CANCELLED_BY_SELLER') AS b_cancelled_by_seller
  FROM bookings b_inner
  LEFT JOIN id_mapping m ON b_inner.customer_id = m.square_customer_id
  WHERE b_inner.customer_id IS NOT NULL
  GROUP BY 1,2
),

-- 5. Collect all unique keys
-- Include canonical_ids from aggregates AND original customer_ids that map to those canonical_ids
keys AS (
  SELECT organization_id, customer_id FROM bookings_agg
  UNION
  SELECT organization_id, customer_id FROM orders_agg
  UNION
  SELECT organization_id, customer_id FROM payments_agg
  UNION
  -- Include original customer_ids that map to canonical_ids in aggregates
  SELECT c.organization_id, c.square_customer_id as customer_id 
  FROM square_existing_clients c
  INNER JOIN id_mapping m ON c.square_customer_id = m.square_customer_id
  WHERE m.canonical_id IN (
    SELECT customer_id FROM bookings_agg
    UNION SELECT customer_id FROM orders_agg
    UNION SELECT customer_id FROM payments_agg
  )
),

-- 6. Final calculation
final_data AS (
  SELECT
    k.organization_id, k.customer_id,
    c.given_name,
    c.family_name,
    c.email_address,
    c.phone_number,
    CASE WHEN b.first_b IS NULL THEN oa.first_any_o WHEN oa.first_any_o IS NULL THEN b.first_b ELSE LEAST(b.first_b, oa.first_any_o) END AS first_visit_at,
    CASE WHEN b.last_b IS NULL THEN oa.last_any_o WHEN oa.last_any_o IS NULL THEN b.last_b ELSE GREATEST(b.last_b, oa.last_any_o) END AS last_visit_at,
    (COALESCE(b.b_count,0) + COALESCE(oa.service_order_count,0) + COALESCE(oa.training_order_count,0)) AS total_visits,
    COALESCE(b.b_count,0) AS booking_visits,
    COALESCE(oa.service_order_count,0) AS service_order_visits,
    COALESCE(oa.training_order_count,0) AS training_visits,
    COALESCE(oa.retail_order_count,0) AS retail_visits,
    COALESCE(b.b_no_shows, 0) AS total_no_shows,
    COALESCE(b.b_cancelled_by_customer, 0) AS total_cancelled_by_customer,
    COALESCE(b.b_cancelled_by_seller, 0) AS total_cancelled_by_seller,
    COALESCE(p.total_tips_cents, 0) AS total_tips_cents,
    COALESCE(p.total_payments, 0) AS total_payments,
    COALESCE(p.avg_ticket_cents, 0) AS avg_ticket_cents,
    CASE
      WHEN COALESCE(b.b_count,0) > 0 OR COALESCE(oa.total_salon_items,0) > 0 THEN 'SALON_CLIENT'
      WHEN COALESCE(oa.total_training_items,0) > 0 THEN 'STUDENT'
      WHEN COALESCE(oa.retail_order_count,0) > 0 OR COALESCE(p.gross_revenue_cents,0) > 0 THEN 'RETAIL'
      WHEN COALESCE(b.b_no_shows,0) + COALESCE(b.b_cancelled_by_customer,0) + COALESCE(b.b_cancelled_by_seller,0) > 0 THEN 'CANCELLED_ONLY'
      ELSE 'POTENTIAL'
    END AS customer_type,
    COALESCE(p.gross_revenue_cents,0) AS gross_revenue_cents,
    p.last_pay_at AS last_payment_at
  FROM keys k
  LEFT JOIN square_existing_clients c ON c.organization_id = k.organization_id AND c.square_customer_id = k.customer_id
  LEFT JOIN id_mapping m ON k.customer_id = m.square_customer_id
  LEFT JOIN bookings_agg b ON b.organization_id=k.organization_id AND b.customer_id=COALESCE(m.canonical_id, k.customer_id)
  LEFT JOIN orders_agg oa ON oa.organization_id=k.organization_id AND oa.customer_id=COALESCE(m.canonical_id, k.customer_id)
  LEFT JOIN payments_agg p ON p.organization_id=k.organization_id AND p.customer_id=COALESCE(m.canonical_id, k.customer_id)
)

-- 7. Idempotent UPSERT
INSERT INTO customer_analytics (
  organization_id, square_customer_id, 
  given_name, family_name, email_address, phone_number,
  first_booking_at, last_booking_at, total_accepted_bookings, total_revenue_cents,
  total_no_shows, total_cancelled_by_customer, total_cancelled_by_seller,
  total_tips_cents, total_payments, avg_ticket_cents,
  booking_visits, service_order_visits, training_visits, retail_visits, total_visits,
  first_visit_at, last_visit_at, customer_type, gross_revenue_cents, 
  last_payment_at, updated_at, customer_segment
)
SELECT
  fd.organization_id, fd.customer_id, 
  fd.given_name, fd.family_name, fd.email_address, fd.phone_number,
  fd.first_visit_at, fd.last_visit_at, fd.total_visits, fd.gross_revenue_cents,
  fd.total_no_shows, fd.total_cancelled_by_customer, fd.total_cancelled_by_seller,
  fd.total_tips_cents, fd.total_payments, fd.avg_ticket_cents,
  fd.booking_visits, fd.service_order_visits, fd.training_visits, fd.retail_visits, fd.total_visits,
  fd.first_visit_at, fd.last_visit_at, fd.customer_type, fd.gross_revenue_cents, 
  fd.last_payment_at, NOW(),
  CASE
    WHEN fd.first_visit_at IS NULL THEN 'NEVER_VISITED'
    WHEN fd.first_visit_at >= NOW() - INTERVAL '30 days' THEN 'NEW'
    WHEN fd.last_visit_at >= NOW() - INTERVAL '42 days' THEN 'ACTIVE'
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
  total_revenue_cents = EXCLUDED.total_revenue_cents,
  total_no_shows = EXCLUDED.total_no_shows,
  total_cancelled_by_customer = EXCLUDED.total_cancelled_by_customer,
  total_cancelled_by_seller = EXCLUDED.total_cancelled_by_seller,
  total_tips_cents = EXCLUDED.total_tips_cents,
  total_payments = EXCLUDED.total_payments,
  avg_ticket_cents = EXCLUDED.avg_ticket_cents,
  booking_visits = EXCLUDED.booking_visits,
  service_order_visits = EXCLUDED.service_order_visits,
  training_visits = EXCLUDED.training_visits,
  retail_visits = EXCLUDED.retail_visits,
  total_visits = EXCLUDED.total_visits,
  first_visit_at = EXCLUDED.first_visit_at,
  last_visit_at = EXCLUDED.last_visit_at,
  customer_type = EXCLUDED.customer_type,
  gross_revenue_cents = EXCLUDED.gross_revenue_cents,
  last_payment_at = EXCLUDED.last_payment_at,
  customer_segment = EXCLUDED.customer_segment,
  updated_at = NOW();
`

    console.log('\n🔄 Executing full refresh to backfill missing fields...')
    const queryStartTime = Date.now()
    await prisma.$executeRawUnsafe(refreshSQL)
    const queryElapsed = Date.now() - queryStartTime
    console.log(`✅ Refresh completed in ${(queryElapsed / 1000).toFixed(2)}s`)

    // Check state after backfill
    console.log('\n📊 Checking state after backfill...')
    const afterStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE total_no_shows > 0) as has_no_shows,
        COUNT(*) FILTER (WHERE total_cancelled_by_customer > 0) as has_cancelled_by_customer,
        COUNT(*) FILTER (WHERE total_cancelled_by_seller > 0) as has_cancelled_by_seller,
        COUNT(*) FILTER (WHERE total_tips_cents > 0) as has_tips,
        COUNT(*) FILTER (WHERE avg_ticket_cents > 0) as has_avg_ticket
      FROM customer_analytics
    `
    console.log('After backfill:')
    console.table(afterStats)

    // Calculate improvements
    const before = beforeStats[0]
    const after = afterStats[0]
    console.log('\n📈 Improvements:')
    console.log(`  total_no_shows: ${before.has_no_shows} → ${after.has_no_shows} (+${after.has_no_shows - before.has_no_shows})`)
    console.log(`  total_cancelled_by_customer: ${before.has_cancelled_by_customer} → ${after.has_cancelled_by_customer} (+${after.has_cancelled_by_customer - before.has_cancelled_by_customer})`)
    console.log(`  total_cancelled_by_seller: ${before.has_cancelled_by_seller} → ${after.has_cancelled_by_seller} (+${after.has_cancelled_by_seller - before.has_cancelled_by_seller})`)
    console.log(`  total_tips_cents: ${before.has_tips} → ${after.has_tips} (+${after.has_tips - before.has_tips})`)
    console.log(`  avg_ticket_cents: ${before.has_avg_ticket} → ${after.has_avg_ticket} (+${after.has_avg_ticket - before.has_avg_ticket})`)

    const totalElapsed = Date.now() - startTime
    console.log('\n' + '='.repeat(80))
    console.log(`✅ Backfill completed successfully in ${(totalElapsed / 1000).toFixed(2)}s`)
    console.log('='.repeat(80) + '\n')

  } catch (error) {
    console.error('\n❌ Error during backfill:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

backfillMissingFields()

