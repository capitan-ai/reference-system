const { authorizeAdminRequest } = require('../../../../../lib/admin-auth')
const { fetchNotificationLog } = require('../../../../../lib/analytics-dashboard')

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
  const limit = Number(url.searchParams.get('limit') || 25)
  const channel = url.searchParams.get('channel') || undefined
  const status = url.searchParams.get('status') || undefined
  const templateType = url.searchParams.get('templateType') || undefined
  const sinceParam = url.searchParams.get('since')
  const since = sinceParam ? new Date(sinceParam) : undefined

  try {
    const log = await fetchNotificationLog({
      page,
      limit,
      channel,
      status,
      templateType,
      since: Number.isNaN(since?.getTime()) ? undefined : since,
    })
    return json({
      pagination: {
        page: Math.max(1, Math.floor(page)),
        limit: log.limit,
        total: log.total,
      },
      data: log.rows,
    })
  } catch (error) {
    console.error('Failed to fetch notification log:', error)
    return json({ error: 'Failed to load notifications' }, 500)
  }
}

