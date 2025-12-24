#!/usr/bin/env node

// Check Vercel domain configuration
require('dotenv').config()

console.log('🔍 Checking Vercel Domain Configuration')
console.log('='.repeat(60))
console.log('')

// Check environment variables
console.log('📋 Environment Variables:')
console.log(`   NEXT_PUBLIC_APP_URL: ${process.env.NEXT_PUBLIC_APP_URL || '❌ Not set'}`)
console.log(`   APP_BASE_URL: ${process.env.APP_BASE_URL || '❌ Not set'}`)
console.log(`   VERCEL_URL: ${process.env.VERCEL_URL || '❌ Not set'}`)
console.log('')

// Show what URL will be used
const { getReferralBaseUrl, generateReferralUrl } = require('../lib/utils/referral-url')
const baseUrl = getReferralBaseUrl()
const sampleUrl = generateReferralUrl('TEST1234')

console.log('🌐 Current Configuration:')
console.log(`   Base URL: ${baseUrl}`)
console.log(`   Sample Referral URL: ${sampleUrl}`)
console.log('')

// Expected custom domain
const expectedDomain = 'zorinastudio-referral.com'
const expectedUrl = `https://${expectedDomain}`

console.log('✅ Expected Configuration:')
console.log(`   Custom Domain: ${expectedDomain}`)
console.log(`   Expected Base URL: ${expectedUrl}`)
console.log(`   Expected Referral URL: ${expectedUrl}/ref/TEST1234`)
console.log('')

if (baseUrl.includes(expectedDomain)) {
  console.log('✅ Custom domain is configured correctly!')
} else {
  console.log('⚠️  Custom domain is NOT configured')
  console.log('')
  console.log('📝 To fix:')
  console.log('   1. Add to .env.local or Vercel environment variables:')
  console.log(`      NEXT_PUBLIC_APP_URL=${expectedUrl}`)
  console.log('   2. Or use:')
  console.log(`      APP_BASE_URL=${expectedUrl}`)
  console.log('   3. Redeploy to Vercel')
  console.log('   4. Run the update script again to update database URLs')
}

console.log('')
console.log('🔗 Vercel Domain Setup:')
console.log('   1. Go to Vercel Dashboard → Your Project → Settings → Domains')
console.log('   2. Verify that zorinastudio-referral.com is added')
console.log('   3. Check DNS configuration matches Vercel requirements')

