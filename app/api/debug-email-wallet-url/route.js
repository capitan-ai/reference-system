// Debug endpoint to see the exact wallet URL in email HTML
const { sendGiftCardIssuedEmail } = require('../../../lib/email-service-simple')
const QRCode = require('qrcode')

export async function GET(request) {
  try {
    const gan = request.nextUrl.searchParams.get('gan') || 'TEST123'
    
    // Generate QR code
    const qrDataUri = await QRCode.toDataURL(gan)
    
    // Access the email template directly to see what URL it generates
    const emailService = require('../../../lib/email-service-simple')
    
    // We need to access emailTemplates - let's require the file and extract it
    const fs = require('fs')
    const path = require('path')
    const emailServicePath = path.join(process.cwd(), 'lib/email-service-simple.js')
    const emailServiceCode = fs.readFileSync(emailServicePath, 'utf8')
    
    // Extract the template function code
    const templateMatch = emailServiceCode.match(/emailTemplates\.giftCardDelivery\s*=\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\)/m)
    
    if (!templateMatch) {
      return Response.json({ error: 'Could not extract template' }, { status: 500 })
    }
    
    // Check what baseUrl is in the code
    const baseUrlMatch = templateMatch[1].match(/const baseUrl\s*=\s*['"]([^'"]+)['"]/)
    const baseUrlInCode = baseUrlMatch ? baseUrlMatch[1] : 'NOT FOUND'
    
    // Check for any preview URLs
    const previewUrlMatch = templateMatch[1].match(/referral-system-salon[^'"]*vercel\.app/)
    const previewUrlFound = previewUrlMatch ? previewUrlMatch[0] : null
    
    // Actually generate the template to see what URL it produces
    // We need to eval or require it properly
    const vm = require('vm')
    const context = {
      require: require,
      module: { exports: {} },
      exports: {},
      process: process,
      console: console,
      Buffer: Buffer,
      formatUsd: (amountCents) => {
        if (!Number.isFinite(amountCents)) return '$0.00'
        return `$${(amountCents / 100).toFixed(2)}`
      }
    }
    
    // Execute the email service code to get emailTemplates
    vm.createContext(context)
    vm.runInContext(emailServiceCode, context)
    
    const emailTemplates = context.emailTemplates
    
    if (!emailTemplates || !emailTemplates.giftCardDelivery) {
      return Response.json({
        error: 'Could not access emailTemplates',
        codeAnalysis: {
          baseUrlInCode,
          previewUrlFound,
          templateCodeSnippet: templateMatch[1].substring(0, 500)
        }
      }, { status: 500 })
    }
    
    // Generate the template
    const template = emailTemplates.giftCardDelivery({
      customerName: 'Test',
      giftCardGan: gan,
      amountCents: 1000,
      balanceCents: 1000,
      qrDataUri: qrDataUri,
      activationUrl: null,
      passKitUrl: null,
      isReminder: false
    })
    
    // Extract wallet URL from HTML
    const walletUrlMatches = template.html.match(/href="([^"]*wallet\/pass[^"]*)"/g)
    const walletUrls = walletUrlMatches ? walletUrlMatches.map(m => m.match(/href="([^"]*)"/)[1]) : []
    
    // Check for preview URLs in HTML
    const previewUrlsInHtml = template.html.match(/https?:\/\/referral-system-salon[^"'\s]*/g) || []
    
    return Response.json({
      codeAnalysis: {
        baseUrlInCode,
        previewUrlFound,
        hasPreviewUrl: !!previewUrlFound
      },
      emailHtmlAnalysis: {
        walletUrlsFound: walletUrls,
        previewUrlsInHtml: previewUrlsInHtml,
        htmlSnippet: template.html.substring(
          template.html.indexOf('Add to Apple Wallet'),
          template.html.indexOf('Add to Apple Wallet') + 200
        ) || 'Not found'
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


