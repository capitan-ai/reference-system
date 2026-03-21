/**
 * Shared cron route authorization helper.
 * Validates CRON_SECRET via Authorization header or x-cron-secret/x-cron-key headers.
 *
 * @param {Request} request
 * @returns {{ authorized: boolean, method?: string, reason?: string }}
 */
export function authorizeCron(request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.warn('⚠️ CRON_SECRET not set - allowing unauthenticated access (development only)')
    return { authorized: true, method: 'no-secret-set' }
  }

  const authHeader = request.headers.get('Authorization') || ''
  const cronHeader = request.headers.get('x-cron-secret') || request.headers.get('x-cron-key') || ''

  if (authHeader === `Bearer ${cronSecret}` || authHeader === cronSecret || cronHeader === cronSecret) {
    return { authorized: true }
  }

  return { authorized: false, reason: 'no-matching-secret' }
}
