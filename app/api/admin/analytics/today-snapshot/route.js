/**
 * Today's Snapshot API
 * Returns appointments and cancellations for today
 * 
 * GET /api/admin/analytics/today-snapshot?organizationId=xxx&locationId=yyy
 */

export const dynamic = 'force-dynamic'

import prisma from '@/lib/prisma-client'
import { checkOrganizationAccess } from '@/lib/auth/check-access'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    const locationId = searchParams.get('locationId')

    if (!organizationId) {
      return Response.json({ error: 'organizationId is required' }, { status: 400 })
    }

    const access = await checkOrganizationAccess(request, organizationId)
    if (!access) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const pacificRows = await prisma.$queryRaw`
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date AS d
    `
    const pacificDate = pacificRows[0].d
    const dateStr =
      pacificDate instanceof Date
        ? pacificDate.toISOString().slice(0, 10)
        : String(pacificDate).slice(0, 10)

    // Same logic as analytics_appointments_by_location_daily (canonical booking + active segment for ACCEPTED)
    const snapshotRows = locationId
      ? await prisma.$queryRaw`
          SELECT
            COALESCE(SUM(appointments_count), 0)::int AS accepted,
            COALESCE(SUM(cancelled_by_customer), 0)::int AS cancelled_by_customer,
            COALESCE(SUM(cancelled_by_seller), 0)::int AS cancelled_by_seller,
            COALESCE(SUM(no_show_appointments), 0)::int AS no_show
          FROM analytics_appointments_by_location_daily
          WHERE organization_id = ${organizationId}::uuid
            AND date = ${pacificDate}::date
            AND location_id = ${locationId}::uuid
        `
      : await prisma.$queryRaw`
          SELECT
            COALESCE(SUM(appointments_count), 0)::int AS accepted,
            COALESCE(SUM(cancelled_by_customer), 0)::int AS cancelled_by_customer,
            COALESCE(SUM(cancelled_by_seller), 0)::int AS cancelled_by_seller,
            COALESCE(SUM(no_show_appointments), 0)::int AS no_show
          FROM analytics_appointments_by_location_daily
          WHERE organization_id = ${organizationId}::uuid
            AND date = ${pacificDate}::date
        `

    const snap = snapshotRows[0] || {}
    const byCustomer = Number(snap.cancelled_by_customer || 0)
    const bySeller = Number(snap.cancelled_by_seller || 0)
    const noShow = Number(snap.no_show || 0)
    const cancellationsTotal = byCustomer + bySeller + noShow
    const appointmentsToday = Number(snap.accepted || 0)

    const revenueToday = locationId
      ? await prisma.$queryRaw`
          SELECT
            SUM(revenue_dollars) as total_revenue,
            SUM(payment_count) as total_payments,
            COUNT(*) as location_records
          FROM analytics_revenue_by_location_daily
          WHERE DATE(date) = ${pacificDate}::date
            AND organization_id = ${organizationId}::uuid
            AND location_id = ${locationId}::uuid
        `
      : await prisma.$queryRaw`
          SELECT
            SUM(revenue_dollars) as total_revenue,
            SUM(payment_count) as total_payments,
            COUNT(*) as location_records
          FROM analytics_revenue_by_location_daily
          WHERE DATE(date) = ${pacificDate}::date
            AND organization_id = ${organizationId}::uuid
        `

    const revenue = revenueToday[0]

    return Response.json({
      date: dateStr,
      appointments: {
        accepted: appointmentsToday,
        total: appointmentsToday
      },
      cancellations: {
        total: cancellationsTotal,
        by_customer: byCustomer,
        by_seller: bySeller,
        no_show: noShow
      },
      revenue: {
        total_dollars: Number(revenue?.total_revenue || 0),
        total_payments: Number(revenue?.total_payments || 0)
      }
    })
  } catch (error) {
    console.error('Today snapshot error:', error)
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

