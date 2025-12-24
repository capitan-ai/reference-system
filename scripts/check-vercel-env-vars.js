#!/usr/bin/env node
// Check which environment variables are available via API endpoints
// This helps diagnose what's configured in Vercel

require('dotenv').config()

console.log('🔍 Checking Environment Variables')
console.log('='.repeat(60))
console.log('')

// Test endpoint to see what variables are available
const testUrl = process.argv[2] || 'https://www.zorinastudio-referral.com'

console.log(`Testing: ${testUrl}`)
console.log('')

// Check via health endpoint (if it exposes env status)
async function checkViaHealthEndpoint() {
  try {
    const response = await fetch(`${testUrl}/api/health`)
    if (response.ok) {
      const data = await response.json()
      console.log('📊 Health Endpoint Response:')
      if (data.checks && data.checks.environment) {
        console.log('   Environment validation:', data.checks.environment)
      }
    }
  } catch (error) {
    console.log('   Health endpoint not available or error:', error.message)
  }
}

// Check via test-apple-env endpoint (if it exists)
async function checkAppleEnv() {
  try {
    const response = await fetch(`${testUrl}/api/test-apple-env`)
    if (response.ok) {
      const data = await response.json()
      console.log('🍎 Apple Wallet Environment Check:')
      console.log(JSON.stringify(data, null, 2))
    }
  } catch (error) {
    console.log('   Apple env test endpoint not available')
  }
}

// Check local environment variables
console.log('📋 Local Environment Variables (from .env):')
console.log('   (These are only for local development)')
console.log(`   APPLE_PASS_TYPE_ID: ${process.env.APPLE_PASS_TYPE_ID ? '✅ Set' : '❌ Not set'}`)
console.log(`   APPLE_PASS_TEAM_ID: ${process.env.APPLE_PASS_TEAM_ID ? '✅ Set' : '❌ Not set'}`)
console.log(`   SENDGRID_API_KEY: ${process.env.SENDGRID_API_KEY ? '✅ Set' : '❌ Not set'}`)
console.log(`   FROM_EMAIL: ${process.env.FROM_EMAIL || '❌ Not set'}`)
console.log('')
console.log('⚠️  Note: Vercel environment variables are NOT visible locally')
console.log('   They are only available in Vercel runtime')
console.log('')

// Test wallet endpoint to see actual error
console.log('🧪 Testing Wallet Endpoint (to see actual error):')
console.log('')

async function testWalletEndpoint() {
  try {
    const response = await fetch(`${testUrl}/api/wallet/pass/TEST123`)
    const text = await response.text()
    
    console.log(`   Status: ${response.status}`)
    
    if (response.status === 500) {
      try {
        const error = JSON.parse(text)
        console.log(`   Error: ${error.message || error.error}`)
        if (error.details) {
          console.log(`   Details: ${error.details.substring(0, 200)}`)
        }
      } catch (e) {
        console.log(`   Response: ${text.substring(0, 200)}`)
      }
    } else if (response.ok) {
      console.log('   ✅ Endpoint working!')
    }
  } catch (error) {
    console.log(`   ❌ Network error: ${error.message}`)
  }
}

async function main() {
  await checkViaHealthEndpoint()
  console.log('')
  await checkAppleEnv()
  console.log('')
  await testWalletEndpoint()
  console.log('')
  console.log('💡 To check Vercel variables:')
  console.log('   1. Go to Vercel Dashboard → Your Project')
  console.log('   2. Settings → Environment Variables')
  console.log('   3. Check Production environment')
  console.log('')
  console.log('💡 To see runtime variables:')
  console.log('   1. Go to Vercel Dashboard → Deployments')
  console.log('   2. Click latest deployment → Functions')
  console.log('   3. Click on a function → View logs')
  console.log('   4. Look for console.log output showing variables')
}

main()

