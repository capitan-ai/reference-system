#!/usr/bin/env node

/**
 * Send a test referral code email to check the emoji placement
 */

require('dotenv').config()
const { sendReferralCodeEmail } = require('../lib/email-service-simple')
const { generateReferralUrl } = require('../lib/utils/referral-url')

async function sendTestEmail() {
  const testEmail = process.env.TEST_EMAIL || process.argv[2]
  
  if (!testEmail) {
    console.error('❌ Please provide an email address')
    console.log('\nUsage:')
    console.log('   node scripts/test-referral-email.js your-email@example.com')
    console.log('\nOr set TEST_EMAIL environment variable:')
    console.log('   TEST_EMAIL=your-email@example.com node scripts/test-referral-email.js')
    process.exit(1)
  }
  
  console.log('📧 Sending test referral code email...')
  console.log(`   To: ${testEmail}`)
  console.log('')
  
  // Test data
  const customerName = 'Test Customer'
  const referralCode = 'TEST1234'
  const referralUrl = generateReferralUrl(referralCode)
  
  console.log('📋 Email Details:')
  console.log(`   Customer Name: ${customerName}`)
  console.log(`   Referral Code: ${referralCode}`)
  console.log(`   Referral URL: ${referralUrl}`)
  console.log('')
  
  try {
    const result = await sendReferralCodeEmail(
      customerName,
      testEmail,
      referralCode,
      referralUrl
    )
    
    if (result.success) {
      if (result.skipped) {
        console.log('⏭️  Email sending is disabled or not configured')
        console.log(`   Reason: ${result.reason || 'email disabled'}`)
      } else {
        console.log('✅ Test email sent successfully!')
        console.log(`   Message ID: ${result.messageId || 'sent'}`)
        console.log('')
        console.log('📬 Check your inbox (and spam folder) for the email')
        console.log('   Look for the new emoji placement:')
        console.log('   - 🥰💅🏼 in the referral information section')
        console.log('   - 🤍 in the thank you messages')
      }
    } else {
      console.log('❌ Failed to send test email')
      console.log(`   Error: ${result.error}`)
    }
  } catch (error) {
    console.error('❌ Error sending test email:', error.message)
    console.error(error.stack)
  }
}

sendTestEmail()

