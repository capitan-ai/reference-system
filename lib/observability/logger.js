const { saveApplicationLog } = require('../workflows/application-log-queue')
const { PrismaClient } = require('@prisma/client')
const { randomUUID } = require('crypto')

const logPrisma = new PrismaClient()

const LEVELS = new Map([
  ['trace', 'debug'],
  ['debug', 'debug'],
  ['info', 'log'],
  ['warn', 'warn'],
  ['error', 'error']
])

function normalizeLevel(level) {
  if (!level) return 'info'
  const normalized = level.toString().toLowerCase()
  return LEVELS.has(normalized) ? normalized : 'info'
}

function emit(level, event, meta = {}) {
  const normalizedLevel = normalizeLevel(level)
  const method = LEVELS.get(normalizedLevel) || 'log'
  const output = {
    ts: new Date().toISOString(),
    level: normalizedLevel,
    event,
    ...meta
  }

  const line = JSON.stringify(output)
  console[method](line)

  // Save to database (non-blocking, same pattern as webhook_jobs)
  const logId = meta.logId || meta.eventId || meta.jobId || meta.correlationId || `${event}-${randomUUID()}`
  const organizationId = meta.organizationId || meta.context?.organizationId || meta.runContext?.organizationId || null
  
  saveApplicationLog(logPrisma, {
    logType: 'structured',
    logId,
    logCreatedAt: meta.timestamp ? new Date(meta.timestamp) : new Date(),
    payload: output, // Complete structured log data
    organizationId,
    status: normalizedLevel === 'error' ? 'error' : 'completed',
    error: meta.error || null,
    maxAttempts: 0
  }).catch(() => {}) // Silently fail if DB save fails
}

function logInfo(event, meta) {
  emit('info', event, meta)
}

function logWarn(event, meta) {
  emit('warn', event, meta)
}

function logError(event, meta) {
  emit('error', event, meta)
}

function logDebug(event, meta) {
  emit('debug', event, meta)
}

module.exports = {
  logInfo,
  logWarn,
  logError,
  logDebug
}


