const { authorizeAdminRequest } = require('../../../../../lib/admin-auth')
const {
  fetchProcessRuns,
  fetchProcessRunDetail,
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
  const runId = url.searchParams.get('id')
  if (runId) {
    const detail = await fetchProcessRunDetail(runId)
    if (!detail) {
      return json({ error: 'Process run not found' }, 404)
    }
    return json(detail)
  }

  const page = Number(url.searchParams.get('page') || 1)
  const limit = Number(url.searchParams.get('limit') || 10)
  const processType = url.searchParams.get('processType') || undefined
  const status = url.searchParams.get('status') || undefined

  try {
    const runs = await fetchProcessRuns({ page, limit, processType, status })
    return json({
      pagination: {
        page: Math.max(1, Math.floor(page)),
        limit: runs.limit,
        total: runs.total,
      },
      data: runs.rows,
    })
  } catch (error) {
    console.error('Failed to fetch process runs:', error)
    return json({ error: 'Failed to load process runs' }, 500)
  }
}

