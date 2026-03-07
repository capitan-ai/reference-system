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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:23',message:'createVerifiedSession entry',data:{phoneNumber,sessionTokenLength:sessionToken?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  try {
    const prisma = await getPrisma()
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:27',message:'prisma client retrieved',data:{hasPrisma:!!prisma,hasExecuteRaw:typeof prisma?.$executeRaw},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS)

    // Invalidate old sessions for this phone
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:32',message:'before DELETE old sessions',data:{phoneNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    await prisma.$executeRaw`
      DELETE FROM verified_phone_sessions
      WHERE phone_number = ${phoneNumber}
    `
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:36',message:'after DELETE old sessions',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    // Create new session
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:40',message:'before INSERT new session',data:{phoneNumber,expiresAt:expiresAt.toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    await prisma.$executeRaw`
      INSERT INTO verified_phone_sessions (id, phone_number, session_token, expires_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${phoneNumber}, ${sessionToken}, ${expiresAt}, NOW(), NOW())
    `
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:45',message:'after INSERT new session',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    return { sessionToken, expiresAt }
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:49',message:'createVerifiedSession error',data:{error:err.message,errorCode:err.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    throw err
  }
}

/**
 * Set session cookie (httpOnly for security)
 */
export async function setSessionCookie(sessionToken, expiresAt) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:46',message:'setSessionCookie entry',data:{hasToken:!!sessionToken,expiresAt:expiresAt?.toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    const cookieStore = await cookies()
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:50',message:'cookies() called successfully',data:{cookieStoreType:typeof cookieStore,hasSet:typeof cookieStore?.set},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/'
    })
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:59',message:'cookie set successfully',data:{cookieName:SESSION_COOKIE_NAME},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:62',message:'cookie set error',data:{error:err.message,errorType:err.constructor.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    throw err
  }
}

/**
 * Get session token from cookie
 */
export async function getSessionToken() {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:65',message:'getSessionToken entry',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  try {
    const cookieStore = await cookies()
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:69',message:'cookies() retrieved',data:{hasCookieStore:!!cookieStore},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value || null
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:72',message:'getSessionToken exit',data:{hasToken:!!token,tokenLength:token?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return token
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:75',message:'getSessionToken error',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return null
  }
}

/**
 * Verify if session is valid
 */
export async function verifySession(sessionToken, phoneNumber) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:88',message:'verifySession entry',data:{hasToken:!!sessionToken,hasPhone:!!phoneNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  if (!sessionToken || !phoneNumber) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:91',message:'verifySession early return - missing params',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    return { valid: false }
  }

  try {
    const prisma = await getPrisma()
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:97',message:'before session query',data:{phoneNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    const session = await prisma.$queryRaw`
      SELECT id, phone_number, session_token, expires_at
      FROM verified_phone_sessions
      WHERE session_token = ${sessionToken}
        AND phone_number = ${phoneNumber}
        AND expires_at > NOW()
      LIMIT 1
    `
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:107',message:'after session query',data:{sessionFound:!!session,sessionLength:session?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion

    if (!session || session.length === 0) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:111',message:'verifySession - no session found',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      return { valid: false }
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:116',message:'verifySession - valid session',data:{sessionId:session[0]?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    return { valid: true, session: session[0] }
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'phone-verification-session.js:120',message:'verifySession error',data:{error:err.message,errorCode:err.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
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

