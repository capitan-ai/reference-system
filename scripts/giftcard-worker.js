#!/usr/bin/env node

require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('crypto')
const {
  lockNextGiftCardJob,
  completeGiftCardJob,
  failGiftCardJob
} = require('../lib/workflows/giftcard-job-queue')
const {
  updateGiftCardRunStage,
  markGiftCardRunError
} = require('../lib/runs/giftcard-run-tracker')
const {
  processCustomerCreated,
  processBookingCreated,
  processPaymentCompletion
} = require('../lib/webhooks/giftcard-processors.js')
const {
  logInfo,
  logWarn,
  logError
} = require('../lib/observability/logger')

const prisma = new PrismaClient()
const workerId = process.env.GIFTCARD_WORKER_ID || randomUUID()
const pollIntervalMs = Number(process.env.GIFTCARD_WORKER_POLL_MS || 2000)
const maxIdleMs = Math.max(500, pollIntervalMs)
const circuitCooldownMs = Number(process.env.GIFTCARD_WORKER_BREAKER_MS || 60000)

let shouldStop = false
const circuitBreakers = new Map()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildRequestStub() {
  return {
    headers: {
      get: () => null
    },
    connection: null
  }
}

async function processJob(job) {
  const context = job.context || {}
  const runContext = {
    correlationId: job.correlationId,
    triggerType: job.triggerType,
    squareEventId: context.squareEventId,
    squareEventType: context.squareEventType,
    jobId: job.id
  }

  await updateGiftCardRunStage(prisma, job.correlationId, {
    status: 'running',
    incrementAttempts: true,
    resumedAt: new Date(),
    context: {
      ...(context || {}),
      jobId: job.id,
      workerId
    }
  })

  switch (job.stage) {
    case 'customer_ingest':
      return processCustomerCreated(job.payload, buildRequestStub(), runContext)
    case 'booking':
      return processBookingCreated(job.payload, runContext)
    case 'payment':
      return processPaymentCompletion(job.payload, runContext)
    default:
      throw new Error(`Unknown job stage "${job.stage}"`)
  }
}

async function workLoop() {
  logInfo('giftcard.worker.start', {
    workerId,
    pollIntervalMs,
    circuitCooldownMs
  })
  while (!shouldStop) {
    try {
      const excludeStages = []
      const now = Date.now()
      for (const [stage, openedUntil] of circuitBreakers.entries()) {
        if (openedUntil > now) {
          excludeStages.push(stage)
        } else {
          circuitBreakers.delete(stage)
        }
      }

      const job = await lockNextGiftCardJob(prisma, workerId, excludeStages)

      if (!job) {
        await sleep(maxIdleMs)
        continue
      }

      logInfo('giftcard.worker.job.start', {
        workerId,
        jobId: job.id,
        stage: job.stage,
        correlationId: job.correlationId,
        attempts: job.attempts
      })

      try {
        await processJob(job)
        await completeGiftCardJob(prisma, job.id)
        logInfo('giftcard.worker.job.completed', {
          workerId,
          jobId: job.id,
          stage: job.stage,
          correlationId: job.correlationId
        })
      } catch (jobError) {
        logError('giftcard.worker.job.failed', {
          workerId,
          jobId: job.id,
          stage: job.stage,
          correlationId: job.correlationId,
          attempts: job.attempts,
          error: jobError?.message || String(jobError)
        })
        await markGiftCardRunError(prisma, job.correlationId, jobError, {
          stage: `${job.stage}:worker-error`
        })
        const openBreaker = job.attempts >= 3
        if (openBreaker) {
          circuitBreakers.set(job.stage, Date.now() + circuitCooldownMs)
          logWarn('giftcard.worker.circuit_open', {
            workerId,
            stage: job.stage,
            correlationId: job.correlationId,
            cooldownMs: circuitCooldownMs
          })
        }
        await failGiftCardJob(prisma, job, jobError, {
          delayMs: openBreaker ? circuitCooldownMs : undefined
        })
      }
    } catch (error) {
      logError('giftcard.worker.loop_error', {
        workerId,
        error: error?.message || String(error),
        stack: error?.stack
      })
      await sleep(maxIdleMs)
    }
  }
  logInfo('giftcard.worker.stop', { workerId })
}

async function shutdown() {
  if (shouldStop) return
  shouldStop = true
  logInfo('giftcard.worker.shutdown_requested', { workerId })
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

workLoop().catch(async (error) => {
  logError('giftcard.worker.unhandled_error', {
    workerId,
    error: error?.message || String(error),
    stack: error?.stack
  })
  await prisma.$disconnect()
  process.exit(1)
})


