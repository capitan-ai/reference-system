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

    // Time filter: last 90 days (recent mode)
    const dateFilter = "AND b.start_at >= now() - interval '90 days'"

    const refreshSQL = `
WITH bookings_agg AS (
  SELECT
    b.organization_id,
    b.customer_id AS square_customer_id,
    MIN(b.start_at) FILTER (WHERE b.status = 'ACCEPTED') AS first_booking_at,
    MAX(b.start_at) FILTER (WHERE b.status = 'ACCEPTED') AS last_booking_at,
    COUNT(*) FILTER (WHERE b.status = 'ACCEPTED') AS total_accepted_bookings,
    COUNT(*) FILTER (WHERE b.status = 'CANCELLED_BY_CUSTOMER') AS total_cancelled_by_customer,
    COUNT(*) FILTER (WHERE b.status = 'CANCELLED_BY_SELLER') AS total_cancelled_by_seller,
    COUNT(*) FILTER (WHERE b.status = 'NO_SHOW') AS total_no_shows,
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
    COUNT(DISTINCT b.location_id) FILTER (WHERE b.status = 'ACCEPTED') AS distinct_locations,
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
  GROUP BY b.organization_id, b.customer_id
),
payments_agg AS (
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
  GROUP BY p.organization_id, p.customer_id
),
referral_agg AS (
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
  updated_at
)
SELECT * FROM merged_data
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
  updated_at = NOW()
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

