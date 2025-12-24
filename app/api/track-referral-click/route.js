const prisma = require('../../../lib/prisma-client')
const crypto = require('crypto')

// Hash IP address for privacy
function hashIP(ip) {
  if (!ip) return null
  return crypto.createHash('sha256').update(ip).digest('hex')
}

// Track referral click
async function trackReferralClick(clickData) {
  try {
    // Get client IP from headers
    const ip = clickData.ip || 'unknown'
    const ipHash = hashIP(ip)

    // Insert click record
    const refClick = await prisma.refClick.create({
      data: {
        refCode: clickData.refCode,
        refSid: clickData.refSid,
        ipHash: ipHash,
        userAgent: clickData.userAgent,
        landingUrl: clickData.landingUrl,
        utmSource: clickData.utmSource,
        utmMedium: clickData.utmMedium,
        utmCampaign: clickData.utmCampaign,
        firstSeenAt: new Date(clickData.firstSeenAt)
      }
    })

    console.log(`✅ Referral click tracked: ${clickData.refCode} (${refClick.id})`)
    return refClick
  } catch (error) {
    console.error('Error tracking referral click:', error)
    throw error
  }
}

export async function POST(request) {
  try {
    const clickData = await request.json()
    
    // Validate required fields
    if (!clickData.refCode) {
      return Response.json({ error: 'Missing referral code' }, { status: 400 })
    }

    // Track the click
    const refClick = await trackReferralClick(clickData)
    
    return Response.json({
      success: true,
      message: 'Referral click tracked',
      clickId: refClick.id,
      refCode: refClick.refCode
    })

  } catch (error) {
    console.error('Referral click tracking error:', error)
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Handle GET requests for testing
export async function GET(request) {
  return Response.json({
    message: 'Referral Click Tracking API',
    status: 'active',
    timestamp: new Date().toISOString()
  })
}
