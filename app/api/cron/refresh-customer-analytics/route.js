import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { saveApplicationLog } = require('../../../../lib/workflows/application-log-queue')
const { PrismaClient } = require('@prisma/client')

const logPrisma = new PrismaClient()

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function authorize(request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.warn('⚠️ CRON_SECRET not set - allowing unauthenticated access (development only)')
    return { authorized: true, method: 'no-secret-set' }
  }

  const authHeader = request.headers.get('Authorization') || ''
  const cronHeader = request.headers.get('x-cron-secret') || request.headers.get('x-cron-key') || ''
  const userAgent = request.headers.get('user-agent') || ''
  
  console.log(`[CRON] Auth check - User-Agent: ${userAgent.substring(0, 50)}`)
  console.log(`[CRON] Auth check - Has Auth header: ${!!authHeader}`)
  console.log(`[CRON] Auth check - Has x-cron-secret: ${!!cronHeader}`)

  if (authHeader === `Bearer ${cronSecret}` || authHeader === cronSecret) {
    console.log(`[CRON] ✅ Authorized via Authorization header`)
    return { authorized: true, method: 'vercel-cron-auth-header' }
  }

  if (cronHeader === cronSecret) {
    console.log(`[CRON] ✅ Authorized via x-cron-secret header`)
    return { authorized: true, method: 'vercel-cron-header' }
  }

  const isVercelRequest = 
    userAgent.includes('vercel-cron') || 
    userAgent.includes('vercel') ||
    userAgent.toLowerCase().includes('vercel') ||
    (!userAgent || userAgent.length === 0)
  
  if (isVercelRequest) {
    console.warn('⚠️ Vercel cron request detected but secret mismatch. Allowing for now.')
    return { authorized: true, method: 'vercel-cron-user-agent' }
  }

  console.error(`[CRON] ❌ Authorization failed - No matching secret found`)
  return { authorized: false, reason: 'no-matching-secret', method: 'unknown' }
}

async function handle(request) {
  const startTime = Date.now()
  console.log(`[CRON] Customer analytics refresh triggered at ${new Date().toISOString()}`)
  
  const auth = authorize(request)
  if (!auth.authorized) {
    console.error(`[CRON] Unauthorized access attempt. Reason: ${auth.reason || 'none'}`)
    return json({ error: 'Unauthorized', reason: auth.reason }, 401)
  }
  
  console.log(`[CRON] Authorized using method: ${auth.method}`)

  const cronId = `cron-refresh-customer-analytics-${Date.now()}`
  
  try {
    await saveApplicationLog(logPrisma, {
      logType: 'cron',
      logId: cronId,
      logCreatedAt: new Date(),
      payload: {
        cron_name: 'refresh-customer-analytics',
        worker_id: 'vercel-cron',
        triggered_at: new Date().toISOString(),
        mode: 'recent'
      },
      organizationId: null,
      status: 'processing',
      maxAttempts: 0
    }).catch(() => {})
  } catch (logError) {
    console.warn('⚠️ Failed to save cron start to application_logs:', logError.message)
  }

  try {
    console.log('📊 Starting customer_analytics refresh...')
    
    // Execute the refresh SQL directly
    const prisma = new PrismaClient()

    // Time filters: last 90 days (recent mode)
    const bookingsDateFilter = "AND b_inner.start_at >= now() - interval '90 days'"
    const paymentsDateFilter = "AND p_inner.created_at >= now() - interval '90 days'"
    const ordersDateFilter = "AND o_inner.created_at >= now() - interval '90 days'"

    const refreshSQL = `
WITH
-- 1. Classify all line items (one pass) using word boundaries
li_classified AS (
  SELECT
    organization_id, customer_id, order_id,
    COUNT(*) FILTER (WHERE name ~* '\\\\m(manicure|pedicure|gel|removal|extension|polish)\\\\M') AS salon_items,
    COUNT(*) FILTER (WHERE name ~* '\\\\m(class|training|course|level up|workshop)\\\\M') AS training_items,
    COUNT(*) FILTER (WHERE name ~* '\\\\m(cream|oil|product|kit)\\\\M') AS retail_items
  FROM order_line_items
  WHERE customer_id IS NOT NULL
  GROUP BY 1,2,3
),
-- 2. Aggregate orders (POS visits)
orders_agg AS (
  SELECT
    o_inner.organization_id, o_inner.customer_id,
    -- Dates of ANY visit (salon, training or retail)
    MIN(o_inner.created_at) FILTER (WHERE COALESCE(lic.salon_items,0) + COALESCE(lic.training_items,0) + COALESCE(lic.retail_items,0) > 0) AS first_any_o,
    MAX(o_inner.created_at) FILTER (WHERE COALESCE(lic.salon_items,0) + COALESCE(lic.training_items,0) + COALESCE(lic.retail_items,0) > 0) AS last_any_o,
    -- Counters (COMPLETED only for visits)
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED' AND COALESCE(lic.salon_items,0) > 0) AS service_order_count,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED' AND COALESCE(lic.training_items,0) > 0 AND COALESCE(lic.salon_items,0) = 0) AS training_order_count,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state = 'COMPLETED' AND COALESCE(lic.retail_items,0) > 0 AND COALESCE(lic.salon_items,0) = 0 AND COALESCE(lic.training_items,0) = 0) AS retail_order_count,
    -- For Type classification (including OPEN orders)
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state IN ('COMPLETED', 'OPEN') AND COALESCE(lic.training_items,0) > 0) AS type_training_count,
    COUNT(DISTINCT o_inner.order_id) FILTER (WHERE o_inner.state IN ('COMPLETED', 'OPEN') AND COALESCE(lic.salon_items,0) > 0) AS type_salon_count
  FROM orders o_inner
  LEFT JOIN li_classified lic ON lic.order_id = o_inner.id
  WHERE o_inner.customer_id IS NOT NULL
    ${ordersDateFilter}
  GROUP BY 1,2
),
-- 3. Aggregate payments
payments_agg AS (
  SELECT
    p_inner.organization_id, p_inner.customer_id,
    SUM(p_inner.total_money_amount) FILTER (WHERE p_inner.status = 'COMPLETED') AS gross_revenue_cents,
    MAX(p_inner.created_at) FILTER (WHERE p_inner.status = 'COMPLETED') AS last_pay_at
  FROM payments p_inner
  WHERE p_inner.customer_id IS NOT NULL
    ${paymentsDateFilter}
  GROUP BY 1,2
),
-- 4. Aggregate bookings
bookings_agg AS (
  SELECT
    b_inner.organization_id, b_inner.customer_id,
    MIN(b_inner.start_at) AS first_b, MAX(b_inner.start_at) AS last_b,
    COUNT(*) AS b_count
  FROM bookings b_inner
  WHERE b_inner.status IN ('ACCEPTED','COMPLETED') AND b_inner.customer_id IS NOT NULL
    ${bookingsDateFilter}
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
  organization_id, square_customer_id, first_booking_at, last_booking_at,
  total_accepted_bookings, booking_visits, service_order_visits, training_visits, retail_visits,
  customer_type, total_revenue_cents, last_payment_at, updated_at, customer_segment
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
  first_booking_at = EXCLUDED.first_booking_at,
  last_booking_at = EXCLUDED.last_booking_at,
  total_accepted_bookings = EXCLUDED.total_accepted_bookings,
  booking_visits = EXCLUDED.booking_visits,
  service_order_visits = EXCLUDED.service_order_visits,
  training_visits = EXCLUDED.training_visits,
  retail_visits = EXCLUDED.retail_visits,
  customer_type = EXCLUDED.customer_type,
  total_revenue_cents = EXCLUDED.total_revenue_cents,
  last_payment_at = EXCLUDED.last_payment_at,
  customer_segment = EXCLUDED.customer_segment,
  updated_at = NOW();
    `

    await prisma.$executeRawUnsafe(refreshSQL)
    await prisma.$disconnect()

    const elapsed = Date.now() - startTime
    console.log(`✅ Refresh completed successfully in ${(elapsed / 1000).toFixed(2)}s`)

    // Log completion
    try {
      await saveApplicationLog(logPrisma, {
        logType: 'cron',
        logId: cronId,
        logCreatedAt: new Date(),
        payload: {
          cron_name: 'refresh-customer-analytics',
          worker_id: 'vercel-cron',
          completed_at: new Date().toISOString(),
          duration_ms: elapsed
        },
        organizationId: null,
        status: 'completed',
        maxAttempts: 0
      }).catch(() => {})
    } catch (logError) {
      console.warn('⚠️ Failed to save cron completion to application_logs:', logError.message)
    }

    return json({
      success: true,
      cronId,
      message: 'Customer analytics refresh completed',
      durationMs: elapsed
    })

  } catch (error) {
    console.error('❌ Error during customer analytics refresh:', error.message)
    console.error(error)

    const elapsed = Date.now() - startTime

    // Log error
    try {
      await saveApplicationLog(logPrisma, {
        logType: 'cron',
        logId: cronId,
        logCreatedAt: new Date(),
        payload: {
          cron_name: 'refresh-customer-analytics',
          worker_id: 'vercel-cron',
          error: error.message,
          duration_ms: elapsed
        },
        organizationId: null,
        status: 'error',
        maxAttempts: 0
      }).catch(() => {})
    } catch (logError) {
      console.warn('⚠️ Failed to save cron error to application_logs:', logError.message)
    }

    return json({
      success: false,
      cronId,
      error: error.message,
      durationMs: elapsed
    }, 500)
  } finally {
    await logPrisma.$disconnect()
  }
}

export async function POST(request) {
  return handle(request)
}

export async function GET(request) {
  return handle(request)
}
