const { Prisma } = require('@prisma/client')
const { randomUUID } = require('crypto')

const AVAILABILITY_CACHE_TTL_MS = 60 * 1000
let giftCardJobAvailabilityCache = {
  status: null,
  checkedAt: 0
}

function isMissingRelationError(error, relationName = 'giftcard_jobs') {
  if (!error) return false
  if (error.code === 'P2021' || error.code === 'P2022') {
    return true
  }
  const message = error.message || ''
  return message.includes(`relation "${relationName}" does not exist`) ||
    message.includes(`missing FROM-clause entry for table "${relationName}"`)
}

const JOB_SELECT_FIELDS = Prisma.sql`
  "id",
  "correlation_id" AS "correlationId",
  "trigger_type" AS "triggerType",
  "stage",
  "status",
  "payload",
  "context",
  "attempts",
  "max_attempts" AS "maxAttempts",
  "scheduled_at" AS "scheduledAt",
  "locked_at" AS "lockedAt",
  "lock_owner" AS "lockOwner",
  "last_error" AS "lastError",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"
`

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

// Check if GiftCardJob storage is available (table exists)
async function isGiftCardJobAvailable(prisma, { force = false } = {}) {
  if (!prisma) {
    return false
  }
  
  const now = Date.now()
  if (!force &&
    giftCardJobAvailabilityCache.status !== null &&
    now - giftCardJobAvailabilityCache.checkedAt < AVAILABILITY_CACHE_TTL_MS) {
    return giftCardJobAvailabilityCache.status
  }

  try {
    await prisma.$queryRaw`SELECT 1 FROM "giftcard_jobs" WHERE 1 = 0`
    giftCardJobAvailabilityCache = {
      status: true,
      checkedAt: now
    }
    return true
  } catch (error) {
    if (isMissingRelationError(error, 'giftcard_jobs')) {
      giftCardJobAvailabilityCache = {
        status: false,
        checkedAt: now
      }
      return false
    }
    // For transient issues, assume available to avoid unnecessary degradation
    console.warn('⚠️ GiftCardJob availability check error - assuming available:', error.message)
    giftCardJobAvailabilityCache = {
      status: true,
      checkedAt: now
    }
    return true
  }
}

function computeBackoffDelay(attempts = 1) {
  const base = 5000
  const exponent = Math.max(0, attempts - 1)
  const delay = base * Math.pow(2, exponent)
  return Math.min(delay, 5 * 60 * 1000) // cap at 5 minutes
}

async function enqueueGiftCardJob(prisma, {
  correlationId,
  triggerType,
  stage,
  payload,
  context,
  scheduledAt,
  maxAttempts
}) {
  if (!prisma || !correlationId || !stage) {
    console.warn('⚠️ enqueueGiftCardJob: missing required parameters, skipping job queue')
    return null
  }

  // Check if the storage is available before trying to use it
  const isAvailable = await isGiftCardJobAvailable(prisma)
  if (!isAvailable) {
    console.warn('⚠️ GiftCardJob storage not available - skipping job queue')
    console.warn('   This usually means the Prisma client or database migration is missing the giftcard_jobs table')
    console.warn('   Webhook will continue processing without async job queue')
    return null
  }

  try {
    const now = new Date()
    const jobId = randomUUID()
    const scheduleDate = coerceDate(scheduledAt, now)
    const payloadJson = serializeJson(payload, '{}')
    const contextJson = serializeJson(context, null)
    const maxAttemptsValue = Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5

    const rows = await prisma.$queryRaw`
      INSERT INTO "giftcard_jobs" (
        "id",
        "correlation_id",
        "trigger_type",
        "stage",
        "status",
        "payload",
        "context",
        "attempts",
        "max_attempts",
        "scheduled_at",
        "locked_at",
        "lock_owner",
        "last_error",
        "created_at",
        "updated_at"
      ) VALUES (
        ${jobId},
        ${correlationId},
        ${triggerType || 'unknown'},
        ${stage},
        'queued',
        ${payloadJson || '{}'}::jsonb,
        ${contextJson}::jsonb,
        0,
        ${maxAttemptsValue},
        ${scheduleDate},
        NULL,
        NULL,
        NULL,
        ${now},
        ${now}
      )
      ON CONFLICT ("correlation_id", "stage")
      DO UPDATE SET
        "trigger_type" = EXCLUDED."trigger_type",
        "status" = 'queued',
        "payload" = EXCLUDED."payload",
        "context" = EXCLUDED."context",
        "max_attempts" = EXCLUDED."max_attempts",
        "scheduled_at" = EXCLUDED."scheduled_at",
        "locked_at" = NULL,
        "lock_owner" = NULL,
        "last_error" = NULL,
        "updated_at" = NOW()
      RETURNING ${JOB_SELECT_FIELDS}
    `

    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch (error) {
    // If the table doesn't exist or column mapping issue, log and return null
    if (isMissingRelationError(error, 'giftcard_jobs')) {
      console.warn('⚠️ GiftCardJob table/column issue - skipping job queue:', error.message)
      console.warn('   Webhook will continue processing without async job queue')
      return null
    }
    // Re-throw other errors
    throw error
  }
}

async function lockNextGiftCardJob(prisma, workerId, excludeStages = []) {
  if (!prisma) {
    throw new Error('Prisma client is required')
  }

  const isAvailable = await isGiftCardJobAvailable(prisma)
  if (!isAvailable) {
    console.warn('⚠️ GiftCardJob storage not available - worker idle')
    return null
  }

  const effectiveWorkerId = workerId || randomUUID()
  const lockTimestamp = new Date()
  const stageList = Array.isArray(excludeStages)
    ? excludeStages.filter((value) => typeof value === 'string' && value.trim().length > 0)
    : []

  try {
    return await prisma.$transaction(async (tx) => {
      const baseQuery = stageList.length > 0
        ? tx.$queryRaw`
          SELECT ${JOB_SELECT_FIELDS}
        FROM "giftcard_jobs"
        WHERE "status" = 'queued'
          AND "scheduled_at" <= NOW()
          AND "stage" NOT IN (${Prisma.join(stageList)})
        ORDER BY "scheduled_at" ASC, "created_at" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `
        : tx.$queryRaw`
          SELECT ${JOB_SELECT_FIELDS}
        FROM "giftcard_jobs"
        WHERE "status" = 'queued'
          AND "scheduled_at" <= NOW()
        ORDER BY "scheduled_at" ASC, "created_at" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `

      const candidates = await baseQuery

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null
    }

    const job = candidates[0]

      const lockedRows = await tx.$queryRaw`
        UPDATE "giftcard_jobs"
        SET
          "status" = 'running',
          "attempts" = "attempts" + 1,
          "locked_at" = ${lockTimestamp},
          "lock_owner" = ${effectiveWorkerId},
          "last_error" = NULL,
          "updated_at" = ${lockTimestamp}
        WHERE "id" = ${job.id}
        RETURNING ${JOB_SELECT_FIELDS}
      `

      return Array.isArray(lockedRows) ? lockedRows[0] ?? null : null
  }, {
    isolationLevel: 'Serializable'
  })
  } catch (error) {
    if (isMissingRelationError(error, 'giftcard_jobs')) {
      console.warn('⚠️ GiftCardJob table unavailable while locking job:', error.message)
      return null
    }
    throw error
  }
}

async function completeGiftCardJob(prisma, jobId) {
  if (!jobId) return null
  const isAvailable = await isGiftCardJobAvailable(prisma)
  if (!isAvailable) {
    return null
  }

  try {
    const rows = await prisma.$queryRaw`
      UPDATE "giftcard_jobs"
      SET
        "status" = 'completed',
        "locked_at" = NULL,
        "lock_owner" = NULL,
        "last_error" = NULL,
        "updated_at" = NOW()
      WHERE "id" = ${jobId}
      RETURNING ${JOB_SELECT_FIELDS}
    `
    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch (error) {
    if (isMissingRelationError(error, 'giftcard_jobs')) {
      console.warn('⚠️ GiftCardJob table unavailable while completing job:', error.message)
      return null
    }
    throw error
  }
}

async function failGiftCardJob(prisma, job, error, options = {}) {
  if (!job?.id) return null

  const isAvailable = await isGiftCardJobAvailable(prisma)
  if (!isAvailable) {
    return null
  }

  const attempts = job.attempts || 0
  const maxAttempts = job.maxAttempts || 5
  const shouldRetry = attempts < maxAttempts
  const backoffDelayMs = computeBackoffDelay(attempts)

  const delayOverrideMs = Number.isFinite(options?.delayMs)
    ? Number(options.delayMs)
    : null
  const scheduleOverride =
    options?.scheduledAt instanceof Date ? options.scheduledAt : null

  const effectiveNextRun = (() => {
    if (!shouldRetry) return job.scheduledAt
    if (scheduleOverride) return scheduleOverride
    if (delayOverrideMs !== null) {
      return new Date(Date.now() + delayOverrideMs)
    }
    return new Date(Date.now() + backoffDelayMs)
  })()

  const errorMessage = error instanceof Error ? error.message : String(error ?? 'unknown error')
  const truncatedError = errorMessage.length > 500 ? `${errorMessage.slice(0, 500)}…` : errorMessage

  try {
    const rows = await prisma.$queryRaw`
      UPDATE "giftcard_jobs"
      SET
        "status" = ${shouldRetry ? 'queued' : 'error'},
        "scheduled_at" = ${effectiveNextRun},
        "locked_at" = NULL,
        "lock_owner" = NULL,
        "last_error" = ${truncatedError},
        "updated_at" = NOW()
      WHERE "id" = ${job.id}
      RETURNING ${JOB_SELECT_FIELDS}
    `
    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch (updateError) {
    if (isMissingRelationError(updateError, 'giftcard_jobs')) {
      console.warn('⚠️ GiftCardJob table unavailable while failing job:', updateError.message)
      return null
    }
    throw updateError
  }
}

module.exports = {
  isGiftCardJobAvailable,
  enqueueGiftCardJob,
  lockNextGiftCardJob,
  completeGiftCardJob,
  failGiftCardJob,
  computeBackoffDelay
}

