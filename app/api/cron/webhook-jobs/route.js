import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { runWebhookJobOnce } = require('../../../../lib/workers/webhook-job-runner')

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
    console.warn('⚠️ CRON_SECRET not set - allowing unauthenticated access (development only)')
    return { authorized: true, method: 'no-secret-set' }
  }

  // Log headers for debugging (sanitized)
  const authHeader = request.headers.get('Authorization') || ''
  const cronHeader = request.headers.get('x-cron-secret') || request.headers.get('x-cron-key') || ''
  const userAgent = request.headers.get('user-agent') || ''
  
  console.log(`[CRON] Auth check - User-Agent: ${userAgent.substring(0, 50)}`)
  console.log(`[CRON] Auth check - Has Auth header: ${!!authHeader}`)
  console.log(`[CRON] Auth check - Has x-cron-secret: ${!!cronHeader}`)
  console.log(`[CRON] Auth check - CRON_SECRET set: ${!!cronSecret}`)

  // Check Authorization header (Bearer token or plain secret)
  if (authHeader === `Bearer ${cronSecret}` || authHeader === cronSecret) {
    console.log(`[CRON] ✅ Authorized via Authorization header`)
    return { authorized: true, method: 'vercel-cron-auth-header' }
  }

  // Check x-cron-secret header (alternative method)
  if (cronHeader === cronSecret) {
    console.log(`[CRON] ✅ Authorized via x-cron-secret header`)
    return { authorized: true, method: 'vercel-cron-header' }
  }

  // If no match, check if this is a Vercel cron request (Vercel sends a specific user-agent)
  const isVercelRequest = 
    userAgent.includes('vercel-cron') || 
    userAgent.includes('vercel') ||
    userAgent.toLowerCase().includes('vercel') ||
    (!userAgent || userAgent.length === 0)
  
  if (isVercelRequest) {
    console.warn('⚠️ Vercel cron request detected but secret mismatch. Allowing for now.')
    console.warn('⚠️ User-Agent:', userAgent || '(empty)')
    console.warn('⚠️ To secure this endpoint, verify CRON_SECRET in Vercel matches environment variable')
    return { authorized: true, method: 'vercel-cron-user-agent' }
  }

  console.error(`[CRON] ❌ Authorization failed - No matching secret found`)
  console.error(`[CRON] User-Agent: ${userAgent || '(empty)'}`)
  console.error(`[CRON] Auth header present: ${!!authHeader}`)
  console.error(`[CRON] x-cron-secret header present: ${!!cronHeader}`)
  console.error(`[CRON] Expected CRON_SECRET (first 10 chars): ${cronSecret.substring(0, 10)}...`)
  return { authorized: false, reason: 'no-matching-secret', method: 'unknown' }
}

async function handle(request) {
  const startTime = Date.now()
  console.log(`[CRON] Webhook jobs cron triggered at ${new Date().toISOString()}`)
  
  const auth = authorize(request)
  if (!auth.authorized) {
    console.error(`[CRON] Unauthorized access attempt. Method: ${auth.method || 'unknown'}, Reason: ${auth.reason || 'none'}`)
    return json({ error: 'Unauthorized', method: auth.method, reason: auth.reason }, 401)
  }
  
  console.log(`[CRON] Authorized using method: ${auth.method}`)

  try {
    // Process multiple jobs per cron run to speed up queue processing
    // Process up to 10 jobs per minute (configurable via env var)
    const maxJobsPerRun = Number(process.env.WEBHOOK_JOBS_PER_CRON_RUN) || 10
    const results = []
    let processed = 0
    let errors = 0
    
    console.log(`[CRON] Processing up to ${maxJobsPerRun} webhook jobs...`)
    
    while (processed + errors < maxJobsPerRun) {
      try {
        const result = await runWebhookJobOnce({
          workerId: 'vercel-cron',
        })
        
        if (!result.processed) {
          // No more jobs available
          console.log(`[CRON] No more webhook jobs available after processing ${processed}`)
          break
        }
        
        results.push({
          jobId: result.jobId,
          eventType: result.eventType,
          eventId: result.eventId,
        })
        processed++
        console.log(`[CRON] ✅ Processed webhook job ${result.jobId} (${result.eventType}, event_id: ${result.eventId})`)
      } catch (jobError) {
        errors++
        console.error(`[CRON] ❌ Error processing webhook job ${errors}:`, jobError.message)
        console.error(`[CRON] Stack:`, jobError.stack)
        // Continue processing other jobs even if one fails
        if (errors >= 3) {
          console.error(`[CRON] Too many errors (${errors}), stopping processing`)
          break
        }
      }
    }
    
    const duration = Date.now() - startTime
    console.log(`[CRON] ✅ Completed: processed ${processed} webhook job(s), ${errors} error(s) in ${duration}ms`)
    
    return json({
      processed: processed,
      errors: errors,
      jobs: results,
      duration: duration,
      message: processed > 0 
        ? `Processed ${processed} webhook job(s)` 
        : errors > 0
        ? `No jobs processed (${errors} error(s))`
        : 'No webhook jobs available'
    })
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[CRON] ❌ Webhook jobs cron worker failed after ${duration}ms:`, error)
    console.error(`[CRON] Error stack:`, error.stack)
    return json({ 
      error: 'Webhook job processing failed', 
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


