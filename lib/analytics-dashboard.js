const { Prisma } = require('@prisma/client')
const prisma = require('./prisma-client')
const { isAnalyticsEnabled } = require('./analytics-service')
const { LOCATION_OPTIONS, LOCATION_FILTER_IDS } = require('./constants/locations')

function normalizeLocation(locationId) {
  if (!locationId || locationId === 'all') return null
  return LOCATION_FILTER_IDS.includes(locationId) ? locationId : null
}

function clampRangeDays(value, fallback = 30) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback
  }
  return Math.min(Math.max(1, Math.floor(numeric)), 365)
}

function clampPagination(value, fallback = 20, min = 1, max = 100) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(Math.max(min, Math.floor(numeric)), max)
}

function clampOffset(page = 1, limit = 20) {
  const safePage = Math.max(1, Math.floor(page))
  return (safePage - 1) * limit
}

function toNumber(value) {
  if (value === null || value === undefined) {
    return 0
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function commStatsZero() {
  return { sent: 0, delivered: 0, failed: 0 }
}

function buildEmptySummary(rangeDays, since, locationId) {
  return {
    rangeDays,
    since,
    location: locationId || 'all',
    metrics: {
      newCustomers: 0,
      codesRedeemed: 0,
      rewardsNewCents: 0,
      rewardsReferrerCents: 0,
      revenueCents: 0,
      bookings: 0,
      cancellations: 0,
      monthlyRevenue: [],
      giftCards: {
        totals: {
          newRewardsCents: 0,
          newRewardsCount: 0,
          referrerRewardsCents: 0,
          referrerRewardsCount: 0,
        },
        byLocation: {},
      },
      sms: commStatsZero(),
      emails: commStatsZero(),
    },
    issues: {
      failedNotifications: 0,
      deadLetters: 0,
      activeProcesses: 0,
    },
    processRuns: [],
    notificationBreakdown: [],
  }
}

function isMissingAnalyticsEventsTable(error) {
  if (!error) {
    return false
  }
  if (error.code === 'P2021') {
    return true
  }
  if (error.code === 'P2010' && error.meta?.code === '42P01') {
    return true
  }
  const message = String(error.message || '').toLowerCase()
  return message.includes('analytics_events') && (message.includes('does not exist') || message.includes('undefined table'))
}

function fetchBookingStats(since, locationId) {
  return prisma.$queryRaw`
      SELECT
        SUM(CASE WHEN event_type = 'booking_created' THEN 1 ELSE 0 END)::bigint AS total_bookings,
        SUM(CASE WHEN event_type = 'booking_canceled' THEN 1 ELSE 0 END)::bigint AS total_cancellations
      FROM analytics_events ae
      WHERE ae.created_at >= ${since}
        AND ae.event_type IN ('booking_created','booking_canceled')
        ${locationId ? Prisma.sql`AND COALESCE(ae.metadata->>'locationId','') = ${locationId}` : Prisma.sql``}
    `.catch((error) => {
    if (isMissingAnalyticsEventsTable(error)) {
      console.warn('⚠️ analytics_events table missing; booking metrics will return zero until migration runs')
      return [{ total_bookings: 0n, total_cancellations: 0n }]
    }
    throw error
  })
}

async function fetchReferralSummary(options = {}) {
  const rangeDays = clampRangeDays(options.rangeDays, 30)
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000)
  const locationId = normalizeLocation(options.locationId)
  if (!isAnalyticsEnabled()) {
    return buildEmptySummary(rangeDays, since, locationId)
  }
  const revenueTrendStart = new Date()
  revenueTrendStart.setMonth(revenueTrendStart.getMonth() - 5)

  const [
    referralRows,
    notificationRows,
    revenueRows,
    bookingsRows,
    monthlyRevenueRows,
    giftCardRows,
    failedNotificationRows,
    deadLetterCount,
    processRuns,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT 
        "eventType" as event_type,
        COUNT(*)::bigint AS event_count,
        COALESCE(SUM("amountCents"), 0)::bigint AS total_amount
      FROM referral_events re
      WHERE re."occurredAt" >= ${since}
        ${locationId ? Prisma.sql`AND COALESCE(re.metadata->>'locationId','') = ${locationId}` : Prisma.sql``}
      GROUP BY "eventType"
    `,
    prisma.$queryRaw`
      SELECT 
        channel,
        "templateType" as template_type,
        status,
        COUNT(*)::bigint AS event_count
      FROM notification_events ne
      WHERE ne."createdAt" >= ${since}
        ${locationId ? Prisma.sql`AND COALESCE(ne.metadata->>'locationId','') = ${locationId}` : Prisma.sql``}
      GROUP BY channel, "templateType", status
    `,
    prisma.$queryRaw`
      SELECT COALESCE(SUM("amountCents"), 0)::bigint AS total_amount
      FROM revenue_attribution ra
      WHERE ra."occurredAt" >= ${since}
        ${locationId ? Prisma.sql`AND COALESCE(ra.metadata->>'locationId','') = ${locationId}` : Prisma.sql``}
    `,
    fetchBookingStats(since, locationId),
    prisma.$queryRaw`
      SELECT
        date_trunc('month', ra."occurredAt") AS month_start,
        COALESCE(SUM(ra."amountCents"), 0)::bigint AS total_amount
      FROM revenue_attribution ra
      WHERE ra."occurredAt" >= ${revenueTrendStart}
        ${locationId ? Prisma.sql`AND COALESCE(ra.metadata->>'locationId','') = ${locationId}` : Prisma.sql``}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(re.metadata->>'locationId', 'all') AS location_id,
        re."eventType" AS event_type,
        COUNT(*)::bigint AS event_count,
        COALESCE(SUM(re."amountCents"), 0)::bigint AS total_amount
      FROM referral_events re
      WHERE re."occurredAt" >= ${since}
        AND re."eventType" IN ('REWARD_GRANTED_NEW','REWARD_GRANTED_REFERRER')
        ${locationId ? Prisma.sql`AND COALESCE(re.metadata->>'locationId','') = ${locationId}` : Prisma.sql``}
      GROUP BY 1,2
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::bigint AS total
      FROM notification_events ne
      WHERE ne."createdAt" >= ${since}
        AND ne.status IN ('failed','bounced')
        ${locationId ? Prisma.sql`AND COALESCE(ne.metadata->>'locationId','') = ${locationId}` : Prisma.sql``}
    `,
    prisma.analyticsDeadLetter.count({
      where: {
        createdAt: { gte: since },
      },
    }),
    prisma.referralProcessRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        processType: true,
        status: true,
        totalCount: true,
        successCount: true,
        failureCount: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
        metadata: true,
      },
    }),
  ])

  const referralMap = referralRows.reduce((acc, row) => {
    acc[row.event_type] = {
      count: toNumber(row.event_count),
      amountCents: toNumber(row.total_amount),
    }
    return acc
  }, {})

  const notificationStats = notificationRows.reduce((acc, row) => {
    const key = `${row.channel}:${row.template_type || 'DEFAULT'}`
    if (!acc[key]) {
      acc[key] = {
        channel: row.channel,
        templateType: row.template_type,
        statuses: {},
      }
    }
    acc[key].statuses[row.status] = toNumber(row.event_count)
    return acc
  }, {})

  const revenueCents = toNumber(revenueRows?.[0]?.total_amount || 0)
  const bookings = toNumber(bookingsRows?.[0]?.total_bookings || 0)
  const cancellations = toNumber(bookingsRows?.[0]?.total_cancellations || 0)

  const smsStats = Object.values(notificationStats)
    .filter((item) => item.channel === 'SMS')
    .reduce(
      (acc, item) => {
        const sent = item.statuses.sent || 0
        const delivered = item.statuses.delivered || 0
        const failed = (item.statuses.failed || 0) + (item.statuses.bounced || 0)
        acc.sent += sent
        acc.delivered += delivered
        acc.failed += failed
        return acc
      },
      { sent: 0, delivered: 0, failed: 0 },
    )

  const emailStats = Object.values(notificationStats)
    .filter((item) => item.channel === 'EMAIL')
    .reduce(
      (acc, item) => {
        const sent = item.statuses.sent || 0
        const delivered = item.statuses.delivered || 0
        const failed = (item.statuses.failed || 0) + (item.statuses.bounced || 0)
        acc.sent += sent
        acc.delivered += delivered
        acc.failed += failed
        return acc
      },
      { sent: 0, delivered: 0, failed: 0 },
    )

  const monthlyRevenue = monthlyRevenueRows.map((row) => ({
    month: row.month_start,
    totalCents: toNumber(row.total_amount),
  }))

  const giftCards = giftCardRows.reduce(
    (acc, row) => {
      const locationKey = row.location_id || 'all'
      if (!acc.byLocation[locationKey]) {
        acc.byLocation[locationKey] = {
          newRewardsCents: 0,
          newRewardsCount: 0,
          referrerRewardsCents: 0,
          referrerRewardsCount: 0,
        }
      }
      if (row.event_type === 'REWARD_GRANTED_NEW') {
        acc.totals.newRewardsCents += toNumber(row.total_amount)
        acc.totals.newRewardsCount += toNumber(row.event_count)
        acc.byLocation[locationKey].newRewardsCents += toNumber(row.total_amount)
        acc.byLocation[locationKey].newRewardsCount += toNumber(row.event_count)
      } else {
        acc.totals.referrerRewardsCents += toNumber(row.total_amount)
        acc.totals.referrerRewardsCount += toNumber(row.event_count)
        acc.byLocation[locationKey].referrerRewardsCents += toNumber(row.total_amount)
        acc.byLocation[locationKey].referrerRewardsCount += toNumber(row.event_count)
      }
      return acc
    },
    {
      totals: {
        newRewardsCents: 0,
        newRewardsCount: 0,
        referrerRewardsCents: 0,
        referrerRewardsCount: 0,
      },
      byLocation: {},
    },
  )

  const activeProcessCount = processRuns.filter((run) => run.status === 'running').length

  return {
    rangeDays,
    since,
    location: locationId || 'all',
    metrics: {
      newCustomers: referralMap.NEW_CUSTOMER?.count || 0,
      codesRedeemed: referralMap.CODE_REDEEMED?.count || 0,
      rewardsNewCents: referralMap.REWARD_GRANTED_NEW?.amountCents || 0,
      rewardsReferrerCents: referralMap.REWARD_GRANTED_REFERRER?.amountCents || 0,
      revenueCents,
      bookings,
      cancellations,
      monthlyRevenue,
      giftCards,
      sms: smsStats,
      emails: emailStats,
    },
    issues: {
      failedNotifications: toNumber(failedNotificationRows?.[0]?.total || 0),
      deadLetters: deadLetterCount,
      activeProcesses: activeProcessCount,
    },
    processRuns,
    notificationBreakdown: Object.values(notificationStats),
  }
}

async function fetchReferrerLeaderboard(options = {}) {
  const limit = clampPagination(options.limit, 20)
  const offset = clampOffset(options.page || 1, limit)
  if (!isAnalyticsEnabled()) {
    return { total: 0, rows: [], limit, offset }
  }
  const sortKey = (options.sort || 'new_customers').toLowerCase()
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const referralAgg = await prisma.$queryRaw`
    SELECT
      "referrerCustomerId" AS referrer_id,
      SUM(CASE WHEN "eventType" = 'NEW_CUSTOMER' THEN 1 ELSE 0 END)::bigint AS new_customers_total,
      SUM(CASE WHEN "eventType" = 'NEW_CUSTOMER' AND "occurredAt" >= ${sevenDaysAgo} THEN 1 ELSE 0 END)::bigint AS new_customers_last7d,
      SUM(CASE WHEN "eventType" = 'CODE_REDEEMED' THEN 1 ELSE 0 END)::bigint AS codes_redeemed_total,
      SUM(CASE WHEN "eventType" = 'REWARD_GRANTED_REFERRER' THEN COALESCE("amountCents", 0) ELSE 0 END)::bigint AS rewards_paid_cents
    FROM referral_events
    WHERE "referrerCustomerId" IS NOT NULL
    GROUP BY 1
  `

  const notificationAgg = await prisma.$queryRaw`
    SELECT
      "referrerCustomerId" AS referrer_id,
      channel,
      COUNT(*)::bigint AS total_sent
    FROM notification_events
    WHERE "referrerCustomerId" IS NOT NULL
    GROUP BY 1, channel
  `

  const revenueAgg = await prisma.$queryRaw`
    SELECT
      "referrerCustomerId" AS referrer_id,
      COALESCE(SUM("amountCents"), 0)::bigint AS revenue_cents
    FROM revenue_attribution
    WHERE "referrerCustomerId" IS NOT NULL
    GROUP BY 1
  `

  const statsMap = new Map()
  const ensureStats = (referrerId) => {
    if (!referrerId) return null
    if (!statsMap.has(referrerId)) {
      statsMap.set(referrerId, {
        referrerCustomerId: referrerId,
        newCustomersTotal: 0,
        newCustomersLast7d: 0,
        codesRedeemedTotal: 0,
        rewardsPaidCents: 0,
        rewardsPendingCents: 0,
        smsSent: 0,
        emailsSent: 0,
        revenueAttributedCents: 0,
        conversionRate: 0,
      })
    }
    return statsMap.get(referrerId)
  }

  referralAgg.forEach((row) => {
    const stats = ensureStats(row.referrer_id)
    if (!stats) return
    stats.newCustomersTotal = toNumber(row.new_customers_total)
    stats.newCustomersLast7d = toNumber(row.new_customers_last7d)
    stats.codesRedeemedTotal = toNumber(row.codes_redeemed_total)
    stats.rewardsPaidCents = toNumber(row.rewards_paid_cents)
  })

  notificationAgg.forEach((row) => {
    const stats = ensureStats(row.referrer_id)
    if (!stats) return
    const total = toNumber(row.total_sent)
    if (row.channel === 'SMS') {
      stats.smsSent += total
    } else if (row.channel === 'EMAIL') {
      stats.emailsSent += total
    }
  })

  revenueAgg.forEach((row) => {
    const stats = ensureStats(row.referrer_id)
    if (!stats) return
    stats.revenueAttributedCents = toNumber(row.revenue_cents)
  })

  statsMap.forEach((stats) => {
    if (stats.newCustomersTotal > 0) {
      stats.conversionRate = stats.codesRedeemedTotal / stats.newCustomersTotal
    } else {
      stats.conversionRate = 0
    }
  })

  const entries = Array.from(statsMap.values())
  const sorters = {
    new_customers: (a, b) => b.newCustomersTotal - a.newCustomersTotal,
    recent: (a, b) => b.newCustomersLast7d - a.newCustomersLast7d,
    rewards: (a, b) => b.rewardsPaidCents - a.rewardsPaidCents,
    revenue: (a, b) => b.revenueAttributedCents - a.revenueAttributedCents,
    conversion: (a, b) => b.conversionRate - a.conversionRate,
  }
  const sorter = sorters[sortKey] || sorters.new_customers
  entries.sort(sorter)

  const paged = entries.slice(offset, offset + limit)

  const referrerIds = paged.map((row) => row.referrerCustomerId)
  const profiles = referrerIds.length
    ? await prisma.square_existing_clients.findMany({
        where: { square_customer_id: { in: referrerIds } },
        select: {
          square_customer_id: true,
          given_name: true,
          family_name: true,
          email_address: true,
          created_at: true,
        },
      })
    : []
  const profileMap = profiles.reduce((acc, profile) => {
    acc[profile.square_customer_id] = profile
    return acc
  }, {})

  const rows = paged.map((row) => ({
    id: row.referrerCustomerId,
    referrerCustomerId: row.referrerCustomerId,
    ...row,
    profile: profileMap[row.referrerCustomerId] || null,
    updatedAt: profileMap[row.referrerCustomerId]?.created_at || null,
  }))

  return { total: entries.length, rows, limit, offset }
}

async function fetchNotificationLog(options = {}) {
  const limit = clampPagination(options.limit, 25)
  const offset = clampOffset(options.page || 1, limit)
  if (!isAnalyticsEnabled()) {
    return { total: 0, rows: [], limit, offset }
  }

  const where = {}
  if (options.channel) {
    where.channel = options.channel
  }
  if (options.status) {
    where.status = options.status
  }
  if (options.templateType) {
    where.templateType = options.templateType
  }
  if (options.since) {
    where.createdAt = { gte: options.since }
  }

  const [total, rows] = await Promise.all([
    prisma.notificationEvent.count({ where }),
    prisma.notificationEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
  ])

  return { total, rows, limit, offset }
}

async function fetchProcessRuns(options = {}) {
  const limit = clampPagination(options.limit, 10, 1, 50)
  const offset = clampOffset(options.page || 1, limit)
  if (!isAnalyticsEnabled()) {
    return { total: 0, rows: [], limit, offset }
  }
  const where = {}
  if (options.processType) {
    where.processType = options.processType
  }
  if (options.status) {
    where.status = options.status
  }

  const [total, rows] = await Promise.all([
    prisma.referralProcessRun.count({ where }),
    prisma.referralProcessRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
  ])

  return { total, rows, limit, offset }
}

async function fetchProcessRunDetail(runId) {
  if (!runId) return null
  if (!isAnalyticsEnabled()) {
    return null
  }
  const run = await prisma.referralProcessRun.findUnique({
    where: { id: runId },
  })
  if (!run) {
    return null
  }
  const events = await prisma.referralEvent.findMany({
    where: { processRunId: runId },
    orderBy: { occurredAt: 'asc' },
    take: 200,
  })
  return { run, events }
}

module.exports = {
  fetchReferralSummary,
  fetchReferrerLeaderboard,
  fetchNotificationLog,
  fetchProcessRuns,
  fetchProcessRunDetail,
  LOCATION_OPTIONS,
  LOCATION_FILTER_IDS,
  normalizeLocation,
}

