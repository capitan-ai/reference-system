export async function GET(request) {
  try {
    const gan = request.nextUrl.searchParams.get('gan') || 'TEST123'

    const QRCode = require('qrcode')
    const { buildGiftCardEmailPreview } = require('../../../lib/email-service-simple')

    const qrDataUri = await QRCode.toDataURL(gan)
    const template = buildGiftCardEmailPreview({
      customerName: 'Test',
      giftCardGan: gan,
      amountCents: 1000,
      balanceCents: 1000,
      qrDataUri,
      activationUrl: null,
      passKitUrl: null,
      isReminder: false,
    })

    const html = template?.html || ''
    const walletUrlMatches = html.match(/href="([^"]*\/api\/wallet\/pass\/[^"]*)"/g)
    const walletUrls = walletUrlMatches ? walletUrlMatches.map((m) => m.match(/href="([^"]*)"/)[1]) : []
    const previewUrlsInHtml = html.match(/https?:\/\/referral-system-salon[^"'\s]*/g) || []

    return Response.json({
      emailHtmlAnalysis: {
        walletUrlsFound: walletUrls,
        previewUrlsInHtml: previewUrlsInHtml,
        htmlSnippet: html.includes('Add to Apple Wallet')
          ? html.substring(html.indexOf('Add to Apple Wallet'), html.indexOf('Add to Apple Wallet') + 200)
          : 'Not found',
      },
      environment: {
        APP_BASE_URL: process.env.APP_BASE_URL || 'NOT SET',
        NODE_ENV: process.env.NODE_ENV
      }
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

