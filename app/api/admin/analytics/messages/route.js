/**
 * Message Analytics Endpoint
 * Returns aggregated notification statistics by channel, template, status.
 *
 * GET /api/admin/analytics/messages?organizationId=xxx&startDate=2026-01-01&endDate=2026-03-31
 */

export const dynamic = 'force-dynamic'

import prisma from '@/lib/prisma-client'
import { checkOrganizationAccess } from '@/lib/auth/check-access'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const channel = searchParams.get('channel') // optional: SMS or EMAIL

    if (!organizationId) {
      return Response.json({ error: 'organizationId is required' }, { status: 400 })
    }

    const access = await checkOrganizationAccess(request, organizationId)
    if (!access) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Build date filter
    const params = [organizationId]
    let dateFilter = ''
    if (startDate) {
      dateFilter += ` AND ne."createdAt" >= $${params.length + 1}::timestamptz`
      params.push(startDate)
    }
    if (endDate) {
      dateFilter += ` AND ne."createdAt" <= ($${params.length + 1}::date + interval '1 day')::timestamptz`
      params.push(endDate)
    }

    let channelFilter = ''
    if (channel && (channel === 'SMS' || channel === 'EMAIL')) {
      channelFilter = ` AND ne.channel = $${params.length + 1}::"NotificationChannel"`
      params.push(channel)
    }

    // 1. Summary by channel
    const summaryByChannel = await prisma.$queryRawUnsafe(`
      SELECT
        ne.channel,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ne.status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE ne.status = 'delivered')::int AS delivered,
        COUNT(*) FILTER (WHERE ne.status = 'opened')::int AS opened,
        COUNT(*) FILTER (WHERE ne.status = 'clicked')::int AS clicked,
        COUNT(*) FILTER (WHERE ne.status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE ne.status = 'bounced')::int AS bounced,
        CASE
          WHEN COUNT(*) FILTER (WHERE ne.status IN ('sent','delivered','opened','clicked')) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE ne.status IN ('delivered','opened','clicked'))::numeric /
            COUNT(*) FILTER (WHERE ne.status IN ('sent','delivered','opened','clicked'))::numeric * 100, 1
          )
          ELSE 0
        END AS delivery_rate_pct
      FROM notification_events ne
      WHERE ne.organization_id = $1::uuid
        ${dateFilter}
        ${channelFilter}
      GROUP BY ne.channel
      ORDER BY ne.channel
    `, ...params)

    // 2. Summary by template type
    const summaryByTemplate = await prisma.$queryRawUnsafe(`
      SELECT
        ne."templateType",
        ne.channel,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ne.status IN ('delivered','opened','clicked'))::int AS delivered,
        COUNT(*) FILTER (WHERE ne.status IN ('failed','bounced'))::int AS failed
      FROM notification_events ne
      WHERE ne.organization_id = $1::uuid
        ${dateFilter}
        ${channelFilter}
      GROUP BY ne."templateType", ne.channel
      ORDER BY ne."templateType", ne.channel
    `, ...params)

    // 3. Daily trend
    const dailyTrend = await prisma.$queryRawUnsafe(`
      SELECT
        (ne."createdAt" AT TIME ZONE 'America/Los_Angeles')::date AS date,
        ne.channel,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ne.status IN ('delivered','opened','clicked'))::int AS delivered,
        COUNT(*) FILTER (WHERE ne.status IN ('failed','bounced'))::int AS failed
      FROM notification_events ne
      WHERE ne.organization_id = $1::uuid
        ${dateFilter}
        ${channelFilter}
      GROUP BY (ne."createdAt" AT TIME ZONE 'America/Los_Angeles')::date, ne.channel
      ORDER BY date DESC, ne.channel
    `, ...params)

    // 4. Recent failures (last 20)
    const recentFailures = await prisma.$queryRawUnsafe(`
      SELECT
        ne.id,
        ne.channel,
        ne."templateType",
        ne.status,
        ne."customerId",
        ne."errorCode",
        ne."errorMessage",
        ne."createdAt",
        sec.given_name,
        sec.family_name
      FROM notification_events ne
      LEFT JOIN square_existing_clients sec
        ON sec.square_customer_id = ne."customerId"
        AND sec.organization_id = ne.organization_id
      WHERE ne.organization_id = $1::uuid
        AND ne.status IN ('failed', 'bounced')
        ${dateFilter}
        ${channelFilter}
      ORDER BY ne."createdAt" DESC
      LIMIT 20
    `, ...params)

    // 5. Totals
    const totals = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total_notifications,
        COUNT(DISTINCT ne."customerId")::int AS unique_customers,
        COUNT(*) FILTER (WHERE ne.channel = 'SMS')::int AS total_sms,
        COUNT(*) FILTER (WHERE ne.channel = 'EMAIL')::int AS total_email,
        COUNT(*) FILTER (WHERE ne.status IN ('delivered','opened','clicked'))::int AS total_delivered,
        COUNT(*) FILTER (WHERE ne.status IN ('failed','bounced'))::int AS total_failed,
        CASE
          WHEN COUNT(*) FILTER (WHERE ne.status IN ('sent','delivered','opened','clicked')) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE ne.status IN ('delivered','opened','clicked'))::numeric /
            COUNT(*) FILTER (WHERE ne.status IN ('sent','delivered','opened','clicked'))::numeric * 100, 1
          )
          ELSE 0
        END AS overall_delivery_rate_pct
      FROM notification_events ne
      WHERE ne.organization_id = $1::uuid
        ${dateFilter}
        ${channelFilter}
    `, ...params)

    return Response.json({
      totals: totals[0] || {},
      by_channel: summaryByChannel,
      by_template: summaryByTemplate,
      daily_trend: dailyTrend,
      recent_failures: recentFailures,
      filters: {
        organizationId,
        startDate: startDate || null,
        endDate: endDate || null,
        channel: channel || 'all'
      }
    })

  } catch (error) {
    console.error('Message analytics error:', error.message)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
