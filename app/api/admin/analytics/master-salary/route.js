/**
 * Master Salary API
 *
 * GET /api/admin/analytics/master-salary?organizationId=xxx&period=2026-03&locationId=yyy
 *
 * Returns per-master salary breakdown for a given month:
 * - commission, tips, discount adjustments, fix transfers, manual adjustments, reversals
 * - paid hours (from master_weekly_schedule), sales per hour, utilization
 * - booking count, fix count
 */

export const dynamic = 'force-dynamic'

import prisma from '@/lib/prisma-client'
import { checkOrganizationAccess } from '@/lib/auth/check-access'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    const period = searchParams.get('period') // YYYY-MM
    const locationId = searchParams.get('locationId')

    if (!organizationId || !period) {
      return Response.json(
        { error: 'organizationId and period (YYYY-MM) are required' },
        { status: 400 }
      )
    }

    const access = await checkOrganizationAccess(request, organizationId)
    if (!access) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Parse period into date range
    const [year, month] = period.split('-').map(Number)
    if (!year || !month || month < 1 || month > 12) {
      return Response.json({ error: 'Invalid period format. Use YYYY-MM' }, { status: 400 })
    }
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, '0')}-01`

    // Build location filter
    const locationFilter = locationId ? `AND b.location_id = $3::uuid` : ''
    const params = locationId
      ? [organizationId, startDate, locationId, endDate]
      : [organizationId, startDate, endDate]
    const endDateParam = locationId ? '$4' : '$3'

    // ── Ledger aggregation by master ──
    const earningsSQL = `
      SELECT
        mel.team_member_id,
        SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION') AS commission_cents,
        SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'TIP') AS tips_cents,
        SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'DISCOUNT_ADJUSTMENT') AS discount_cents,
        SUM(mel.amount_amount) FILTER (WHERE mel.entry_type IN ('FIX_PENALTY', 'FIX_COMPENSATION')) AS fix_cents,
        SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'MANUAL_ADJUSTMENT') AS manual_cents,
        SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'REVERSAL') AS reversal_cents,
        COUNT(DISTINCT mel.booking_id) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION') AS booking_count,
        SUM(mel.amount_amount) AS total_net_cents
      FROM master_earnings_ledger mel
      LEFT JOIN bookings b ON b.id = mel.booking_id AND b.organization_id = mel.organization_id
      WHERE mel.organization_id = $1::uuid
        AND (
          (b.id IS NOT NULL AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
            AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date < ${endDateParam}::date)
          OR
          (b.id IS NULL AND (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
            AND (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date < ${endDateParam}::date)
        )
        ${locationFilter}
      GROUP BY mel.team_member_id
    `

    // ── Booking stats (gross, minutes, fix count) ──
    const bookingSQL = `
      SELECT
        b.technician_id AS team_member_id,
        SUM(COALESCE(bs.price_snapshot_amount, 0))::bigint AS gross_cents,
        SUM(COALESCE(b.duration_minutes, 0))::int AS booked_minutes,
        COUNT(*) FILTER (WHERE bs.is_fix = true)::int AS fix_count
      FROM bookings b
      LEFT JOIN booking_snapshots bs ON bs.booking_id = b.id
      WHERE b.organization_id = $1::uuid
        AND b.status = 'ACCEPTED'
        AND b.technician_id IS NOT NULL
        AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
        AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date < ${endDateParam}::date
        ${locationFilter}
      GROUP BY b.technician_id
    `

    // ── Paid hours from weekly schedule ──
    // Count working days in the period per master, multiply by daily scheduled_minutes
    const scheduleSQL = `
      WITH period_days AS (
        SELECT generate_series($2::date, (${endDateParam}::date - interval '1 day')::date, '1 day'::interval)::date AS d
      ),
      master_days AS (
        SELECT
          ws.team_member_id,
          SUM(ws.scheduled_minutes) AS total_scheduled_minutes
        FROM master_weekly_schedule ws
        CROSS JOIN period_days pd
        WHERE ws.organization_id = $1::uuid
          AND ws.day_of_week = EXTRACT(DOW FROM pd.d)::int
          ${locationId ? 'AND ws.location_id = $3::uuid' : ''}
        GROUP BY ws.team_member_id
      )
      SELECT team_member_id, total_scheduled_minutes FROM master_days
    `

    // ── Adjustment count ──
    const adjustmentSQL = `
      SELECT
        COALESCE(fault_master_id, compensated_master_id) AS team_member_id,
        COUNT(*)::int AS adjustment_count,
        SUM(amount_cents)::bigint AS adjustment_total_cents
      FROM master_adjustments
      WHERE organization_id = $1::uuid
        AND status = 'APPLIED'
        AND created_at >= $2::date
        AND created_at < ${endDateParam}::date
      GROUP BY 1
    `

    // Execute all queries in parallel
    const [earnings, bookings, schedules, adjustments, teamMembers, settings] =
      await Promise.all([
        prisma.$queryRawUnsafe(earningsSQL, ...params),
        prisma.$queryRawUnsafe(bookingSQL, ...params),
        prisma.$queryRawUnsafe(scheduleSQL, ...params),
        prisma.$queryRawUnsafe(adjustmentSQL, ...params),
        prisma.teamMember.findMany({
          where: { organization_id: organizationId, status: 'ACTIVE' },
          select: { id: true, given_name: true, family_name: true },
        }),
        prisma.masterSettings.findMany({
          select: {
            team_member_id: true,
            commission_rate: true,
            category: true,
            location_code: true,
          },
        }),
      ])

    // Build lookup maps
    const earningsMap = new Map(earnings.map((e) => [e.team_member_id, e]))
    const bookingsMap = new Map(bookings.map((b) => [b.team_member_id, b]))
    const scheduleMap = new Map(schedules.map((s) => [s.team_member_id, s]))
    const adjustmentMap = new Map(adjustments.map((a) => [a.team_member_id, a]))
    const settingsMap = new Map(settings.map((s) => [s.team_member_id, s]))

    // Get all master IDs that have any data
    const masterIds = new Set([
      ...earnings.map((e) => e.team_member_id),
      ...bookings.map((b) => b.team_member_id),
    ])

    const masters = []
    for (const masterId of masterIds) {
      const tm = teamMembers.find((t) => t.id === masterId)
      if (!tm) continue

      const e = earningsMap.get(masterId) || {}
      const b = bookingsMap.get(masterId) || {}
      const s = scheduleMap.get(masterId)
      const a = adjustmentMap.get(masterId)
      const ms = settingsMap.get(masterId)

      const commissionCents = Number(e.commission_cents || 0)
      const tipsCents = Number(e.tips_cents || 0)
      const discountCents = Number(e.discount_cents || 0)
      const fixCents = Number(e.fix_cents || 0)
      const manualCents = Number(e.manual_cents || 0)
      const reversalCents = Number(e.reversal_cents || 0)
      const netSalaryCents = commissionCents + discountCents + fixCents + manualCents + reversalCents
      const grossCents = Number(b.gross_cents || 0)
      const paidMinutes = Number(s?.total_scheduled_minutes || 0)
      const paidHours = paidMinutes / 60
      const bookedMinutes = Number(b.booked_minutes || 0)

      masters.push({
        master_id: masterId,
        name: `${tm.given_name || ''} ${tm.family_name || ''}`.trim(),
        category: ms?.category || 'UNKNOWN',
        location: ms?.location_code || 'UNKNOWN',
        commission_rate: ms?.commission_rate || 0,
        gross_sales_cents: grossCents,
        commission_cents: commissionCents,
        tips_cents: tipsCents,
        discount_adjustment_cents: discountCents,
        fix_transfer_cents: fixCents,
        manual_adjustment_cents: manualCents,
        reversal_cents: reversalCents,
        net_salary_cents: netSalaryCents,
        total_with_tips_cents: netSalaryCents + tipsCents,
        paid_hours: Math.round(paidHours * 10) / 10,
        sales_per_hour_cents: paidHours > 0 ? Math.round(grossCents / paidHours) : 0,
        booked_minutes: bookedMinutes,
        booking_count: Number(e.booking_count || 0),
        fix_count: Number(b.fix_count || 0),
        utilization_rate:
          paidMinutes > 0
            ? Math.round((bookedMinutes / paidMinutes) * 1000) / 1000
            : 0,
        adjustment_count: Number(a?.adjustment_count || 0),
        adjustment_total_cents: Number(a?.adjustment_total_cents || 0),
      })
    }

    // Sort by net salary descending
    masters.sort((a, b) => b.net_salary_cents - a.net_salary_cents)

    // Totals
    const totals = {
      gross_sales_cents: masters.reduce((s, m) => s + m.gross_sales_cents, 0),
      commission_cents: masters.reduce((s, m) => s + m.commission_cents, 0),
      tips_cents: masters.reduce((s, m) => s + m.tips_cents, 0),
      discount_adjustment_cents: masters.reduce((s, m) => s + m.discount_adjustment_cents, 0),
      fix_transfer_cents: masters.reduce((s, m) => s + m.fix_transfer_cents, 0),
      net_salary_cents: masters.reduce((s, m) => s + m.net_salary_cents, 0),
      total_with_tips_cents: masters.reduce((s, m) => s + m.total_with_tips_cents, 0),
      master_count: masters.length,
    }

    return Response.json({ period, masters, totals })
  } catch (error) {
    console.error('[MASTER-SALARY] Error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
