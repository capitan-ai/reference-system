const prisma = require('../../../lib/prisma-client')
const { validateEnvironmentVariables, getValidationStatus } = require('../../../lib/config/env-validator')
const {
  isGiftCardRunAvailable
} = require('../../../lib/runs/giftcard-run-tracker')
const {
  isGiftCardJobAvailable
} = require('../../../lib/workflows/giftcard-job-queue')

/**
 * Health check endpoint
 * GET /api/health
 * Returns system health status including:
 * - Environment variables validation
 * - Database connectivity
 * - Prisma model availability
 */
export async function GET(request) {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {}
    }

    // Check 1: Environment Variables
    const envValidation = validateEnvironmentVariables()
    health.checks.environment = {
      status: envValidation.valid ? 'ok' : 'error',
      valid: envValidation.valid,
      missing: envValidation.missing,
      errors: envValidation.errors,
      details: getValidationStatus()
    }

    if (!envValidation.valid) {
      health.status = 'degraded'
    }

    // Check 2: Database Connectivity
    try {
      await prisma.$queryRaw`SELECT 1`
      health.checks.database = {
        status: 'ok',
        connected: true
      }
    } catch (error) {
      health.checks.database = {
        status: 'error',
        connected: false,
        error: error.message
      }
      health.status = 'unhealthy'
    }

    // Check 3: GiftCardRun Model
    try {
      const giftCardRunAvailable = await isGiftCardRunAvailable(prisma)
      health.checks.giftCardRun = {
        status: giftCardRunAvailable ? 'ok' : 'warning',
        available: giftCardRunAvailable,
        message: giftCardRunAvailable
          ? 'GiftCardRun model is available'
          : 'GiftCardRun model not available - run "npx prisma generate"'
      }
      if (!giftCardRunAvailable) {
        health.status = health.status === 'unhealthy' ? 'unhealthy' : 'degraded'
      }
    } catch (error) {
      health.checks.giftCardRun = {
        status: 'error',
        available: false,
        error: error.message
      }
      health.status = 'unhealthy'
    }

    // Check 4: GiftCardJob Model
    try {
      const giftCardJobAvailable = await isGiftCardJobAvailable(prisma)
      health.checks.giftCardJob = {
        status: giftCardJobAvailable ? 'ok' : 'warning',
        available: giftCardJobAvailable,
        message: giftCardJobAvailable
          ? 'GiftCardJob model is available'
          : 'GiftCardJob model not available - run "npx prisma generate"'
      }
      if (!giftCardJobAvailable) {
        health.status = health.status === 'unhealthy' ? 'unhealthy' : 'degraded'
      }
    } catch (error) {
      health.checks.giftCardJob = {
        status: 'error',
        available: false,
        error: error.message
      }
      health.status = 'unhealthy'
    }

    // Check 5: ProcessedEvent Model (for idempotency)
    try {
      await prisma.processedEvent.findFirst({
        where: { idempotencyKey: '__test_check__' },
        select: { idempotencyKey: true }
      })
      health.checks.processedEvent = {
        status: 'ok',
        available: true,
        message: 'ProcessedEvent model is available'
      }
    } catch (error) {
      health.checks.processedEvent = {
        status: error.code === 'P2021' || error.code === 'P2022' ? 'warning' : 'error',
        available: false,
        error: error.message,
        message: 'ProcessedEvent model not available - idempotency checks may fail'
      }
      if (error.code !== 'P2021' && error.code !== 'P2022') {
        health.status = 'unhealthy'
      }
    }

    // Determine HTTP status code
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503

    return Response.json(health, { status: statusCode })

  } catch (error) {
    return Response.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 503 })
  }
}
