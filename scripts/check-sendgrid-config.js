#!/usr/bin/env node
require('dotenv').config()

console.log('🔍 Checking SendGrid Configuration...')
console.log('')

// Check SENDGRID_API_KEY
const apiKey = process.env.SENDGRID_API_KEY
if (apiKey) {
  console.log('✅ SENDGRID_API_KEY: Found')
  console.log(`   Length: ${apiKey.length} characters`)
  console.log(`   Starts with: ${apiKey.substring(0, 3)}...`)
  if (apiKey.length < 50) {
    console.log('   ⚠️  Warning: API key seems too short')
  }
} else {
  console.log('❌ SENDGRID_API_KEY: NOT FOUND')
  console.log('   Please add SENDGRID_API_KEY to your environment variables')
}

console.log('')

// Check FROM_EMAIL
const fromEmail = process.env.FROM_EMAIL
if (fromEmail) {
  console.log('✅ FROM_EMAIL: Found')
  console.log(`   Value: ${fromEmail}`)
  if (!fromEmail.includes('@')) {
    console.log('   ⚠️  Warning: Email format seems incorrect')
  }
} else {
  console.log('⚠️  FROM_EMAIL: NOT FOUND (will use default: info@studiozorina.com)')
}

console.log('')

// Check optional variables
if (process.env.DISABLE_EMAIL_SENDING === 'true') {
  console.log('⏸️  DISABLE_EMAIL_SENDING: true (email sending is disabled)')
} else {
  console.log('✅ DISABLE_EMAIL_SENDING: false or not set (email sending enabled)')
}

console.log('')

// Test SendGrid initialization
if (apiKey) {
  try {
    const sgMail = require('@sendgrid/mail')
    sgMail.setApiKey(apiKey)
    console.log('✅ SendGrid SDK initialized successfully')
  } catch (error) {
    console.log('❌ Failed to initialize SendGrid SDK:')
    console.log(`   Error: ${error.message}`)
  }
} else {
  console.log('⏭️  Skipping SendGrid SDK test (no API key)')
}

console.log('')
console.log('📋 Summary:')
if (apiKey && fromEmail) {
  console.log('   ✅ Configuration looks good!')
  console.log('   If emails still don\'t work, check:')
  console.log('   1. Domain verification in SendGrid Dashboard')
  console.log('   2. Vercel deployment logs')
  console.log('   3. SendGrid Activity logs')
} else if (apiKey) {
  console.log('   ⚠️  Missing FROM_EMAIL (will use default)')
} else {
  console.log('   ❌ Missing SENDGRID_API_KEY')
  console.log('   Add it to Vercel: Settings → Environment Variables')
}

