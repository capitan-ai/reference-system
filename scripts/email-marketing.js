#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendBulkEmails } = require('../lib/email-service')

const prisma = new PrismaClient()

async function sendEmailMarketingCampaign() {
  console.log('📧 Starting Email Marketing Campaign...')
  
  try {
    await prisma.$connect()
    
    // Get customers for marketing (those with email addresses)
    const customers = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, email_sent_at
      FROM square_existing_clients 
      WHERE email_address IS NOT NULL 
      AND email_address != ''
      ORDER BY created_at ASC
      LIMIT 50
    `

    console.log(`📊 Found ${customers.length} customers with email addresses`)

    if (customers.length === 0) {
      console.log('❌ No customers with email addresses found')
      return
    }

    // Send marketing emails
    console.log('📤 Sending marketing emails...')
    const results = await sendBulkEmails(customers, 'marketing')

    console.log('\n📊 Email Campaign Results:')
    console.log(`   ✅ Emails sent: ${results.sent}`)
    console.log(`   ❌ Failed: ${results.failed}`)
    
    if (results.errors.length > 0) {
      console.log('\n❌ Errors:')
      results.errors.forEach(error => console.log(`   - ${error}`))
    }

    // Update email sent timestamp
    if (results.sent > 0) {
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET email_sent_at = NOW()
        WHERE email_address IS NOT NULL 
        AND email_address != ''
      `
      console.log('✅ Updated email sent timestamps')
    }

  } catch (error) {
    console.error('💥 Campaign failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

async function sendReferralCodesToAll() {
  console.log('🎁 Sending Referral Codes to All Customers...')
  
  try {
    await prisma.$connect()
    
    // Get customers who haven't received referral codes yet
    const customers = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code
      FROM square_existing_clients 
      WHERE email_address IS NOT NULL 
      AND email_address != ''
      AND activated_as_referrer = TRUE
      AND personal_code IS NOT NULL
      ORDER BY created_at ASC
      LIMIT 50
    `

    console.log(`📊 Found ${customers.length} customers ready for referral codes`)

    if (customers.length === 0) {
      console.log('❌ No customers ready for referral codes')
      return
    }

    // Send referral code emails
    console.log('📤 Sending referral code emails...')
    const results = await sendBulkEmails(customers, 'referral')

    console.log('\n📊 Referral Code Results:')
    console.log(`   ✅ Emails sent: ${results.sent}`)
    console.log(`   ❌ Failed: ${results.failed}`)
    
    if (results.errors.length > 0) {
      console.log('\n❌ Errors:')
      results.errors.forEach(error => console.log(`   - ${error}`))
    }

  } catch (error) {
    console.error('💥 Referral code sending failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

async function testEmailService() {
  console.log('🧪 Testing Email Service...')
  
  try {
    // Test with a single email (use your own email for testing)
    const testEmail = process.env.TEST_EMAIL || 'your-email@gmail.com'
    
    console.log(`📧 Sending test email to: ${testEmail}`)
    
    const { sendReferralCodeEmail } = require('../lib/email-service')
    
    const result = await sendReferralCodeEmail(
      'Test Customer',
      testEmail,
      'TEST1234',
      'https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/ref/TEST1234'
    )
    
    if (result.success) {
      console.log('✅ Test email sent successfully!')
      console.log(`   Message ID: ${result.messageId}`)
    } else {
      console.log('❌ Test email failed:', result.error)
    }
    
  } catch (error) {
    console.error('💥 Test failed:', error)
  }
}

// Main execution
const command = process.argv[2]

switch (command) {
  case 'marketing':
    sendEmailMarketingCampaign()
    break
  case 'referral':
    sendReferralCodesToAll()
    break
  case 'test':
    testEmailService()
    break
  default:
    console.log('📧 Email Marketing Commands:')
    console.log('   node scripts/email-marketing.js test      - Test email service')
    console.log('   node scripts/email-marketing.js marketing - Send marketing emails')
    console.log('   node scripts/email-marketing.js referral  - Send referral codes')
    break
}
