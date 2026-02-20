/**
 * Secure Admin Analytics Refresh Endpoint
 * Allows authenticated admins to trigger a refresh of the admin_analytics_daily table
 * without exposing the CRON_SECRET to the frontend.
 */

import { isSuperAdminFromRequest } from '../../../../../lib/auth/check-access'
import { prisma } from '../../../../../lib/prisma-client'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    // 1. Check if user is authenticated and is an admin
    // Note: We use isSuperAdminFromRequest but you could also use a more general isAdmin check
    const isSuperAdmin = await isSuperAdminFromRequest(request)
    if (!isSuperAdmin) {
      return Response.json(
        { error: 'Unauthorized. Admin access required.' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const daysParam = searchParams.get('days')
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')

    // 2. Determine date range (same logic as cron)
    let dateFrom, dateTo
    if (fromParam && toParam) {
      dateFrom = `${fromParam} 00:00:00`
      dateTo = `${toParam} 23:59:59`
    } else {
      const days = parseInt(daysParam || '35')
      dateFrom = `NOW() - interval '${days} days'`
      dateTo = `NOW() + interval '1 day'`
    }

    // 3. Execute the "Golden Query"
    const refreshSQL = `
      WITH date_range AS (
        SELECT 
          (${dateFrom})::timestamptz as start_limit,
          (${dateTo})::timestamptz as end_limit
      ),
      
      -- Base set of appointment-linked payments
      appointment_payments AS (
        SELECT 
          p.id as payment_id, 
          p.total_money_amount, 
          p.tip_money_amount,
          b.id as booking_id, 
          b.organization_id, 
          b.location_id,
          b.administrator_id as raw_creator_id,
          p.administrator_id as raw_cashier_id,
          DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as date_pacific
        FROM payments p
        INNER JOIN bookings b ON p.booking_id = b.id
        CROSS JOIN date_range dr
        WHERE p.status = 'COMPLETED' 
          AND b.start_at >= dr.start_limit 
          AND b.start_at < dr.end_limit
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

      -- Creator Money Aggregation
      creator_money_agg AS (
        SELECT
          organization_id,
          creator_id as team_member_id,
          location_id,
          date_pacific,
          COUNT(DISTINCT payment_id) as creator_payments_count,
          SUM(total_money_amount) as creator_revenue_cents
        FROM resolved_payments
        GROUP BY 1, 2, 3, 4
      ),

      -- Cashier Money Aggregation
      cashier_money_agg AS (
        SELECT
          organization_id,
          cashier_id as team_member_id,
          location_id,
          date_pacific,
          COUNT(DISTINCT payment_id) as cashier_payments_count,
          SUM(total_money_amount) as cashier_revenue_cents,
          SUM(tip_money_amount) as cashier_tips_cents
        FROM resolved_payments
        GROUP BY 1, 2, 3, 4
      ),

      -- Visits Aggregation (Creator-based)
      visits_agg AS (
        SELECT
          b.organization_id,
          COALESCE(b.administrator_id, tm_sys.id) as team_member_id,
          b.location_id,
          DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as date_pacific,
          COUNT(*) as appointments_total,
          COUNT(*) FILTER (WHERE b.status = 'ACCEPTED') as appointments_accepted,
          COUNT(*) FILTER (WHERE b.status = 'NO_SHOW') as appointments_no_show,
          COUNT(*) FILTER (WHERE b.status LIKE 'CANCELLED%') as appointments_cancelled,
          COUNT(*) FILTER (
            WHERE b.status LIKE 'CANCELLED%' 
            AND (b.start_at - b.updated_at) < interval '24 hours'
          ) as late_cancellations
        FROM bookings b
        CROSS JOIN date_range dr
        LEFT JOIN team_members tm_sys 
          ON tm_sys.organization_id = b.organization_id 
          AND tm_sys.is_system = true
        WHERE b.start_at >= dr.start_limit 
          AND b.start_at < dr.end_limit
        GROUP BY 1, 2, 3, 4
      ),

      -- Unified Keys
      keys AS (
        SELECT organization_id, team_member_id, location_id, date_pacific FROM visits_agg
        UNION DISTINCT
        SELECT organization_id, team_member_id, location_id, date_pacific FROM creator_money_agg
        UNION DISTINCT
        SELECT organization_id, team_member_id, location_id, date_pacific FROM cashier_money_agg
      )

      -- Final UPSERT
      INSERT INTO admin_analytics_daily (
        organization_id, team_member_id, location_id, date_pacific,
        given_name, family_name, role,
        appointments_total, appointments_accepted, appointments_no_show, appointments_cancelled, late_cancellations,
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
      JOIN team_members tm ON tm.id = k.team_member_id
      LEFT JOIN visits_agg v 
        ON v.organization_id = k.organization_id 
        AND v.team_member_id = k.team_member_id 
        AND v.location_id = k.location_id 
        AND v.date_pacific = k.date_pacific
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

    return Response.json({ success: true, message: 'Admin analytics refreshed successfully' })
  } catch (error) {
    console.error(`[ADMIN-API] Error refreshing admin analytics: ${error.message}`)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

