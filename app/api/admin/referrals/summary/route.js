const { authorizeAdminRequest } = require('../../../../../lib/admin-auth')
const {
  fetchReferralSummary,
  LOCATION_OPTIONS,
  LOCATION_FILTER_IDS,
} = require('../../../../../lib/analytics-dashboard')

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export async function GET(request) {
  const auth = await authorizeAdminRequest(request)
  if (!auth.authorized) {
    return json({ error: auth.error || 'Unauthorized' }, auth.status || 401)
  }

  const url = new URL(request.url)
  const rangeParam = url.searchParams.get('rangeDays')
  const locationParam = url.searchParams.get('location')
  const normalizedLocation =
    locationParam && LOCATION_FILTER_IDS.includes(locationParam) ? locationParam : null

  try {
    const summary = await fetchReferralSummary({
      rangeDays: rangeParam ? Number(rangeParam) : undefined,
      locationId: normalizedLocation,
    })
    return json({
      range: {
        days: summary.rangeDays,
        since: summary.since.toISOString(),
      },
      location: summary.location,
      metrics: summary.metrics,
      issues: summary.issues,
      processRuns: summary.processRuns,
      notificationBreakdown: summary.notificationBreakdown,
      locations: LOCATION_OPTIONS,
    })
  } catch (error) {
    console.error('Failed to build referral summary:', error)
    return json({ error: 'Failed to load referral summary' }, 500)
  }
}

