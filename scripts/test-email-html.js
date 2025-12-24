#!/usr/bin/env node
// Test script to see the actual HTML being generated for gift card emails

require('dotenv').config()
const emailService = require('../lib/email-service-simple')
const QRCode = require('qrcode')

// Access emailTemplates from the module
const emailTemplates = emailService.emailTemplates || {}

async function testEmailHTML() {
  console.log('🧪 Testing Email HTML Generation')
  console.log('='.repeat(60))
  console.log('')
  
  // Generate QR code
  const qrDataUri = await QRCode.toDataURL('TEST123')
  
  // Generate email template - call the function directly
  const template = emailService.emailTemplates?.giftCardDelivery ? 
    emailService.emailTemplates.giftCardDelivery({
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
  const walletUrlMatch = template.html.match(/href="([^"]*wallet\/pass[^"]*)"/)
  const walletUrl = walletUrlMatch ? walletUrlMatch[1] : 'NOT FOUND'
  
  console.log('📧 Email Template Generated')
  console.log('')
  console.log('🔗 Wallet URL in HTML:', walletUrl)
  console.log('')
  
  if (walletUrl.includes('referral-system-salon') && walletUrl.includes('vercel.app')) {
    console.log('❌ PROBLEM: Preview URL found in email HTML!')
    console.log('   This means the code is not using the hardcoded production domain.')
  } else if (walletUrl.includes('zorinastudio-referral.com')) {
    console.log('✅ CORRECT: Production URL found in email HTML!')
  } else {
    console.log('⚠️  Unexpected URL format:', walletUrl)
  }
  
  console.log('')
  console.log('📋 Full HTML snippet (wallet button):')
  const buttonMatch = template.html.match(/<a href="[^"]*wallet\/pass[^"]*"[^>]*>.*?<\/a>/s)
  if (buttonMatch) {
    console.log(buttonMatch[0])
  } else {
    console.log('Wallet button not found in HTML')
  }
}

testEmailHTML().catch(console.error)

