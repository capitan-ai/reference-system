import { cookies } from 'next/headers'
import crypto from 'crypto'

// Dynamic import for prisma to work with both ESM and CommonJS
const getPrisma = async () => {
  const prismaModule = await import('../prisma-client')
  return prismaModule.default || prismaModule
}

const SESSION_COOKIE_NAME = 'phone_verification_session'
const SESSION_DURATION_DAYS = 30 // Session lasts 30 days

/**
 * Generate a secure session token
 */
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Create a verified session after successful phone verification
 */
export async function createVerifiedSession(phoneNumber, sessionToken) {
  try {
    const prisma = await getPrisma()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS)

    // Invalidate old sessions for this phone
    await prisma.$executeRaw`
      DELETE FROM verified_phone_sessions
      WHERE phone_number = ${phoneNumber}
    `
    // Create new session
    await prisma.$executeRaw`
      INSERT INTO verified_phone_sessions (id, phone_number, session_token, expires_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${phoneNumber}, ${sessionToken}, ${expiresAt}, NOW(), NOW())
    `
    return { sessionToken, expiresAt }
  } catch (err) {
    throw err
  }
}

/**
 * Set session cookie (httpOnly for security)
 */
export async function setSessionCookie(sessionToken, expiresAt) {
  try {
    const cookieStore = await cookies()
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/'
    })
  } catch (err) {
    throw err
  }
}

/**
 * Get session token from cookie
 */
export async function getSessionToken() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value || null
    return token
  } catch (err) {
    return null
  }
}

/**
 * Verify if session is valid
 */
export async function verifySession(sessionToken, phoneNumber) {
  if (!sessionToken || !phoneNumber) {
    return { valid: false }
  }

  try {
    const prisma = await getPrisma()
    const session = await prisma.$queryRaw`
      SELECT id, phone_number, session_token, expires_at
      FROM verified_phone_sessions
      WHERE session_token = ${sessionToken}
        AND phone_number = ${phoneNumber}
        AND expires_at > NOW()
      LIMIT 1
    `
    if (!session || session.length === 0) {
      return { valid: false }
    }
    return { valid: true, session: session[0] }
  } catch (err) {
    return { valid: false }
  }
}

/**
 * Clean up expired sessions (can be called periodically)
 */
export async function cleanupExpiredSessions() {
  const prisma = await getPrisma()
  await prisma.$executeRaw`
    DELETE FROM verified_phone_sessions
    WHERE expires_at < NOW()
  `
}
