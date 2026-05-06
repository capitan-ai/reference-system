const { Prisma } = require('@prisma/client')
const { randomUUID } = require('crypto')

const AVAILABILITY_CACHE_TTL_MS = 60 * 1000
// Shorter TTL for false results to allow quick recovery after migrations
const AVAILABILITY_CACHE_TTL_FALSE_MS = 10 * 1000
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
  
  // If cache is stale (older than TTL) or force refresh, always re-check
  const cacheAge = now - applicationLogAvailabilityCache.checkedAt
  const wasFalse = applicationLogAvailabilityCache.status === false
  // Use shorter TTL for false results to allow quick recovery after migrations
  const cacheTTL = wasFalse ? AVAILABILITY_CACHE_TTL_FALSE_MS : AVAILABILITY_CACHE_TTL_MS
  const isCacheStale = cacheAge >= cacheTTL
  
  if (!force && !isCacheStale && applicationLogAvailabilityCache.status !== null) {
    return applicationLogAvailabilityCache.status
  }

  try {
    // Try a simple query to verify table exists
    // Use Promise.race to add a shorter timeout (2 seconds) to avoid waiting for full pool timeout
    const queryPromise = prisma.$queryRaw`SELECT 1 FROM "application_logs" WHERE 1 = 0 LIMIT 1`
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Availability check timeout')), 2000)
    )
    
    await Promise.race([queryPromise, timeoutPromise])
    applicationLogAvailabilityCache = {
      status: true,
      checkedAt: now
    }
    return true
  } catch (error) {
    // Check if it's a missing table error
    if (isMissingRelationError(error, 'application_logs')) {
      applicationLogAvailabilityCache = {
        status: false,
        checkedAt: now
      }
      // Log only if cache was previously true (table disappeared) or if forcing
      if (force || applicationLogAvailabilityCache.status === true) {
        console.warn('⚠️ ApplicationLog table not available - skipping log save')
      }
      return false
    }
    
    // For connection pool timeout errors, silently assume available (common in serverless)
    // Only log other errors to reduce noise
    const isConnectionPoolError = error.message?.includes('connection pool') || 
                                   error.message?.includes('Timed out fetching')
    
    if (!isConnectionPoolError) {
      console.warn('⚠️ ApplicationLog availability check error - assuming available:', error.message)
    }
    
    // For all transient errors (connection issues, timeouts, etc.), assume available
    // This prevents transient errors from blocking logging
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
        ${status}::text::"ApplicationLogStatus",
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
        "status" = ${status}::text::"ApplicationLogStatus",
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

