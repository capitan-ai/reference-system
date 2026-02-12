const { Prisma } = require('@prisma/client')
const { randomUUID } = require('crypto')

const AVAILABILITY_CACHE_TTL_MS = 60 * 1000
let applicationLogAvailabilityCache = {
  status: null,
  checkedAt: 0
}

function isMissingRelationError(error, relationName = 'application_logs') {
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

// Check if ApplicationLog storage is available (table exists)
async function isApplicationLogAvailable(prisma, { force = false } = {}) {
  if (!prisma) {
    return false
  }
  
  const now = Date.now()
  if (!force &&
    applicationLogAvailabilityCache.status !== null &&
    now - applicationLogAvailabilityCache.checkedAt < AVAILABILITY_CACHE_TTL_MS) {
    return applicationLogAvailabilityCache.status
  }

  try {
    await prisma.$queryRaw`SELECT 1 FROM "application_logs" WHERE 1 = 0`
    applicationLogAvailabilityCache = {
      status: true,
      checkedAt: now
    }
    return true
  } catch (error) {
    if (isMissingRelationError(error, 'application_logs')) {
      applicationLogAvailabilityCache = {
        status: false,
        checkedAt: now
      }
      return false
    }
    console.warn('⚠️ ApplicationLog availability check error - assuming available:', error.message)
    applicationLogAvailabilityCache = {
      status: true,
      checkedAt: now
    }
    return true
  }
}

/**
 * Save application log (same pattern as enqueueWebhookJob)
 */
async function saveApplicationLog(prisma, {
  logType,        // webhook, cron, worker, api, structured
  logId,          // Unique identifier (event_id, job_id, or generated UUID)
  logCreatedAt = null, // When the event occurred
  payload,        // Complete log data
  organizationId = null,
  status = 'received',
  error = null,
  maxAttempts = 0 // 0 = log entry (not retryable)
}) {
  if (!prisma) {
    throw new Error('Prisma client is required')
  }

  const isAvailable = await isApplicationLogAvailable(prisma)
  if (!isAvailable) {
    console.warn('⚠️ ApplicationLog table not available - skipping log save')
    return null
  }

  try {
    const logEntryId = randomUUID()
    const now = new Date()
    const scheduleDate = logCreatedAt ? coerceDate(logCreatedAt) : now
    
    const payloadJson = serializeJson(payload, '{}')
    const maxAttemptsValue = Number.isFinite(maxAttempts) && maxAttempts >= 0 ? maxAttempts : 0

    // For logs, we use log_id + log_type + organization_id as unique key
    // This allows deduplication if same log is saved multiple times
    // But for most logs, logId will be unique (UUID or timestamp-based)
    const orgIdValue = organizationId ? Prisma.sql`${organizationId}::uuid` : Prisma.sql`NULL`
    const rows = await prisma.$queryRaw`
      INSERT INTO "application_logs" (
        "id",
        "organization_id",
        "log_type",
        "log_id",
        "log_created_at",
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
        ${logEntryId},
        ${orgIdValue},
        ${logType},
        ${logId},
        ${logCreatedAt ? coerceDate(logCreatedAt) : null}::timestamptz,
        ${status},
        ${payloadJson}::jsonb,
        0,
        ${maxAttemptsValue},
        ${scheduleDate}::timestamptz,
        NULL,
        NULL,
        ${error || null},
        ${now}::timestamptz,
        ${now}::timestamptz
      )
      ON CONFLICT ("organization_id", "log_id", "log_type")
      DO UPDATE SET
        "status" = ${status},
        "payload" = EXCLUDED."payload",
        "last_error" = EXCLUDED."last_error",
        "updated_at" = NOW()
      RETURNING "id", "log_type", "log_id", "status"
    `

    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch (error) {
    if (isMissingRelationError(error, 'application_logs')) {
      console.warn('⚠️ ApplicationLog table/column issue - skipping log save:', error.message)
      return null
    }
    throw error
  }
}

module.exports = {
  saveApplicationLog,
  isApplicationLogAvailable
}

