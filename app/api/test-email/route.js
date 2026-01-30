const { sendReferralCodeEmail } = require('../../../lib/email-service-simple')

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const testEmail = request.nextUrl.searchParams.get('email') || 'test@example.com'
    
    console.log('🧪 Testing email from Vercel...')
    console.log('Environment check:')
    console.log('  SENDGRID_API_KEY:', process.env.SENDGRID_API_KEY ? '✅ Found' : '❌ Missing')
    console.log('  FROM_EMAIL:', process.env.FROM_EMAIL || '⚠️ Using default')
    
    const result = await sendReferralCodeEmail(
      'Test User',
      testEmail,
      'TEST123',
      'https://zorinastudio-referral.com/ref/TEST123'
    )
    
    return Response.json({
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      skipped: result.skipped,
      reason: result.reason,
      environment: {
        hasApiKey: !!process.env.SENDGRID_API_KEY,
        hasFromEmail: !!process.env.FROM_EMAIL,
        fromEmail: process.env.FROM_EMAIL || 'info@studiozorina.com (default)',
        apiKeyLength: process.env.SENDGRID_API_KEY?.length || 0
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    })
  }
}

