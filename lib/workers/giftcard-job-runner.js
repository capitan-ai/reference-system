const { randomUUID } = require('crypto')
const prisma = require('../prisma-client')
const {
  lockNextGiftCardJob,
  completeGiftCardJob,
  failGiftCardJob,
} = require('../workflows/giftcard-job-queue')
const {
  updateGiftCardRunStage,
  markGiftCardRunError,
} = require('../runs/giftcard-run-tracker')
const {
  processCustomerCreated,
  processBookingCreated,
  processPaymentCompletion,
} = require('../webhooks/giftcard-processors')
const {
  logInfo,
  logWarn,
  logError,
} = require('../observability/logger')

function buildRequestStub() {
  return {
    headers: {
      get: () => null,
    },
    connection: null,
  }
}

async function processGiftCardJob(job, workerId = randomUUID()) {
  const context = job.context || {}
  const runContext = {
    correlationId: job.correlationId,
    triggerType: job.triggerType,
    squareEventId: context.squareEventId,
    squareEventType: context.squareEventType,
    jobId: job.id,
    context: context, // Include full context so processors can access organizationId, merchantId, etc.
  }

  await updateGiftCardRunStage(prisma, job.correlationId, {
    status: 'running',
    incrementAttempts: true,
    resumedAt: new Date(),
    context: {
      ...(context || {}),
      jobId: job.id,
      workerId,
    },
  })

  switch (job.stage) {
    case 'customer_ingest':
      return processCustomerCreated(job.payload, buildRequestStub(), runContext)
    case 'booking':
      return processBookingCreated(job.payload, runContext)
    case 'payment':
      return processPaymentCompletion(job.payload, runContext)
    case 'payment_save':
      // New stage: Save payment to database (fallback when webhook save fails)
      return processPaymentSave(job.payload, job.context, runContext)
    default:
      throw new Error(`Unknown job stage "${job.stage}"`)
  }
}

async function runGiftCardJobOnce({
  workerId = `serverless-${randomUUID()}`,
  excludeStages = [],
} = {}) {
  const job = await lockNextGiftCardJob(prisma, workerId, excludeStages)
  if (!job) {
    logInfo('giftcard.worker.no_job', { workerId })
    return { processed: false }
  }

  logInfo('giftcard.worker.job.start', {
    workerId,
    jobId: job.id,
    stage: job.stage,
    correlationId: job.correlationId,
    attempts: job.attempts,
  })

  try {
    await processGiftCardJob(job, workerId)
    await completeGiftCardJob(prisma, job.id)
    logInfo('giftcard.worker.job.completed', {
      workerId,
      jobId: job.id,
      stage: job.stage,
      correlationId: job.correlationId,
    })
    return { processed: true, jobId: job.id, stage: job.stage }
  } catch (error) {
    logError('giftcard.worker.job.failed', {
      workerId,
      jobId: job.id,
      stage: job.stage,
      correlationId: job.correlationId,
      attempts: job.attempts,
      error: error?.message || String(error),
    })

    await markGiftCardRunError(prisma, job.correlationId, error, {
      stage: `${job.stage}:worker-error`,
    })

    const openBreaker = job.attempts >= 3
    if (openBreaker) {
      logWarn('giftcard.worker.circuit_open', {
        workerId,
        stage: job.stage,
        correlationId: job.correlationId,
      })
    }

    await failGiftCardJob(prisma, job, error, {
      delayMs: openBreaker ? Number(process.env.GIFTCARD_WORKER_BREAKER_MS || 60000) : undefined,
    })

    throw error
  }
}

async function processPaymentSave(paymentData, context, runContext) {
  try {
    console.log(`[CRON] Processing payment_save job for payment: ${paymentData?.id || paymentData?.paymentId || 'unknown'}`)
    
    if (!paymentData || !paymentData.id) {
      throw new Error('Payment data missing or invalid')
    }
    
    // Dynamic import since savePaymentToDatabase is ES6 export
    const { savePaymentToDatabase } = await import('../../app/api/webhooks/square/route.js')
    
    const eventType = context?.squareEventType || 'payment.updated'
    const squareEventId = context?.squareEventId || null
    const squareCreatedAt = context?.squareCreatedAt || null
    
    await savePaymentToDatabase(paymentData, eventType, squareEventId, squareCreatedAt)
    
    console.log(`[CRON] ✅ Payment saved to database: ${paymentData.id}`)
    
    return { success: true, paymentId: paymentData.id }
  } catch (error) {
    console.error(`[CRON] ❌ Error processing payment_save job:`, error.message)
    console.error(`[CRON] Stack:`, error.stack)
    throw error // Re-throw so job can be retried
  }
}

module.exports = {
  processGiftCardJob,
  runGiftCardJobOnce,
  buildRequestStub,
  processPaymentSave, // Export for testing
}


