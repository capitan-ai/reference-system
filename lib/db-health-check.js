/**
 * Database health check utility
 * Helps diagnose database connection issues
 */

const prisma = require('./prisma-client')

/**
 * Check if database is reachable
 * @returns {Promise<{healthy: boolean, error?: string, details?: any}>}
 */
async function checkDatabaseHealth() {
  try {
    // Simple query to test connectivity
    const result = await prisma.$queryRaw`SELECT 1 as health_check`
    
    if (result && result.length > 0) {
      return {
        healthy: true,
        details: {
          message: 'Database connection successful',
          timestamp: new Date().toISOString()
        }
      }
    }
    
    return {
      healthy: false,
      error: 'Database query returned no results'
    }
  } catch (error) {
    const errorCode = error.code || 'UNKNOWN'
    const errorMessage = error.message || 'Unknown error'
    
    // Provide helpful error messages based on error code
    let helpfulMessage = errorMessage
    
    if (errorCode === 'P1001') {
      helpfulMessage = `Database server unreachable. This usually means:
1. Database is paused (Supabase free tier pauses after inactivity)
2. Database is being restored (can take up to 5 minutes)
3. Network connectivity issues
4. Incorrect DATABASE_URL

Check your Supabase dashboard to see if services are healthy.`
    } else if (errorCode === 'P1000') {
      helpfulMessage = `Database authentication failed. Check your DATABASE_URL credentials.`
    } else if (errorCode === 'P1017') {
      helpfulMessage = `Database server closed the connection. This may indicate:
1. Database is paused or being restored
2. Connection timeout
3. Too many connections`
    }
    
    return {
      healthy: false,
      error: helpfulMessage,
      details: {
        code: errorCode,
        originalMessage: errorMessage,
        timestamp: new Date().toISOString()
      }
    }
  }
}

/**
 * Check database with retry logic
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} retryDelayMs - Delay between retries in milliseconds
 * @returns {Promise<{healthy: boolean, attempts: number, error?: string, details?: any}>}
 */
async function checkDatabaseHealthWithRetry(maxRetries = 3, retryDelayMs = 2000) {
  let lastError = null
  let attempts = 0
  
  for (let i = 0; i < maxRetries; i++) {
    attempts++
    const result = await checkDatabaseHealth()
    
    if (result.healthy) {
      return {
        ...result,
        attempts
      }
    }
    
    lastError = result
    
    // Wait before retrying (except on last attempt)
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
    }
  }
  
  return {
    healthy: false,
    attempts,
    error: lastError?.error || 'Database health check failed after retries',
    details: lastError?.details
  }
}

module.exports = {
  checkDatabaseHealth,
  checkDatabaseHealthWithRetry
}

