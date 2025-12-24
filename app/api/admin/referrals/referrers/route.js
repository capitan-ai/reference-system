const { authorizeAdminRequest } = require('../../../../../lib/admin-auth')
const { fetchReferrerLeaderboard } = require('../../../../../lib/analytics-dashboard')

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
  const page = Number(url.searchParams.get('page') || 1)
  const limit = Number(url.searchParams.get('limit') || 20)
  const sort = url.searchParams.get('sort') || 'new_customers'

  try {
    const leaderboard = await fetchReferrerLeaderboard({ page, limit, sort })
    return json({
      pagination: {
        page: Math.max(1, Math.floor(page)),
        limit: leaderboard.limit,
        total: leaderboard.total,
      },
      data: leaderboard.rows.map((row) => ({
        id: row.id,
        customerId: row.referrerCustomerId,
        squareCustomerId: row.referrerCustomerId,
        name: row.profile
          ? `${row.profile.given_name || ''} ${row.profile.family_name || ''}`.trim() || row.profile.email_address
          : row.referrerCustomerId,
        email: row.profile?.email_address || null,
        stats: {
          newCustomersTotal: row.newCustomersTotal,
          newCustomersLast7d: row.newCustomersLast7d,
          codesRedeemedTotal: row.codesRedeemedTotal,
          rewardsPaidCents: row.rewardsPaidCents,
          rewardsPendingCents: row.rewardsPendingCents,
          smsSent: row.smsSent,
          emailsSent: row.emailsSent,
          revenueAttributedCents: row.revenueAttributedCents,
          conversionRate: row.conversionRate,
        },
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch referrer leaderboard:', error)
    return json({ error: 'Failed to load leaderboard' }, 500)
  }
}

