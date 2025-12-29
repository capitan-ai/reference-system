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


