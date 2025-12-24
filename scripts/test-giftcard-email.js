#!/usr/bin/env node
// Test gift card email with Apple Wallet
// Usage: node scripts/test-giftcard-email.js [email] [gan] [amount] [name]

require('dotenv').config()
const { sendGiftCardIssuedEmail } = require('../lib/email-service-simple')
const QRCode = require('qrcode')

async function testGiftCardEmail() {
  const email = process.argv[2] || 'umit0912@icloud.com'
  const gan = process.argv[3] || 'TEST1234567890'
  const amountCents = parseInt(process.argv[4]) || 1000 // $10.00
  const customerName = process.argv[5] || 'Test Customer'
  
  console.log('🧪 Testing Gift Card Email with Apple Wallet')
  console.log('='.repeat(60))
  console.log(`   To: ${email}`)
  console.log(`   GAN: ${gan}`)
  console.log(`   Amount: $${(amountCents / 100).toFixed(2)}`)
  console.log(`   Customer: ${customerName}`)
  console.log('')
  
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
  console.log('')
  
  // Send gift card email
  console.log('📧 Sending gift card email...')
  const result = await sendGiftCardIssuedEmail(customerName, email, {
    giftCardGan: gan,
    amountCents: amountCents,
    balanceCents: amountCents,
    qrDataUri: qrDataUri,
    activationUrl: null,
    passKitUrl: null,
    isReminder: false
  })
  
  console.log('')
  if (result.success) {
    if (result.skipped) {
      console.log('⏸️ Email sending skipped:', result.reason)
    } else {
      console.log('✅ Gift card email sent successfully!')
      console.log(`   Message ID: ${result.messageId}`)
      console.log('')
      console.log('📱 Check your inbox!')
      console.log(`   The email includes an "Add to Apple Wallet" button`)
      console.log(`   Click it to add the pass to your iPhone Wallet`)
    }
  } else {
    console.error('❌ Failed to send email:', result.error)
  }
  
  console.log('')
  console.log('📋 Email Details:')
  console.log(`   Subject: 🎁 $${(amountCents / 100).toFixed(2)} gift card from Zorina Nail Studio`)
  console.log(`   Includes: QR code, GAN, Apple Wallet button`)
  console.log(`   Wallet URL: ${walletUrl}`)
}

testGiftCardEmail().catch(console.error)

