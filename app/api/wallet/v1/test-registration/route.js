// Test endpoint to verify registration system is working
import prisma from '@/lib/prisma-client'

export async function GET(request) {
  try {
    const checks = {
      timestamp: new Date().toISOString(),
      checks: {}
    }

    // Check 1: Environment variables
    checks.checks.environment = {
      APPLE_PASS_TYPE_ID: process.env.APPLE_PASS_TYPE_ID || 'NOT SET',
      APP_BASE_URL: process.env.APP_BASE_URL || 'NOT SET',
      APPLE_PASS_AUTH_SECRET: process.env.APPLE_PASS_AUTH_SECRET ? 'SET' : 'NOT SET (using fallback)'
    }

    // Check 2: Database connection
    try {
      const count = await prisma.devicePassRegistration.count()
      checks.checks.database = {
        status: 'ok',
        registeredDevices: count,
        message: 'Database connection successful'
      }
    } catch (dbError) {
      checks.checks.database = {
        status: 'error',
        error: dbError.message,
        message: 'Database connection failed'
      }
    }

    // Check 3: Auth token generation
    try {
      const { generateAuthToken } = require('../../../../../lib/wallet/pass-generator.js')
      const testToken = generateAuthToken('test-serial-123')
      checks.checks.authToken = {
        status: 'ok',
        tokenPreview: testToken.substring(0, 10) + '...',
        message: 'Auth token generation working'
      }
    } catch (authError) {
      checks.checks.authToken = {
        status: 'error',
        error: authError.message,
        message: 'Auth token generation failed'
      }
    }

    // Check 4: Recent registrations
    try {
      const recent = await prisma.devicePassRegistration.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' }
      })
      checks.checks.recentRegistrations = {
        status: 'ok',
        count: recent.length,
        registrations: recent.map(r => ({
          deviceId: r.deviceLibraryIdentifier.substring(0, 10) + '...',
          serialNumber: r.serialNumber,
          hasPushToken: !!r.pushToken,
          createdAt: r.createdAt
        }))
      }
    } catch (recentError) {
      checks.checks.recentRegistrations = {
        status: 'error',
        error: recentError.message
      }
    }

    return new Response(JSON.stringify(checks, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}



