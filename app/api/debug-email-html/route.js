// Debug endpoint to see the exact email HTML being generated
const { sendGiftCardIssuedEmail } = require('../../../lib/email-service-simple')
const QRCode = require('qrcode')

export async function GET(request) {
  try {
    const gan = request.nextUrl.searchParams.get('gan') || 'TEST123'
    
    // Generate QR code
    const qrDataUri = await QRCode.toDataURL(gan)
    
    // We need to access the email template directly
    // Since it's not exported, let's require the file and access it
    const emailServicePath = require.resolve('../../../lib/email-service-simple')
    const emailService = require('../../../lib/email-service-simple')
    
    // Try to get the template by calling the function with a mock
    // Actually, let's just read the file and extract the template function
    const fs = require('fs')
    const emailServiceCode = fs.readFileSync(emailServicePath, 'utf8')
    
    // Extract the giftCardDelivery function
    const templateMatch = emailServiceCode.match(/emailTemplates\.giftCardDelivery\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\s*\}\)/m)
    
    if (!templateMatch) {
      return Response.json({ error: 'Could not extract template' }, { status: 500 })
    }
    
    // Actually, simpler approach - let's just call sendGiftCardIssuedEmail
    // but intercept the HTML before it's sent
    // Or we can create a test that shows what URL would be used
    
    // Let's check what URL is in the code
    const walletUrlMatch = emailServiceCode.match(/const baseUrl\s*=\s*['"]([^'"]+)['"]/)
    const baseUrlInCode = walletUrlMatch ? walletUrlMatch[1] : 'NOT FOUND'
    
    // Also check for any APP_BASE_URL usage
    const appBaseUrlMatch = emailServiceCode.match(/APP_BASE_URL.*wallet|wallet.*APP_BASE_URL/)
    const hasAppBaseUrl = !!appBaseUrlMatch
    
    return Response.json({
      codeAnalysis: {
        baseUrlInCode: baseUrlInCode,
        hasAppBaseUrlUsage: hasAppBaseUrl,
        codeSnippet: emailServiceCode.substring(
          emailServiceCode.indexOf('if (giftCardGan)'),
          emailServiceCode.indexOf('if (giftCardGan)') + 500
        )
      },
      environment: {
        APP_BASE_URL: process.env.APP_BASE_URL || 'NOT SET',
        NODE_ENV: process.env.NODE_ENV
      },
      expectedUrl: `https://www.zorinastudio-referral.com/api/wallet/pass/${gan}`,
      message: 'Check the codeAnalysis to see what URL is hardcoded in the code'
    }, {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return Response.json({
      error: error.message,
      stack: error.stack
    }, {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}


