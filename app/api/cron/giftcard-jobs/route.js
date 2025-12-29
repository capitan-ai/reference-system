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
  // Vercel cron jobs send the secret in Authorization header as "Bearer <secret>"
  // This matches Vercel's official documentation pattern
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return { authorized: false }
    }
    return { authorized: true, method: 'vercel-cron' }
  }
  
  // If CRON_SECRET is not set, allow (for development only)
  // In production, CRON_SECRET should always be set
  console.warn('⚠️ CRON_SECRET not set - allowing unauthenticated access (development only)')
  return { authorized: true, method: 'no-secret-set' }
}

async function handle(request) {
  const auth = authorize(request)
  if (!auth.authorized) {
    return json({ error: 'Unauthorized' }, 401)
  }

  try {
    // Process multiple jobs per cron run to speed up queue processing
    // Process up to 10 jobs per minute (configurable via env var)
    const maxJobsPerRun = Number(process.env.GIFTCARD_JOBS_PER_CRON_RUN) || 10
    const results = []
    let processed = 0
    
    console.log(`🔄 Processing up to ${maxJobsPerRun} jobs...`)
    
    while (processed < maxJobsPerRun) {
      const result = await runGiftCardJobOnce({
        workerId: 'vercel-cron',
      })
      
      if (!result.processed) {
        // No more jobs available
        break
      }
      
      results.push({
        jobId: result.jobId,
        stage: result.stage,
      })
      processed++
    }
    
    console.log(`✅ Processed ${processed} job(s)`)
    
    return json({
      processed: processed,
      jobs: results,
      message: processed > 0 
        ? `Processed ${processed} job(s)` 
        : 'No jobs available'
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


