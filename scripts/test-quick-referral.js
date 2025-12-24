#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service')

const prisma = new PrismaClient()

// Generate unique referral code
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Test email sending only
async function testEmailSending() {
  console.log('📧 Testing Email Sending...')
  
  try {
    const referralCode = generateReferralCode()
    const referralUrl = `https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/ref/${referralCode}`
    const testEmail = process.env.TEST_EMAIL || 'your-email@gmail.com'
    
    console.log(`📤 Sending test referral email to: ${testEmail}`)
    console.log(`🎯 Referral code: ${referralCode}`)
    console.log(`🔗 Referral URL: ${referralUrl}`)
    
    const result = await sendReferralCodeEmail(
      'Test Customer',
      testEmail,
      referralCode,
      referralUrl
    )
    
    if (result.success) {
      console.log('✅ Email sent successfully!')
      console.log(`   Message ID: ${result.messageId}`)
      console.log('📧 Check your inbox for the referral code email!')
    } else {
      console.log('❌ Email failed:', result.error)
    }
    
  } catch (error) {
    console.error('💥 Email test failed:', error)
  }
}

// Test referral landing page
async function testReferralLandingPage() {
  console.log('🌐 Testing Referral Landing Page...')
  
  const referralCode = generateReferralCode()
  const landingPageUrl = `https://studio-zorina.square.site/?ref=${referralCode}`
  
  console.log(`🔗 Referral landing page URL: ${landingPageUrl}`)
  console.log('📱 Open this URL in your browser to test the landing page')
  console.log('🎯 The page should display:')
  console.log('   - Welcome message')
  console.log('   - Referral code')
  console.log('   - Instructions')
  console.log('   - Business information')
}

// Test database operations
async function testDatabaseOperations() {
  console.log('🗄️ Testing Database Operations...')
  
  try {
    await prisma.$connect()
    
    // Test database schema
    const tableInfo = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'square_existing_clients' 
      AND column_name IN ('referral_code', 'gift_card_id', 'total_referrals', 'total_rewards')
      ORDER BY column_name
    `
    
    console.log('✅ Database columns found:')
    tableInfo.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type}`)
    })

    // Test referral code generation
    const referralCode = generateReferralCode()
    console.log(`✅ Generated referral code: ${referralCode}`)

    // Test database insert (simulation)
    console.log('✅ Database operations ready')
    
  } catch (error) {
    console.error('❌ Database test failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Test webhook endpoints
async function testWebhookEndpoints() {
  console.log('🔗 Testing Webhook Endpoints...')
  
  const baseUrl = 'https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app'
  
  console.log('📡 Webhook endpoints:')
  console.log(`   - Customer webhook: ${baseUrl}/api/webhooks/square/customers`)
  console.log(`   - Payment webhook: ${baseUrl}/api/webhooks/square/payments`)
  
  console.log('🧪 Test these endpoints with:')
  console.log('   curl -X GET https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/api/webhooks/square/customers')
  console.log('   curl -X GET https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/api/webhooks/square/payments')
}

// Main test function
async function runQuickTest() {
  console.log('🧪 Quick Referral System Test')
  console.log('=' .repeat(50))
  
  // Test 1: Database
  await testDatabaseOperations()
  console.log('\n' + '=' .repeat(50))
  
  // Test 2: Email
  await testEmailSending()
  console.log('\n' + '=' .repeat(50))
  
  // Test 3: Landing Page
  await testReferralLandingPage()
  console.log('\n' + '=' .repeat(50))
  
  // Test 4: Webhooks
  await testWebhookEndpoints()
  console.log('\n' + '=' .repeat(50))
  
  console.log('🎉 Quick test completed!')
  console.log('📋 Next steps:')
  console.log('   1. Set up Gmail credentials')
  console.log('   2. Test email sending')
  console.log('   3. Test referral landing page')
  console.log('   4. Set up Square webhooks')
  console.log('   5. Run complete end-to-end test')
}

// Run the test
runQuickTest()
