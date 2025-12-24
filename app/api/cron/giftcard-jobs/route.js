const { runGiftCardJobOnce } = require('../../../../lib/workers/giftcard-job-runner')

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function authorize(request) {
  const cronKey = process.env.GIFTCARD_WORKER_CRON_KEY
  if (!cronKey) {
    return { authorized: true }
  }
  const provided = request.headers.get('x-cron-key')
  if (provided && provided.trim() === cronKey.trim()) {
    return { authorized: true }
  }
  return { authorized: false }
}

async function handle(request) {
  const auth = authorize(request)
  if (!auth.authorized) {
    return json({ error: 'Unauthorized' }, 401)
  }

  try {
    const result = await runGiftCardJobOnce({
      workerId: 'vercel-cron',
    })
    return json({
      processed: result.processed,
      jobId: result.jobId || null,
      stage: result.stage || null,
    })
  } catch (error) {
    console.error('Gift card cron worker failed:', error)
    return json({ error: 'Gift card job failed', detail: error.message }, 500)
  }
}

export async function GET(request) {
  return handle(request)
}

export async function POST(request) {
  return handle(request)
}

