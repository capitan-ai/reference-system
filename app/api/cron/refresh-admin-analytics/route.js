import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { saveApplicationLog } = require('../../../../lib/workflows/application-log-queue')
const { PrismaClient } = require('@prisma/client')
const { refreshAdminCreatedBookingFacts } = require('../../../../lib/analytics/admin-created-booking-facts')

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
  
  if (authHeader === `Bearer ${cronSecret}` || authHeader === cronSecret || cronHeader === cronSecret) {
    return { authorized: true }
  }

  return { authorized: false }
}

export async function GET(request) {
  const startTime = Date.now()
  console.log(`[CRON] Admin analytics refresh triggered at ${new Date().toISOString()}`)
  
  const auth = authorize(request)
  if (!auth.authorized) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = new URL(request.url)
  const daysParam = url.searchParams.get('days')
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')

  const cronId = `cron-refresh-admin-analytics-${Date.now()}`
  const prisma = new PrismaClient()

  try {
    // 1. Log start
    await saveApplicationLog(logPrisma, {
      logType: 'cron',
      logId: cronId,
      logCreatedAt: new Date(),
      payload: {
        cron_name: 'refresh-admin-analytics',
        worker_id: 'vercel-cron',
        triggered_at: new Date().toISOString(),
        params: { days: daysParam, from: fromParam, to: toParam }
      },
      status: 'processing'
    }).catch(() => {})

    // 2. Determine date range
    let dateFrom, dateTo
    if (fromParam && toParam) {
      dateFrom = `'${fromParam} 00:00:00'`
      dateTo = `'${toParam} 23:59:59'`
    } else {
      const days = parseInt(daysParam || '35')
      dateFrom = `NOW() - interval '${days} days'`
      dateTo = `NOW() + interval '1 day'`
    }

    // 3. Refresh admin_created_booking_facts (prior-paid New vs Rebook)
    try {
      const factsResult = await refreshAdminCreatedBookingFacts(prisma, dateFrom, dateTo)
      console.log(`[CRON] Facts: inserted=${factsResult.inserted} updated=${factsResult.updated} skipped=${factsResult.skipped} deleted=${factsResult.deleted ?? 0}`)
    } catch (factsErr) {
      console.error(`[CRON] Facts refresh error (continuing): ${factsErr.message}`)
    }

    // 4. Remove analytics for inactive team members
    await prisma.$executeRawUnsafe(`
      DELETE FROM admin_analytics_daily
      WHERE team_member_id IN (SELECT id FROM team_members WHERE status = 'INACTIVE')
    `)

    // 5. Execute Refresh SQL
    const refreshSQL = `
      WITH date_range AS (
        SELECT 
          (${dateFrom})::timestamptz as start_limit,
          (${dateTo})::timestamptz as end_limit
      ),

      -- First accepted booking per customer (org-wide) to classify new client vs rebooking
      first_accepted_booking_per_customer AS (
        SELECT organization_id, customer_id, MIN(start_at) AS first_start_at
        FROM bookings
        WHERE status = 'ACCEPTED' AND customer_id IS NOT NULL
        GROUP BY organization_id, customer_id
      ),
      
      -- Base set of appointment-linked payments (by created_at date for consistency)
      -- Net sales = total minus tips (no tips or other amounts for creator/cashier revenue)
      appointment_payments AS (
        SELECT 
          p.id as payment_id,
          p.total_money_amount,
          p.tip_money_amount,
          (p.total_money_amount - COALESCE(p.tip_money_amount, 0)) as net_sales_cents,
          b.id as booking_id,
          b.organization_id,
          b.location_id,
          b.administrator_id as raw_creator_id,
          p.administrator_id as raw_cashier_id,
          DATE(b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as date_pacific
        FROM payments p
        INNER JOIN bookings b ON p.booking_id = b.id
        CROSS JOIN date_range dr
        WHERE p.status = 'COMPLETED'
          AND b.created_at >= dr.start_limit
          AND b.created_at < dr.end_limit
      ),

      -- Resolve team member IDs (handling Unattributed)
      resolved_payments AS (
        SELECT
          ap.*,
          COALESCE(ap.raw_creator_id, tm_sys.id) as creator_id,
          COALESCE(ap.raw_cashier_id, tm_sys.id) as cashier_id
        FROM appointment_payments ap
        LEFT JOIN team_members tm_sys 
          ON tm_sys.organization_id = ap.organization_id 
          AND tm_sys.is_system = true
      ),

      -- Creator Money Aggregation (Net Sales only, no tips)
      creator_money_agg AS (
        SELECT
          organization_id,
          creator_id as team_member_id,
          location_id,
          date_pacific,
          COUNT(DISTINCT payment_id) as creator_payments_count,
          SUM(net_sales_cents) as creator_revenue_cents
        FROM resolved_payments
        GROUP BY 1, 2, 3, 4
      ),

      -- Cashier Money Aggregation (Net Sales for revenue; tips kept separate)
      cashier_money_agg AS (
        SELECT
          organization_id,
          cashier_id as team_member_id,
          location_id,
          date_pacific,
          COUNT(DISTINCT payment_id) as cashier_payments_count,
          SUM(net_sales_cents) as cashier_revenue_cents,
          SUM(tip_money_amount) as cashier_tips_cents
        FROM resolved_payments
        GROUP BY 1, 2, 3, 4
      ),

      -- Visits Aggregation (Creator-based, by created_at date for consistency)
      -- Revenue is attributed to who made the booking (administrator_id), not who took the payment.
      -- new_client = first ever accepted booking for that customer; rebooking = any later accepted booking.
      visits_agg AS (
        SELECT
          b.organization_id,
          COALESCE(b.administrator_id, tm_sys.id) AS team_member_id,
          b.location_id,
          DATE(b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') AS date_pacific,
          COUNT(*) AS appointments_total,
          COUNT(*) FILTER (WHERE b.status = 'ACCEPTED') AS appointments_accepted,
          COUNT(*) FILTER (WHERE b.status = 'ACCEPTED' AND b.customer_id IS NOT NULL AND fab.first_start_at IS NOT NULL AND b.start_at = fab.first_start_at) AS new_client_bookings_count,
          COUNT(*) FILTER (WHERE b.status = 'ACCEPTED' AND b.customer_id IS NOT NULL AND fab.first_start_at IS NOT NULL AND b.start_at <> fab.first_start_at) AS rebooking_count,
          COUNT(*) FILTER (WHERE b.status = 'NO_SHOW') AS appointments_no_show,
          COUNT(*) FILTER (WHERE b.status LIKE 'CANCELLED%') AS appointments_cancelled,
          COUNT(*) FILTER (
            WHERE b.status LIKE 'CANCELLED%'
            AND (b.start_at - b.updated_at) < interval '24 hours'
          ) AS late_cancellations,
          COUNT(*) FILTER (
            WHERE b.status LIKE 'CANCELLED%'
            AND (b.start_at - b.updated_at) >= interval '24 hours'
          ) AS early_cancellations
        FROM bookings b
        CROSS JOIN date_range dr
        LEFT JOIN team_members tm_sys
          ON tm_sys.organization_id = b.organization_id
          AND tm_sys.is_system = true
        LEFT JOIN first_accepted_booking_per_customer fab
          ON fab.organization_id = b.organization_id AND fab.customer_id = b.customer_id
        WHERE b.created_at >= dr.start_limit AND b.created_at < dr.end_limit
        GROUP BY 1, 2, 3, 4
      ),

      -- NEW: Bookings Created Aggregation (by created_at date)
      -- This ensures that if a booking is created today for next month, 
      -- it shows up in today's performance stats.
      created_agg AS (
        SELECT
          b.organization_id,
          COALESCE(b.administrator_id, tm_sys.id) as team_member_id,
          b.location_id,
          DATE(b.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as date_pacific,
          COUNT(*) as bookings_created_count
        FROM bookings b
        CROSS JOIN date_range dr
        LEFT JOIN team_members tm_sys 
          ON tm_sys.organization_id = b.organization_id 
          AND tm_sys.is_system = true
        WHERE b.created_at >= dr.start_limit AND b.created_at < dr.end_limit
          AND (b.creator_type = 'TEAM_MEMBER' 
               OR (b.raw_json->'creator_details'->>'creator_type' = 'TEAM_MEMBER')
               OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.square_team_member_id = b.raw_json->'creator_details'->>'team_member_id'))
          AND (COALESCE(b.source, b.raw_json->>'source') IS NULL
               OR COALESCE(b.source, b.raw_json->>'source') = 'FIRST_PARTY_MERCHANT')
        GROUP BY 1, 2, 3, 4
      ),

      -- Admin created booking facts: New vs Rebook (prior-paid logic) + same/future/past month
      admin_created_facts_agg AS (
        SELECT
          organization_id,
          administrator_id_snapshot as team_member_id,
          location_id,
          created_day_pacific as date_pacific,
          COUNT(*) FILTER (WHERE classification_snapshot = 'NEW_CLIENT') as new_client_bookings_count,
          COUNT(*) FILTER (WHERE classification_snapshot = 'REBOOKING') as rebooking_count,
          COUNT(*) FILTER (WHERE is_same_month) as same_month_count,
          COUNT(*) FILTER (WHERE is_future_month) as future_months_count,
          COUNT(*) FILTER (WHERE is_past_month) as past_month_count
        FROM admin_created_booking_facts
        WHERE created_at_utc >= (${dateFrom})::timestamptz
          AND created_at_utc < (${dateTo})::timestamptz
        GROUP BY 1, 2, 3, 4
      ),

      -- Unified Keys
      keys AS (
        SELECT organization_id, team_member_id, location_id, date_pacific FROM visits_agg
        UNION DISTINCT
        SELECT organization_id, team_member_id, location_id, date_pacific FROM created_agg
        UNION DISTINCT
        SELECT organization_id, team_member_id, location_id, date_pacific FROM admin_created_facts_agg
        UNION DISTINCT
        SELECT organization_id, team_member_id, location_id, date_pacific FROM creator_money_agg
        UNION DISTINCT
        SELECT organization_id, team_member_id, location_id, date_pacific FROM cashier_money_agg
      )

      -- Final UPSERT
      INSERT INTO admin_analytics_daily (
        organization_id, team_member_id, location_id, date_pacific,
        given_name, family_name, role,
        appointments_total, appointments_accepted, appointments_no_show, appointments_cancelled, late_cancellations, early_cancellations,
        bookings_created_count, new_customers_booked_count, rebookings_count,
        bookings_current_month_count, bookings_future_months_count,
        creator_payments_count, creator_revenue_cents, creator_avg_ticket_cents,
        cashier_payments_count, cashier_revenue_cents, cashier_tips_cents, cashier_avg_ticket_cents,
        updated_at
      )
      SELECT
        k.organization_id, k.team_member_id, k.location_id, k.date_pacific,
        tm.given_name, tm.family_name, tm.role::text,
        COALESCE(v.appointments_total, 0),
        COALESCE(v.appointments_accepted, 0),
        COALESCE(v.appointments_no_show, 0),
        COALESCE(v.appointments_cancelled, 0),
        COALESCE(v.late_cancellations, 0),
        COALESCE(v.early_cancellations, 0),
        COALESCE(c.bookings_created_count, 0),
        COALESCE(f.new_client_bookings_count, 0),
        COALESCE(f.rebooking_count, 0),
        COALESCE(f.same_month_count, 0),
        COALESCE(f.future_months_count, 0),
        COALESCE(cr.creator_payments_count, 0),
        COALESCE(cr.creator_revenue_cents, 0),
        CASE WHEN COALESCE(cr.creator_payments_count, 0) > 0 
             THEN cr.creator_revenue_cents / cr.creator_payments_count 
             ELSE 0 END,
        COALESCE(ca.cashier_payments_count, 0),
        COALESCE(ca.cashier_revenue_cents, 0),
        COALESCE(ca.cashier_tips_cents, 0),
        CASE WHEN COALESCE(ca.cashier_payments_count, 0) > 0 
             THEN ca.cashier_revenue_cents / ca.cashier_payments_count 
             ELSE 0 END,
        NOW()
      FROM keys k
      JOIN team_members tm ON tm.id = k.team_member_id AND (tm.status IS NULL OR tm.status <> 'INACTIVE')
      LEFT JOIN visits_agg v 
        ON v.organization_id = k.organization_id 
        AND v.team_member_id = k.team_member_id 
        AND v.location_id = k.location_id 
        AND v.date_pacific = k.date_pacific
      LEFT JOIN created_agg c
        ON c.organization_id = k.organization_id 
        AND c.team_member_id = k.team_member_id 
        AND c.location_id = k.location_id 
        AND c.date_pacific = k.date_pacific
      LEFT JOIN admin_created_facts_agg f
        ON f.organization_id = k.organization_id 
        AND f.team_member_id = k.team_member_id 
        AND f.location_id = k.location_id 
        AND f.date_pacific = k.date_pacific
      LEFT JOIN creator_money_agg cr
        ON cr.organization_id = k.organization_id 
        AND cr.team_member_id = k.team_member_id 
        AND cr.location_id = k.location_id 
        AND cr.date_pacific = k.date_pacific
      LEFT JOIN cashier_money_agg ca
        ON ca.organization_id = k.organization_id 
        AND ca.team_member_id = k.team_member_id 
        AND ca.location_id = k.location_id 
        AND ca.date_pacific = k.date_pacific
      ON CONFLICT (organization_id, team_member_id, location_id, date_pacific)
      DO UPDATE SET
        given_name = EXCLUDED.given_name,
        family_name = EXCLUDED.family_name,
        role = EXCLUDED.role,
        appointments_total = EXCLUDED.appointments_total,
        appointments_accepted = EXCLUDED.appointments_accepted,
        appointments_no_show = EXCLUDED.appointments_no_show,
        appointments_cancelled = EXCLUDED.appointments_cancelled,
        late_cancellations = EXCLUDED.late_cancellations,
        early_cancellations = EXCLUDED.early_cancellations,
        bookings_created_count = EXCLUDED.bookings_created_count,
        new_customers_booked_count = EXCLUDED.new_customers_booked_count,
        rebookings_count = EXCLUDED.rebookings_count,
        bookings_current_month_count = EXCLUDED.bookings_current_month_count,
        bookings_future_months_count = EXCLUDED.bookings_future_months_count,
        creator_payments_count = EXCLUDED.creator_payments_count,
        creator_revenue_cents = EXCLUDED.creator_revenue_cents,
        creator_avg_ticket_cents = EXCLUDED.creator_avg_ticket_cents,
        cashier_payments_count = EXCLUDED.cashier_payments_count,
        cashier_revenue_cents = EXCLUDED.cashier_revenue_cents,
        cashier_tips_cents = EXCLUDED.cashier_tips_cents,
        cashier_avg_ticket_cents = EXCLUDED.cashier_avg_ticket_cents,
        updated_at = NOW();
    `

    await prisma.$executeRawUnsafe(refreshSQL)

    // 4. Log success
    const duration = Date.now() - startTime
    console.log(`[CRON] Admin analytics refresh completed in ${duration}ms`)
    
    await saveApplicationLog(logPrisma, {
      logType: 'cron',
      logId: cronId,
      logCreatedAt: new Date(),
      payload: {
        cron_name: 'refresh-admin-analytics',
        duration_ms: duration,
        status: 'success'
      },
      status: 'completed'
    }).catch(() => {})

    return json({ success: true, duration_ms: duration })
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[CRON] Error after ${duration}ms refreshing admin analytics:`, error.message)
    console.error(error.stack)
    
    await saveApplicationLog(logPrisma, {
      logType: 'cron',
      logId: cronId,
      logCreatedAt: new Date(),
      payload: {
        cron_name: 'refresh-admin-analytics',
        duration_ms: duration,
        error: error.message,
        stack: error.stack
      },
      status: 'failed'
    }).catch(() => {})

    return json({ error: error.message, duration_ms: duration }, 500)
  } finally {
    await prisma.$disconnect()
  }
}
