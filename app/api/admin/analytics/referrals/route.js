/**
 * Referral Analytics Endpoint (reads from primary referral_rewards table)
 * Returns accurate reward totals, new customers via referral, and notification stats.
 *
 * GET /api/admin/analytics/referrals?organizationId=xxx&startDate=2026-01-01&endDate=2026-03-31
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
      dateFilter += ` AND rr.created_at >= $${params.length + 1}::timestamptz`
      params.push(startDate)
    }
    if (endDate) {
      dateFilter += ` AND rr.created_at <= ($${params.length + 1}::date + interval '1 day')::timestamptz`
      params.push(endDate)
    }

    // 1. Reward totals by type (from primary table)
    const rewardTotals = await prisma.$queryRawUnsafe(`
      SELECT
        rr.reward_type,
        rr.status,
        COUNT(*)::int AS count,
        COALESCE(SUM(rr.reward_amount_cents), 0)::int AS total_cents
      FROM referral_rewards rr
      WHERE rr.organization_id = $1::uuid
        ${dateFilter}
      GROUP BY rr.reward_type, rr.status
      ORDER BY rr.reward_type, rr.status
    `, ...params)

    // 2. Summary totals
    const summary = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total_rewards,
        COUNT(*) FILTER (WHERE rr.status = 'PAID')::int AS paid_rewards,
        COUNT(*) FILTER (WHERE rr.status = 'PENDING')::int AS pending_rewards,
        COALESCE(SUM(rr.reward_amount_cents) FILTER (WHERE rr.status = 'PAID'), 0)::int AS paid_total_cents,
        COALESCE(SUM(rr.reward_amount_cents) FILTER (WHERE rr.status = 'PENDING'), 0)::int AS pending_total_cents,
        COUNT(*) FILTER (WHERE rr.reward_type = 'referrer_reward' AND rr.status = 'PAID')::int AS referrer_rewards_paid,
        COALESCE(SUM(rr.reward_amount_cents) FILTER (WHERE rr.reward_type = 'referrer_reward' AND rr.status = 'PAID'), 0)::int AS referrer_rewards_cents,
        COUNT(*) FILTER (WHERE rr.reward_type = 'friend_signup_bonus' AND rr.status = 'PAID')::int AS friend_bonuses_paid,
        COALESCE(SUM(rr.reward_amount_cents) FILTER (WHERE rr.reward_type = 'friend_signup_bonus' AND rr.status = 'PAID'), 0)::int AS friend_bonuses_cents,
        COUNT(DISTINCT rr.referred_customer_id) FILTER (WHERE rr.reward_type = 'friend_signup_bonus')::int AS new_customers_via_referral
      FROM referral_rewards rr
      WHERE rr.organization_id = $1::uuid
        ${dateFilter}
    `, ...params)

    const s = summary[0] || {}

    // 3. Notification stats (emails/SMS sent for referral)
    const notifParams = [organizationId]
    let notifDateFilter = ''
    if (startDate) {
      notifDateFilter += ` AND ne."createdAt" >= $${notifParams.length + 1}::timestamptz`
      notifParams.push(startDate)
    }
    if (endDate) {
      notifDateFilter += ` AND ne."createdAt" <= ($${notifParams.length + 1}::date + interval '1 day')::timestamptz`
      notifParams.push(endDate)
    }

    const notificationStats = await prisma.$queryRawUnsafe(`
      SELECT
        ne.channel,
        ne."templateType",
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ne.status IN ('sent','delivered','opened','clicked'))::int AS delivered,
        COUNT(*) FILTER (WHERE ne.status IN ('failed','bounced'))::int AS failed
      FROM notification_events ne
      WHERE ne.organization_id = $1::uuid
        ${notifDateFilter}
      GROUP BY ne.channel, ne."templateType"
      ORDER BY ne.channel, ne."templateType"
    `, ...notifParams)

    // 4. Top referrers
    const topReferrers = await prisma.$queryRawUnsafe(`
      SELECT
        rr.referrer_customer_id,
        sec.given_name,
        sec.family_name,
        sec.personal_code,
        COUNT(*)::int AS referrals_count,
        COALESCE(SUM(rr.reward_amount_cents), 0)::int AS total_earned_cents
      FROM referral_rewards rr
      JOIN square_existing_clients sec
        ON sec.square_customer_id = rr.referrer_customer_id
        AND sec.organization_id = rr.organization_id
      WHERE rr.organization_id = $1::uuid
        AND rr.reward_type = 'referrer_reward'
        AND rr.status = 'PAID'
        ${dateFilter}
      GROUP BY rr.referrer_customer_id, sec.given_name, sec.family_name, sec.personal_code
      ORDER BY referrals_count DESC
      LIMIT 10
    `, ...params)

    return Response.json({
      source: 'referral_rewards',
      totals: {
        total_rewards: s.total_rewards || 0,
        paid_rewards: s.paid_rewards || 0,
        pending_rewards: s.pending_rewards || 0,
        paid_total_dollars: ((s.paid_total_cents || 0) / 100).toFixed(2),
        pending_total_dollars: ((s.pending_total_cents || 0) / 100).toFixed(2),
        referrer_rewards: {
          count: s.referrer_rewards_paid || 0,
          dollars: ((s.referrer_rewards_cents || 0) / 100).toFixed(2)
        },
        friend_bonuses: {
          count: s.friend_bonuses_paid || 0,
          dollars: ((s.friend_bonuses_cents || 0) / 100).toFixed(2)
        },
        new_customers_via_referral: s.new_customers_via_referral || 0
      },
      by_type_and_status: rewardTotals,
      notifications: notificationStats,
      top_referrers: topReferrers,
      filters: {
        organizationId,
        startDate: startDate || null,
        endDate: endDate || null
      }
    })

  } catch (error) {
    console.error('Referral analytics error:', error.message)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
