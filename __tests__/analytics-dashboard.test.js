const prisma = require('../lib/prisma-client')

jest.mock('../lib/prisma-client', () => ({
  $queryRaw: jest.fn(),
  analyticsDeadLetter: { count: jest.fn() },
  referralProcessRun: { findMany: jest.fn() },
}))

jest.mock('../lib/analytics-service', () => ({
  isAnalyticsEnabled: jest.fn(() => true),
}))

const {
  fetchReferralSummary,
  normalizeLocation,
} = require('../lib/analytics-dashboard')
const { isAnalyticsEnabled } = require('../lib/analytics-service')

describe('analytics dashboard helpers', () => {
  beforeEach(() => {
    prisma.$queryRaw.mockReset()
    prisma.analyticsDeadLetter.count.mockReset()
    prisma.referralProcessRun.findMany.mockReset()
    isAnalyticsEnabled.mockReturnValue(true)
  })

  test('normalizeLocation only allows configured IDs', () => {
    expect(normalizeLocation('union')).toBe('union')
    expect(normalizeLocation('pacific')).toBe('pacific')
    expect(normalizeLocation('ALL')).toBeNull()
    expect(normalizeLocation('unknown')).toBeNull()
    expect(normalizeLocation(null)).toBeNull()
  })

  test('fetchReferralSummary aggregates monthly, booking, and gift card metrics', async () => {
    isAnalyticsEnabled.mockReturnValue(true)
    const referralRows = [
      { event_type: 'NEW_CUSTOMER', event_count: 3n, total_amount: 0n },
      { event_type: 'CODE_REDEEMED', event_count: 2n, total_amount: 0n },
      { event_type: 'REWARD_GRANTED_NEW', event_count: 2n, total_amount: 1500n },
      { event_type: 'REWARD_GRANTED_REFERRER', event_count: 1n, total_amount: 1000n },
    ]
    const notificationRows = [
      { channel: 'SMS', template_type: 'REFERRAL', status: 'sent', event_count: 5n },
      { channel: 'SMS', template_type: 'REFERRAL', status: 'delivered', event_count: 4n },
      { channel: 'EMAIL', template_type: 'REFERRAL', status: 'sent', event_count: 2n },
      { channel: 'EMAIL', template_type: 'REFERRAL', status: 'delivered', event_count: 1n },
    ]
    const revenueRows = [{ total_amount: 50000n }]
    const bookingsRows = [{ total_bookings: 7n, total_cancellations: 2n }]
    const monthlyRevenueRows = [
      { month_start: new Date('2024-01-01T00:00:00Z'), total_amount: 10000n },
    ]
    const giftCardRows = [
      { location_id: 'union', event_type: 'REWARD_GRANTED_NEW', event_count: 1n, total_amount: 500n },
      { location_id: 'pacific', event_type: 'REWARD_GRANTED_NEW', event_count: 1n, total_amount: 1000n },
      { location_id: 'union', event_type: 'REWARD_GRANTED_REFERRER', event_count: 1n, total_amount: 1000n },
    ]
    const failedRows = [{ total: 1n }]

    prisma.$queryRaw
      .mockResolvedValueOnce(referralRows)
      .mockResolvedValueOnce(notificationRows)
      .mockResolvedValueOnce(revenueRows)
      .mockResolvedValueOnce(bookingsRows)
      .mockResolvedValueOnce(monthlyRevenueRows)
      .mockResolvedValueOnce(giftCardRows)
      .mockResolvedValueOnce(failedRows)
    prisma.analyticsDeadLetter.count.mockResolvedValue(0)
    prisma.referralProcessRun.findMany.mockResolvedValue([])

    const summary = await fetchReferralSummary({ rangeDays: 30, locationId: 'union' })

    expect(summary.metrics.newCustomers).toBe(3)
    expect(summary.metrics.bookings).toBe(7)
    expect(summary.metrics.cancellations).toBe(2)
    expect(summary.metrics.monthlyRevenue).toHaveLength(1)
    expect(summary.metrics.giftCards.totals.newRewardsCents).toBe(1500)
    expect(summary.metrics.giftCards.byLocation.union.newRewardsCents).toBe(500)
    expect(summary.metrics.giftCards.byLocation.union.referrerRewardsCents).toBe(1000)
    expect(summary.metrics.sms.sent).toBe(5)
    expect(summary.issues.failedNotifications).toBe(1)
  })

  test('fetchReferralSummary groups gift card metrics by metadata location', async () => {
    isAnalyticsEnabled.mockReturnValue(true)
    const empty = []
    const zeroAmount = [{ total_amount: 0n }]
    const zeroBookings = [{ total_bookings: 0n, total_cancellations: 0n }]
    const zeroFailed = [{ total: 0n }]

    prisma.$queryRaw
      .mockResolvedValueOnce(empty) // referral rows
      .mockResolvedValueOnce(empty) // notification rows
      .mockResolvedValueOnce(zeroAmount) // revenue rows
      .mockResolvedValueOnce(zeroBookings) // booking rows
      .mockResolvedValueOnce(empty) // monthly revenue
      .mockResolvedValueOnce([
        { location_id: 'union', event_type: 'REWARD_GRANTED_NEW', event_count: 1n, total_amount: 500n },
        { location_id: 'pacific', event_type: 'REWARD_GRANTED_REFERRER', event_count: 1n, total_amount: 1000n },
      ])
      .mockResolvedValueOnce(zeroFailed)
    prisma.analyticsDeadLetter.count.mockResolvedValue(0)
    prisma.referralProcessRun.findMany.mockResolvedValue([])

    const summary = await fetchReferralSummary({ rangeDays: 60 })

    expect(summary.metrics.giftCards.byLocation.union.newRewardsCents).toBe(500)
    expect(summary.metrics.giftCards.byLocation.pacific.referrerRewardsCents).toBe(1000)
  })

  test('fetchReferralSummary returns zeros when analytics disabled', async () => {
    isAnalyticsEnabled.mockReturnValue(false)
    const summary = await fetchReferralSummary({ rangeDays: 14, locationId: 'union' })
    expect(summary.metrics.newCustomers).toBe(0)
    expect(summary.metrics.bookings).toBe(0)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})

