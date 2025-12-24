#!/usr/bin/env node
// Debug script to see exactly what URL is in the email HTML

require('dotenv').config()

// Import the email service module
const emailServiceModule = require('../lib/email-service-simple')

// We need to access the emailTemplates object
// Since it's not exported, we'll call sendGiftCardIssuedEmail with a mock
// and capture the HTML, or we can directly test the template generation

// Actually, let's just require the file and access emailTemplates directly
const fs = require('fs')
const path = require('path')
const vm = require('vm')

// Read the email service file
const emailServicePath = path.join(__dirname, '../lib/email-service-simple.js')
const emailServiceCode = fs.readFileSync(emailServicePath, 'utf8')

// Create a context to run the code
const context = {
  require: require,
  module: { exports: {} },
  exports: {},
  process: process,
  console: console,
  Buffer: Buffer,
  __dirname: path.dirname(emailServicePath),
  __filename: emailServicePath
}

// Execute the code
vm.createContext(context)
vm.runInContext(emailServiceCode, context)

// Now access emailTemplates
const emailTemplates = context.emailTemplates || context.module.exports.emailTemplates

if (!emailTemplates || !emailTemplates.giftCardDelivery) {
  console.error('❌ Could not access emailTemplates.giftCardDelivery')
  console.log('Available exports:', Object.keys(context.module.exports))
  process.exit(1)
}

async function testEmailHTML() {
  const QRCode = require('qrcode')
  const qrDataUri = await QRCode.toDataURL('TEST123')
  
  console.log('🧪 Testing Email HTML Generation')
  console.log('='.repeat(60))
  console.log('')
  
  // Generate email template
  const template = emailTemplates.giftCardDelivery({
    customerName: 'Test User',
    giftCardGan: 'TEST123',
    amountCents: 1000,
    balanceCents: 1000,
    qrDataUri: qrDataUri,
    activationUrl: null,
    passKitUrl: null,
    isReminder: false
  })
  
  // Extract wallet URL from HTML
  const walletUrlMatches = template.html.match(/href="([^"]*wallet\/pass[^"]*)"/g)
  
  console.log('📧 Email HTML Analysis')
  console.log('')
  
  if (walletUrlMatches && walletUrlMatches.length > 0) {
    console.log('🔗 Found wallet URLs in HTML:')
    walletUrlMatches.forEach((match, i) => {
      const url = match.match(/href="([^"]*)"/)[1]
      console.log(`   ${i + 1}. ${url}`)
      
      if (url.includes('referral-system-salon') && url.includes('vercel.app')) {
        console.log('      ❌ PROBLEM: Preview URL found!')
      } else if (url.includes('zorinastudio-referral.com')) {
        console.log('      ✅ CORRECT: Production URL')
      } else {
        console.log('      ⚠️  Unexpected format')
      }
    })
  } else {
    console.log('❌ No wallet URLs found in HTML!')
  }
  
  console.log('')
  console.log('📋 Full wallet button HTML:')
  const buttonMatch = template.html.match(/<a[^>]*wallet\/pass[^"]*"[^>]*>.*?<\/a>/s)
  if (buttonMatch) {
    console.log(buttonMatch[0])
  } else {
    console.log('Wallet button not found')
  }
  
  console.log('')
  console.log('🔍 Searching for any preview URLs in entire HTML:')
  const previewUrlMatches = template.html.match(/https:\/\/referral-system-salon[^"'\s]*/g)
  if (previewUrlMatches) {
    console.log('   ❌ Found preview URLs:')
    previewUrlMatches.forEach(url => console.log(`      - ${url}`))
  } else {
    console.log('   ✅ No preview URLs found')
  }
}

testEmailHTML().catch(console.error)

