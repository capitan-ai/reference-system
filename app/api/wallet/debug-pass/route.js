// Debug endpoint to inspect what's in a generated pass
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { resolveGiftCardContext } = require('../../../../lib/wallet/giftcard-context.js')

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const gan = url.searchParams.get('gan')
    
    if (!gan) {
      return new Response(JSON.stringify({
        error: 'GAN parameter required',
        usage: '/api/wallet/debug-pass?gan=1234567890123456'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get Prisma and giftCardsApi
    const { getPrisma, getGiftCardsApi } = require('../../../../lib/wallet/clients.js')
    const prisma = getPrisma()
    const giftCardsApi = getGiftCardsApi()

    console.log(`🔍 Debugging pass generation for GAN: ${gan}`)

    const context = await resolveGiftCardContext({ gan, prisma, giftCardsApi })

    const result = {
      gan: gan,
      resolved: {
        giftCardGan: context.giftCardGan,
        serialNumber: context.serialNumber,
        webServiceUrl: context.webServiceUrl,
        balanceCents: context.balanceCents,
        customerName: context.customerName
      },
      passGeneration: {
        willIncludeWebServiceURL: !!context.webServiceUrl,
        webServiceURL: context.webServiceUrl || 'NOT SET - Registration will NOT work!',
        willIncludeAuthToken: !!context.webServiceUrl
      },
      environment: {
        APP_BASE_URL: process.env.APP_BASE_URL || 'NOT SET',
        APPLE_PASS_TYPE_ID: process.env.APPLE_PASS_TYPE_ID || 'NOT SET',
        computedBaseUrl: process.env.APP_BASE_URL 
          ? process.env.APP_BASE_URL.replace(/\/$/, '')
          : 'https://www.zorinastudio-referral.com'
      },
      registrationEndpoint: {
        url: context.webServiceUrl 
          ? `${context.webServiceUrl}/devices/{deviceId}/registrations/${process.env.APPLE_PASS_TYPE_ID || 'pass.com.zorinastudio.giftcard'}/{serialNumber}`
          : 'NOT AVAILABLE - webServiceUrl is null',
        note: context.webServiceUrl 
          ? 'This is the URL Apple will call to register devices'
          : '⚠️ WARNING: Passes will NOT support push notifications!'
      },
      recommendations: []
    }

    // Add recommendations
    if (!context.webServiceUrl) {
      result.recommendations.push({
        severity: 'critical',
        issue: 'webServiceUrl is null',
        fix: 'Set APP_BASE_URL environment variable in Vercel'
      })
    }

    if (!process.env.APP_BASE_URL) {
      result.recommendations.push({
        severity: 'warning',
        issue: 'APP_BASE_URL not set',
        fix: 'Set APP_BASE_URL in Vercel to your production domain (e.g., https://www.zorinastudio-referral.com)'
      })
    }

    if (!context.webServiceUrl) {
      result.recommendations.push({
        severity: 'critical',
        issue: 'Passes generated without webServiceURL will not register',
        fix: 'Users need to re-add passes to Wallet after fixing webServiceURL configuration'
      })
    }

    return new Response(JSON.stringify(result, null, 2), {
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

