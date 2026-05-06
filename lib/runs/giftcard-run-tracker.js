const crypto = require('crypto')
const { Prisma } = require('@prisma/client')

const AVAILABILITY_CACHE_TTL_MS = 60 * 1000
let giftCardRunAvailabilityCache = {
  status: null,
  checkedAt: 0
}

const RUN_SELECT_FIELDS = Prisma.sql`
  "id",
  "correlation_id" AS "correlationId",
  "square_event_id" AS "squareEventId",
  "square_event_type" AS "squareEventType",
  "trigger_type" AS "triggerType",
  "resource_id" AS "resourceId",
  "stage",
  "status",
  "attempts",
  "last_error" AS "lastError",
  "payload",
  "context",
  "resumed_at" AS "resumedAt",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"
`

function isMissingRelationError(error, relationName = 'giftcard_runs') {
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

function safePart(value, fallback = 'na') {
  if (value === undefined || value === null) return fallback
  const stringValue = value.toString().trim()
  if (!stringValue) return fallback
  return stringValue.replace(/[^a-zA-Z0-9:_\-]/g, '-')
}

function hashFor(parts) {
  const raw = parts.filter(Boolean).join('::')
  return crypto.createHash('sha256').update(raw).digest('hex')
}

function buildCorrelationId({ triggerType, eventId, resourceId }) {
  const typePart = safePart(triggerType, 'event').toLowerCase()
  const digest = hashFor([triggerType, resourceId, eventId])
  return `${typePart}:${digest.slice(0, 24)}`
}

function buildStageKey(correlationId, stage, action) {
  return buildIdempotencyKey([correlationId, stage || 'stage', action || 'op'])
}

function buildIdempotencyKey(parts) {
  const arrayParts = Array.isArray(parts) ? parts : [parts]
  const normalized = arrayParts
    .filter(Boolean)
    .map((part) => safePart(part).toLowerCase())
  const joined = normalized.join(':')
  // Square API requires idempotency keys to be <= 45 characters
  // This applies to: Orders API, Payments API, Gift Cards API, Gift Card Activity API
  if (joined.length <= 45) {
    return joined
  }
  // Hash and truncate to fit Square's 45 character limit
  const digest = hashFor(normalized)
  // Use first part (if available) + hash, but keep total <= 45
  const prefix = normalized[0] || 'idemp'
  // Limit prefix to ensure total length <= 45
  // Reserve 1 char for colon, so hash can be up to (45 - prefixLength - 1)
  const maxPrefixLength = Math.min(prefix.length, 10) // Cap prefix at 10 chars
  const hashLength = 45 - maxPrefixLength - 1 // -1 for the colon
  return `${prefix.slice(0, maxPrefixLength)}:${digest.slice(0, hashLength)}`
}

function sanitizeData(data = {}) {
  const result = {}
  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) {
      return
    }
    result[key] = value
  })
  return result
}

// Check if GiftCardRun storage is available (table exists)
async function isGiftCardRunAvailable(prisma, { force = false } = {}) {
  if (!prisma) {
    return false
  }
  
  const now = Date.now()
  if (!force &&
    giftCardRunAvailabilityCache.status !== null &&
    now - giftCardRunAvailabilityCache.checkedAt < AVAILABILITY_CACHE_TTL_MS) {
    return giftCardRunAvailabilityCache.status
  }

  try {
    await prisma.$queryRaw`SELECT 1 FROM "giftcard_runs" WHERE 1 = 0`
    giftCardRunAvailabilityCache = {
      status: true,
      checkedAt: now
    }
    return true
  } catch (error) {
    if (isMissingRelationError(error, 'giftcard_runs')) {
      giftCardRunAvailabilityCache = {
        status: false,
        checkedAt: now
      }
      return false
    }
    console.warn('⚠️ GiftCardRun availability check error - assuming available:', error.message)
    giftCardRunAvailabilityCache = {
      status: true,
      checkedAt: now
    }
    return true
  }
}

function buildRunUpsertUpdateClause(updateData = {}) {
  const clauses = []
  if (updateData.triggerType !== undefined) {
    clauses.push(Prisma.sql`"trigger_type" = EXCLUDED."trigger_type"`)
  }
  if (updateData.squareEventId !== undefined) {
    clauses.push(Prisma.sql`"square_event_id" = EXCLUDED."square_event_id"`)
  }
  if (updateData.squareEventType !== undefined) {
    clauses.push(Prisma.sql`"square_event_type" = EXCLUDED."square_event_type"`)
  }
  if (updateData.resourceId !== undefined) {
    clauses.push(Prisma.sql`"resource_id" = EXCLUDED."resource_id"`)
  }
  if (updateData.stage !== undefined) {
    clauses.push(Prisma.sql`"stage" = EXCLUDED."stage"`)
  }
  if (updateData.status !== undefined) {
    clauses.push(Prisma.sql`"status" = EXCLUDED."status"`)
  }
  if (updateData.attempts !== undefined) {
    clauses.push(Prisma.sql`"attempts" = EXCLUDED."attempts"`)
  }
  if (updateData.payload !== undefined) {
    clauses.push(Prisma.sql`"payload" = EXCLUDED."payload"`)
  }
  if (updateData.context !== undefined) {
    clauses.push(Prisma.sql`"context" = EXCLUDED."context"`)
  }
  clauses.push(Prisma.sql`"updated_at" = NOW()`)
  return Prisma.join(clauses, ', ')
}

async function ensureGiftCardRun(prisma, {
  correlationId,
  triggerType,
  squareEventId,
  squareEventType,
  resourceId,
  stage,
  status = 'pending',
  attempts,
  payload,
  context
}) {
  if (!prisma || !correlationId) {
    return null
  }

  const isAvailable = await isGiftCardRunAvailable(prisma)
  if (!isAvailable) {
    console.warn('⚠️ GiftCardRun storage not available - skipping tracking')
    console.warn('   This usually means the Prisma client or migration is missing the giftcard_runs table')
    return null
  }

  try {
    const updateData = sanitizeData({
      triggerType,
      squareEventId,
      squareEventType,
      resourceId,
      stage,
      status,
      attempts,
      payload: payload === undefined ? undefined : payload,
      context: context === undefined ? undefined : context
    })

    const createRecord = {
      id: crypto.randomUUID(),
        correlationId,
      squareEventId: squareEventId ?? null,
      squareEventType: squareEventType ?? null,
        triggerType: triggerType || 'unknown',
      resourceId: resourceId ?? null,
      stage: stage ?? null,
        status: status || 'pending',
      attempts: Number.isFinite(attempts) ? attempts : 0,
      payload: payload ?? null,
      context: context ?? null
    }

    const payloadJson = serializeJson(createRecord.payload)
    const contextJson = serializeJson(createRecord.context)

    const rows = await prisma.$queryRaw`
      INSERT INTO "giftcard_runs" (
        "id",
        "correlation_id",
        "square_event_id",
        "square_event_type",
        "trigger_type",
        "resource_id",
        "stage",
        "status",
        "attempts",
        "last_error",
        "payload",
        "context",
        "resumed_at",
        "created_at",
        "updated_at"
      ) VALUES (
        ${createRecord.id},
        ${createRecord.correlationId},
        ${createRecord.squareEventId},
        ${createRecord.squareEventType},
        ${createRecord.triggerType},
        ${createRecord.resourceId},
        ${createRecord.stage},
        ${createRecord.status},
        ${createRecord.attempts},
        NULL,
        ${payloadJson}::jsonb,
        ${contextJson}::jsonb,
        NULL,
        NOW(),
        NOW()
      )
      ON CONFLICT ("correlation_id")
      DO UPDATE SET
        ${buildRunUpsertUpdateClause(updateData)}
      RETURNING ${RUN_SELECT_FIELDS}
    `

    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch (error) {
    if (isMissingRelationError(error, 'giftcard_runs')) {
      console.warn('⚠️ GiftCardRun table/column issue - skipping tracking:', error.message)
      console.warn('   This usually means the Prisma client needs to be regenerated or migration needs to be applied')
      return null
    }
    throw error
  }
}

async function updateGiftCardRunStage(prisma, correlationId, {
  stage,
  status,
  incrementAttempts = false,
  lastError,
  clearError = false,
  payload,
  context,
  resumedAt
} = {}) {
  if (!prisma || !correlationId) {
    return null
  }

  const isAvailable = await isGiftCardRunAvailable(prisma)
  if (!isAvailable) {
    return null
  }

  try {
    const updates = []
    if (stage !== undefined) {
      updates.push(Prisma.sql`"stage" = ${stage}`)
    }
    if (status !== undefined) {
      updates.push(Prisma.sql`"status" = ${status}`)
    }
    if (incrementAttempts) {
      updates.push(Prisma.sql`"attempts" = "attempts" + 1`)
    }
    if (lastError !== undefined) {
      updates.push(Prisma.sql`"last_error" = ${lastError}`)
    }
    if (clearError) {
      updates.push(Prisma.sql`"last_error" = NULL`)
    }
    if (payload !== undefined) {
      updates.push(Prisma.sql`"payload" = ${serializeJson(payload)}::jsonb`)
    }
    if (context !== undefined) {
      updates.push(Prisma.sql`"context" = ${serializeJson(context)}::jsonb`)
    }
    if (resumedAt !== undefined) {
      updates.push(Prisma.sql`"resumed_at" = ${resumedAt}`)
    }

    if (updates.length === 0) {
      return null
    }

    updates.push(Prisma.sql`"updated_at" = NOW()`)
    const setClause = Prisma.join(updates, ', ')

    const rows = await prisma.$queryRaw`
      UPDATE "giftcard_runs"
      SET ${setClause}
      WHERE "correlation_id" = ${correlationId}
      RETURNING ${RUN_SELECT_FIELDS}
    `

    return Array.isArray(rows) ? rows[0] ?? null : null
  } catch (error) {
    // If the table doesn't exist or column mapping issue, log and return null
    if (isMissingRelationError(error, 'giftcard_runs')) {
      console.warn('⚠️ GiftCardRun table/column issue - skipping update:', error.message)
      return null
    }
    // Re-throw other errors
    throw error
  }
}

async function markGiftCardRunError(prisma, correlationId, error, overrides = {}) {
  if (!prisma || !correlationId) {
    return null
  }

  // Check if the model is available before trying to use it
  const isAvailable = await isGiftCardRunAvailable(prisma)
  if (!isAvailable) {
    return null
  }

  try {
    const message = error instanceof Error ? error.message : safePart(error, 'unknown-error')
    const truncated = message.length > 500 ? `${message.slice(0, 500)}…` : message

    return await updateGiftCardRunStage(prisma, correlationId, {
      status: 'error',
      lastError: truncated,
      ...overrides
    })
  } catch (updateError) {
    // If update fails, just log and return null - don't fail the whole operation
    if (updateError.code === 'P2021' || updateError.code === 'P2022') {
      console.warn('⚠️ GiftCardRun table/column issue - skipping error marking:', updateError.message)
      return null
    }
    // Re-throw other errors
    throw updateError
  }
}

module.exports = {
  isGiftCardRunAvailable,
  buildCorrelationId,
  buildStageKey,
  buildIdempotencyKey,
  ensureGiftCardRun,
  updateGiftCardRunStage,
  markGiftCardRunError
}

