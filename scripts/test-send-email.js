#!/usr/bin/env node
require('dotenv').config()
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

async function testSendEmail() {
  try {
    console.log('📧 Sending test email to umit0912@icloud.com...\n')
    
    const testCustomerName = 'Umi'
    const testReferralCode = 'UMI4214'
    const testReferralUrl = 'https://referral-system-salon.vercel.app/ref/UMI4214'
    
    console.log('Test Data:')
    console.log(`  Name: ${testCustomerName}`)
    console.log(`  Code: ${testReferralCode}`)
    console.log(`  URL: ${testReferralUrl}`)
    console.log(`  Email: umit0912@icloud.com\n`)
    
    const result = await sendReferralCodeEmail(
      testCustomerName,
      'umit0912@icloud.com',
      testReferralCode,
      testReferralUrl
    )
    
    if (result.success) {
      console.log('✅ Test email sent successfully!')
      console.log(`   Message ID: ${result.messageId}`)
      console.log('\n📬 Check your inbox at umit0912@icloud.com')
    } else {
      console.log('❌ Failed to send email:', result.error)
    }
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

testSendEmail()
