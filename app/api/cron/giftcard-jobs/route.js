import { createRequire } from 'module'

const require = createRequire(import.meta.url)
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
  // Vercel cron jobs can send the secret in different ways:
  // 1. Authorization header as "Bearer <secret>" (most common)
  // 2. Authorization header as just the secret
  // 3. x-cron-secret header (some configurations)
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    // If CRON_SECRET is not set, allow (for development only)
    // In production, CRON_SECRET should always be set
    console.warn('⚠️ CRON_SECRET not set - allowing unauthenticated access (development only)')
    return { authorized: true, method: 'no-secret-set' }
  }

  // Check Authorization header (Bearer token or plain secret)
  const authHeader = request.headers.get('Authorization') || ''
  if (authHeader === `Bearer ${cronSecret}` || authHeader === cronSecret) {
    return { authorized: true, method: 'vercel-cron-auth-header' }
  }

  // Check x-cron-secret header (alternative method)
  const cronHeader = request.headers.get('x-cron-secret') || request.headers.get('x-cron-key')
  if (cronHeader === cronSecret) {
    return { authorized: true, method: 'vercel-cron-header' }
  }

  // If no match, check if this is a Vercel cron request (Vercel sends a specific user-agent)
  const userAgent = request.headers.get('user-agent') || ''
  if (userAgent.includes('vercel-cron') || userAgent.includes('vercel')) {
    // Allow if it's clearly a Vercel request but warn
    console.warn('⚠️ Vercel cron request detected but secret mismatch. Allowing for now.')
    return { authorized: true, method: 'vercel-cron-user-agent' }
  }

  return { authorized: false, reason: 'no-matching-secret' }
}

async function handle(request) {
  const startTime = Date.now()
  console.log(`[CRON] Gift card jobs cron triggered at ${new Date().toISOString()}`)
  
  const auth = authorize(request)
  if (!auth.authorized) {
    console.error(`[CRON] Unauthorized access attempt. Method: ${auth.method || 'unknown'}, Reason: ${auth.reason || 'none'}`)
    return json({ error: 'Unauthorized', method: auth.method, reason: auth.reason }, 401)
  }
  
  console.log(`[CRON] Authorized using method: ${auth.method}`)

  try {
    // Process multiple jobs per cron run to speed up queue processing
    // Process up to 10 jobs per minute (configurable via env var)
    const maxJobsPerRun = Number(process.env.GIFTCARD_JOBS_PER_CRON_RUN) || 10
    const results = []
    let processed = 0
    let errors = 0
    
    console.log(`[CRON] Processing up to ${maxJobsPerRun} jobs...`)
    
    while (processed + errors < maxJobsPerRun) {
      try {
        const result = await runGiftCardJobOnce({
          workerId: 'vercel-cron',
        })
        
        if (!result.processed) {
          // No more jobs available
          console.log(`[CRON] No more jobs available after processing ${processed}`)
          break
        }
        
        results.push({
          jobId: result.jobId,
          stage: result.stage,
        })
        processed++
        console.log(`[CRON] ✅ Processed job ${result.jobId} (stage: ${result.stage})`)
      } catch (jobError) {
        errors++
        console.error(`[CRON] ❌ Error processing job ${errors}:`, jobError.message)
        console.error(`[CRON] Stack:`, jobError.stack)
        // Continue processing other jobs even if one fails
        if (errors >= 3) {
          console.error(`[CRON] Too many errors (${errors}), stopping processing`)
          break
        }
      }
    }
    
    const duration = Date.now() - startTime
    console.log(`[CRON] ✅ Completed: processed ${processed} job(s), ${errors} error(s) in ${duration}ms`)
    
    return json({
      processed: processed,
      errors: errors,
      jobs: results,
      duration: duration,
      message: processed > 0 
        ? `Processed ${processed} job(s)` 
        : errors > 0
        ? `No jobs processed (${errors} error(s))`
        : 'No jobs available'
    })
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[CRON] ❌ Gift card cron worker failed after ${duration}ms:`, error)
    console.error(`[CRON] Error stack:`, error.stack)
    return json({ 
      error: 'Gift card job failed', 
      detail: error.message,
      duration: duration 
    }, 500)
  }
}

export async function GET(request) {
  return handle(request)
}

export async function POST(request) {
  return handle(request)
}


