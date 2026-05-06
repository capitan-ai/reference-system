import { createRequire } from 'module'
import prisma from '@/lib/prisma-client'
import { authorizeCron } from '@/lib/auth/cron-auth'

const require = createRequire(import.meta.url)
const { runWebhookJobOnce } = require('../../../../lib/workers/webhook-job-runner')
const { saveApplicationLog } = require('../../../../lib/workflows/application-log-queue')
const { randomUUID } = require('crypto')

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

async function handle(request) {
  const startTime = Date.now()
  console.log(`[CRON] Webhook jobs cron triggered at ${new Date().toISOString()}`)

  const auth = authorizeCron(request)
  if (!auth.authorized) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const cronId = `cron-webhook-jobs-${Date.now()}`
  
  // Save cron start to application_logs (non-blocking)
  try {
    await saveApplicationLog(prisma, {
      logType: 'cron',
      logId: cronId,
      logCreatedAt: new Date(),
      payload: {
        cron_name: 'webhook-jobs',
        worker_id: 'vercel-cron',
        triggered_at: new Date().toISOString()
      },
      organizationId: null, // System log
      status: 'processing',
      maxAttempts: 0
    }).catch(() => {}) // Silently fail
  } catch (logError) {
    console.warn('⚠️ Failed to save cron start to application_logs:', logError.message)
  }

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
    
    // Update application_log with results (non-blocking)
    try {
      await prisma.$executeRaw`
        UPDATE application_logs
        SET status = 'completed',
            payload = jsonb_set(
              payload,
              '{results}',
              ${JSON.stringify({
                processed,
                errors,
                duration,
                jobs: results
              })}::jsonb
            ),
            updated_at = NOW()
        WHERE log_id = ${cronId}
          AND log_type = 'cron'
      `.catch(() => {}) // Silently fail
    } catch (updateError) {
      console.warn('⚠️ Failed to update cron log:', updateError.message)
    }
    
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
    
    // Update application_log with error (non-blocking)
    try {
      await prisma.$executeRaw`
        UPDATE application_logs
        SET status = 'error',
            payload = jsonb_set(
              payload,
              '{results}',
              ${JSON.stringify({
                processed: 0,
                errors: 1,
                duration,
                error: error.message
              })}::jsonb
            ),
            last_error = ${error.message},
            updated_at = NOW()
        WHERE log_id = ${cronId}
          AND log_type = 'cron'
      `.catch(() => {}) // Silently fail
    } catch (updateError) {
      console.warn('⚠️ Failed to update cron error log:', updateError.message)
    }
    
    return json({
      error: 'Webhook job processing failed',
      duration: duration
    }, 500)
  }
}

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(request)
}

export async function POST(request) {
  return handle(request)
}


