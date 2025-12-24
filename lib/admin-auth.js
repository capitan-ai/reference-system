const crypto = require('crypto')

const SESSION_COOKIE_NAME = 'zorina_admin_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 12 // 12 hours

function getAdminKey() {
  return process.env.ANALYTICS_ADMIN_KEY?.trim() || null
}

function getSessionSecret() {
  return process.env.NEXTAUTH_SECRET?.trim() || getAdminKey()
}

function timingSafeEqual(a = '', b = '') {
  const aBuffer = Buffer.from(String(a))
  const bBuffer = Buffer.from(String(b))
  if (aBuffer.length !== bBuffer.length) {
    return false
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer)
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const [key, ...valueParts] = entry.split('=')
      if (!key) return acc
      acc[key] = valueParts.join('=')
      return acc
    }, {})
}

function createSessionToken(payload = {}) {
  const secret = getSessionSecret()
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET or ANALYTICS_ADMIN_KEY must be set to create sessions')
  }

  const issuedAt = Date.now()
  const data = {
    issuedAt,
    ...payload,
  }
  const base = Buffer.from(JSON.stringify(data)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(base).digest('base64url')
  return `${base}.${signature}`
}

function verifySessionToken(token) {
  const secret = getSessionSecret()
  if (!secret || !token || typeof token !== 'string' || !token.includes('.')) {
    return null
  }
  const [base, signature] = token.split('.')
  const expectedSignature = crypto.createHmac('sha256', secret).update(base).digest('base64url')
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(base, 'base64url').toString('utf8'))
    if (!payload?.issuedAt) {
      return null
    }
    const age = Date.now() - Number(payload.issuedAt)
    if (!Number.isFinite(age) || age > SESSION_TTL_MS) {
      return null
    }
    return payload
  } catch (error) {
    return null
  }
}

function buildSessionCookie(token, options = {}) {
  const secure = (process.env.NODE_ENV || '').toLowerCase() !== 'development'
  const maxAgeSeconds = Math.floor((options.ttlMs || SESSION_TTL_MS) / 1000)
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Strict',
  ]
  if (secure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

function buildExpiredSessionCookie() {
  const secure = (process.env.NODE_ENV || '').toLowerCase() !== 'development'
  const parts = [
    `${SESSION_COOKIE_NAME}=deleted`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
  ]
  if (secure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

async function authorizeAdminRequest(request) {
  const expectedKey = getAdminKey()
  if (!expectedKey) {
    return {
      authorized: false,
      status: 500,
      error: 'ANALYTICS_ADMIN_KEY is not configured',
    }
  }

  const headerKey = request.headers.get('x-admin-key')?.trim()
  if (headerKey && timingSafeEqual(headerKey, expectedKey)) {
    return { authorized: true, method: 'header' }
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const bearerKey = authHeader.substring(7).trim()
    if (bearerKey && timingSafeEqual(bearerKey, expectedKey)) {
      return { authorized: true, method: 'bearer' }
    }
  }

  const cookies = parseCookies(request.headers.get('cookie') || '')
  if (cookies[SESSION_COOKIE_NAME]) {
    const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME])
    if (payload) {
      return { authorized: true, method: 'cookie', session: payload }
    }
  }

  return {
    authorized: false,
    status: 401,
    error: 'Unauthorized',
  }
}

function validateAdminKeyInput(inputKey) {
  const expectedKey = getAdminKey()
  if (!expectedKey) {
    return {
      valid: false,
      status: 500,
      error: 'ANALYTICS_ADMIN_KEY is not configured',
    }
  }
  if (!inputKey || typeof inputKey !== 'string') {
    return {
      valid: false,
      status: 400,
      error: 'adminKey is required',
    }
  }
  if (!timingSafeEqual(inputKey.trim(), expectedKey)) {
    return {
      valid: false,
      status: 401,
      error: 'Invalid admin key',
    }
  }
  return { valid: true }
}

function createAdminSessionCookie() {
  const token = createSessionToken()
  return buildSessionCookie(token)
}

module.exports = {
  authorizeAdminRequest,
  validateAdminKeyInput,
  createAdminSessionCookie,
  buildExpiredSessionCookie,
  SESSION_COOKIE_NAME,
}

