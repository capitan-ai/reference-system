const { sendGiftCardIssuedEmail } = require('../../../lib/email-service-simple')
const QRCode = require('qrcode')

export async function GET(request) {
  try {
    const email = request.nextUrl.searchParams.get('email') || 'umit0912@icloud.com'
    const gan = request.nextUrl.searchParams.get('gan') || 'TEST1234567890'
    const amountCents = parseInt(request.nextUrl.searchParams.get('amount')) || 1000 // $10.00
    const customerName = request.nextUrl.searchParams.get('name') || 'Test Customer'
    
    console.log('🧪 Testing gift card email with Apple Wallet...')
    console.log(`   To: ${email}`)
    console.log(`   GAN: ${gan}`)
    console.log(`   Amount: $${(amountCents / 100).toFixed(2)}`)
    
    // Generate QR code
    let qrDataUri = null
    try {
      qrDataUri = await QRCode.toDataURL(gan)
      console.log('✅ QR code generated')
    } catch (qrError) {
      console.warn('⚠️ Could not generate QR code:', qrError.message)
    }
    
    // Build Apple Wallet URL
    const baseUrl = process.env.APP_BASE_URL || 'https://www.zorinastudio-referral.com'
    const walletUrl = `${baseUrl.replace(/\/$/, '')}/api/wallet/pass/${gan}`
    
    console.log(`   Apple Wallet URL: ${walletUrl}`)
    
    // Send gift card email
    const result = await sendGiftCardIssuedEmail(customerName, email, {
      giftCardGan: gan,
      amountCents: amountCents,
      balanceCents: amountCents,
      qrDataUri: qrDataUri,
      activationUrl: null,
      passKitUrl: null, // We'll use our custom wallet URL instead
      isReminder: false
    })
    
    return Response.json({
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      skipped: result.skipped,
      reason: result.reason,
      details: {
        email: email,
        gan: gan,
        amount: `$${(amountCents / 100).toFixed(2)}`,
        customerName: customerName,
        appleWalletUrl: walletUrl,
        qrCodeGenerated: !!qrDataUri
      },
      environment: {
        hasApiKey: !!process.env.SENDGRID_API_KEY,
        hasFromEmail: !!process.env.FROM_EMAIL,
        fromEmail: process.env.FROM_EMAIL || 'info@studiozorina.com (default)',
        appBaseUrl: baseUrl
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

