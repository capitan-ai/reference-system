#!/usr/bin/env node
require('dotenv').config()
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

async function test() {
  console.log('🧪 Testing SendGrid email integration...')
  console.log('')
  
  // Check environment variables
  if (!process.env.SENDGRID_API_KEY) {
    console.error('❌ SENDGRID_API_KEY not found in environment variables')
    console.log('   Please add SENDGRID_API_KEY to your .env file or Vercel environment variables')
    process.exit(1)
  }
  
  if (!process.env.FROM_EMAIL) {
    console.warn('⚠️ FROM_EMAIL not found, will use default: info@studiozorina.com')
  }
  
  // Get test email from command line or use default
  const testEmail = process.argv[2] || process.env.TEST_EMAIL || 'your-email@example.com'
  
  if (testEmail === 'your-email@example.com') {
    console.log('📧 Usage: node scripts/test-sendgrid.js your-email@example.com')
    console.log('   Or set TEST_EMAIL in .env file')
    console.log('')
  }
  
  console.log(`📤 Sending test email to: ${testEmail}`)
  console.log(`📧 From: ${process.env.FROM_EMAIL || 'info@studiozorina.com'}`)
  console.log('')
  
  const result = await sendReferralCodeEmail(
    'Test Customer',
    testEmail,
    'TEST_CODE_123',
    'https://zorinastudio-referral.com/ref/TEST_CODE_123'
  )
  
  console.log('')
  console.log('📊 Result:')
  console.log(JSON.stringify(result, null, 2))
  
  if (result.success && !result.skipped) {
    console.log('')
    console.log('✅ Email sent successfully!')
    console.log('   Check your inbox (and spam folder)')
  } else if (result.skipped) {
    console.log('')
    console.log('⏸️ Email sending was skipped')
    console.log(`   Reason: ${result.reason || 'disabled'}`)
  } else {
    console.log('')
    console.log('❌ Failed to send email')
    if (result.error) {
      console.log(`   Error: ${result.error}`)
    }
    process.exit(1)
  }
}

test().catch((error) => {
  console.error('💥 Test failed:', error)
  process.exit(1)
})

