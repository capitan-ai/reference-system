const { Prisma } = require('@prisma/client')
const { randomUUID } = require('crypto')

const AVAILABILITY_CACHE_TTL_MS = 60 * 1000
let webhookJobAvailabilityCache = {
  status: null,
  checkedAt: 0
}

function isMissingRelationError(error, relationName = 'webhook_jobs') {
  if (!error) return false
  if (error.code === 'P2021' || error.code === 'P2022') {
    return true
  }
  const message = error.message || ''
  return message.includes(`relation "${relationName}" does not exist`) ||
    message.includes(`missing FROM-clause entry for table "${relationName}"`)
}

function serializeJson(value, fallback = null) {
  if (value === undefined) {
    return fallback
  }
  if (value === null) {
    return null
  }
  return JSON.stringify(value)
}

function coerceDate(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  return fallback
}

// Check if WebhookJob storage is available (table exists)
async function isWebhookJobAvailable(prisma, { force = false } = {}) {
  if (!prisma) {
    return false
  }
  
  const now = Date.now()
  if (!force &&
    webhookJobAvailabilityCache.status !== null &&
    now - webhookJobAvailabilityCache.checkedAt < AVAILABILITY_CACHE_TTL_MS) {
    return webhookJobAvailabilityCache.status
  }

  try {
    await prisma.$queryRaw`SELECT 1 FROM "webhook_jobs" WHERE 1 = 0`
    webhookJobAvailabilityCache = {
      status: true,
      checkedAt: now
    }
    return true
  } catch (error) {
    if (isMissingRelationError(error, 'webhook_jobs')) {
      webhookJobAvailabilityCache = {
        status: false,
        checkedAt: now
      }
      return false
    }
    console.warn('⚠️ WebhookJob availability check error - assuming available:', error.message)
    webhookJobAvailabilityCache = {
      status: true,
      checkedAt: now
    }
    return true
  }
}

function computeBackoffDelay(attempts = 1) {
  const base = 5000 // 5 seconds
  const maxDelay = 300000 // 5 minutes
  const delay = Math.min(base * Math.pow(2, attempts - 1), maxDelay)
  return delay
}

/**
 * Enqueue a webhook job for retry processing
 */
async function enqueueWebhookJob(prisma, {
  eventType,
  eventId,
  eventCreatedAt = null,
  payload,
  error = null,
  scheduledAt = null,
  maxAttempts = 5
}) {
  if (!prisma) {
    throw new Error('Prisma client is required')
  }

  const isAvailable = await isWebhookJobAvailable(prisma)
  if (!isAvailable) {
    console.warn('⚠️ WebhookJob table not available - skipping job queue')
    return null
  }

  try {
    const jobId = randomUUID()
    const now = new Date()
    const scheduleDate = scheduledAt ? coerceDate(scheduledAt) : now
    
    // If there's an error, add backoff delay
    let finalScheduledAt = scheduleDate
    if (error) {
      const delayMs = computeBackoffDelay(1) // First retry
      finalScheduledAt = new Date(now.getTime() + delayMs)
    }

    const payloadJson = serializeJson(payload, '{}')
    const maxAttemptsValue = Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5

    const rows = await prisma.$queryRaw`
      INSERT INTO "webhook_jobs" (
        "id",
        "event_type",
        "event_id",
        "event_created_at",
        "status",
        "payload",
        "attempts",
        "max_attempts",
        "scheduled_at",
        "locked_at",
        "lock_owner",
        "last_error",
        "created_at",
        "updated_at"
      ) VALUES (
        ${jobId}::uuid,
        ${eventType},
        ${eventId},
        ${eventCreatedAt ? coerceDate(eventCreatedAt) : null}::timestamptz,
        'queued',
        ${payloadJson}::jsonb,
        0,
        ${maxAttemptsValue},
        ${finalScheduledAt}::timestamptz,
        NULL,
        NULL,
        ${error || null},
        ${now}::timestamptz,
        ${now}::timestamptz
      )
      ON CONFLICT ("event_id", "event_type")
      DO UPDATE SET
        "status" = 'queued',
        "payload" = EXCLUDED."payload",
        "scheduled_at" = EXCLUDED."scheduled_at",
        "last_error" = EXCLUDED."last_error",
        "updated_at" = NOW()
      RETURNING "id", "event_type", "event_id", "status"
    `

    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch (error) {
    if (isMissingRelationError(error, 'webhook_jobs')) {
      console.warn('⚠️ WebhookJob table/column issue - skipping job queue:', error.message)
      return null
    }
    throw error
  }
}

/**
 * Lock and return the next webhook job to process
 */
async function lockNextWebhookJob(prisma, workerId) {
  if (!prisma) {
    throw new Error('Prisma client is required')
  }

  const isAvailable = await isWebhookJobAvailable(prisma)
  if (!isAvailable) {
    return null
  }

  try {
    const now = new Date()
    const lockTimeout = new Date(now.getTime() - 300000) // 5 minutes ago

    const jobs = await prisma.$queryRaw`
      SELECT 
        "id",
        "event_type",
        "event_id",
        "event_created_at",
        "payload",
        "attempts",
        "max_attempts",
        "last_error"
      FROM "webhook_jobs"
      WHERE "status" = 'queued'
        AND "scheduled_at" <= ${now}::timestamptz
        AND ("locked_at" IS NULL OR "locked_at" < ${lockTimeout}::timestamptz)
      ORDER BY "scheduled_at" ASC, "created_at" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `

    if (!jobs || jobs.length === 0) {
      return null
    }

    const job = jobs[0]

    // Lock the job
    await prisma.$executeRaw`
      UPDATE "webhook_jobs"
      SET "status" = 'processing',
          "locked_at" = ${now}::timestamptz,
          "lock_owner" = ${workerId},
          "updated_at" = ${now}::timestamptz
      WHERE "id" = ${job.id}::uuid
    `

    return {
      id: job.id,
      eventType: job.event_type,
      eventId: job.event_id,
      eventCreatedAt: job.event_created_at,
      payload: job.payload,
      attempts: job.attempts || 0,
      maxAttempts: job.max_attempts || 5,
      lastError: job.last_error
    }
  } catch (error) {
    if (isMissingRelationError(error, 'webhook_jobs')) {
      return null
    }
    throw error
  }
}

/**
 * Mark a webhook job as completed
 */
async function completeWebhookJob(prisma, jobId) {
  if (!prisma || !jobId) {
    return
  }

  try {
    await prisma.$executeRaw`
      UPDATE "webhook_jobs"
      SET "status" = 'completed',
          "locked_at" = NULL,
          "lock_owner" = NULL,
          "updated_at" = NOW()
      WHERE "id" = ${jobId}::uuid
    `
  } catch (error) {
    if (!isMissingRelationError(error, 'webhook_jobs')) {
      throw error
    }
  }
}

/**
 * Mark a webhook job as failed and schedule retry if applicable
 */
async function failWebhookJob(prisma, jobId, error, { delayMs = null } = {}) {
  if (!prisma || !jobId) {
    return
  }

  try {
    const job = await prisma.$queryRaw`
      SELECT "attempts", "max_attempts" FROM "webhook_jobs" WHERE "id" = ${jobId}::uuid
    `

    if (!job || job.length === 0) {
      return
    }

    const currentAttempts = job[0].attempts || 0
    const maxAttempts = job[0].max_attempts || 5
    const shouldRetry = currentAttempts + 1 < maxAttempts

    const newAttempts = currentAttempts + 1
    const now = new Date()
    const errorMessage = error?.message || String(error) || 'Unknown error'

    if (shouldRetry) {
      // Calculate exponential backoff
      const backoffDelay = delayMs || computeBackoffDelay(newAttempts)
      const scheduledAt = new Date(now.getTime() + backoffDelay)

      await prisma.$executeRaw`
        UPDATE "webhook_jobs"
        SET "status" = 'queued',
            "attempts" = ${newAttempts},
            "scheduled_at" = ${scheduledAt}::timestamptz,
            "last_error" = ${errorMessage},
            "locked_at" = NULL,
            "lock_owner" = NULL,
            "updated_at" = ${now}::timestamptz
        WHERE "id" = ${jobId}::uuid
      `
    } else {
      // Max attempts reached - mark as error
      await prisma.$executeRaw`
        UPDATE "webhook_jobs"
        SET "status" = 'error',
            "attempts" = ${newAttempts},
            "last_error" = ${errorMessage},
            "locked_at" = NULL,
            "lock_owner" = NULL,
            "updated_at" = ${now}::timestamptz
        WHERE "id" = ${jobId}::uuid
      `
    }
  } catch (error) {
    if (!isMissingRelationError(error, 'webhook_jobs')) {
      throw error
    }
  }
}

module.exports = {
  enqueueWebhookJob,
  lockNextWebhookJob,
  completeWebhookJob,
  failWebhookJob,
  isWebhookJobAvailable
}


