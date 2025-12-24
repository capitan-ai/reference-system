#!/usr/bin/env node
// Test Apple Wallet pass endpoint
// Usage: node scripts/test-wallet-endpoint.js [gan] [baseUrl]

require('dotenv').config()

const gan = process.argv[2] || '2A47E49DFEAC4394'
const baseUrl = process.argv[3] || process.env.APP_BASE_URL || 'https://zorinastudio-referral.com'

console.log('🧪 Testing Apple Wallet Pass Endpoint')
console.log('='.repeat(60))
console.log(`   GAN: ${gan}`)
console.log(`   URL: ${baseUrl}/api/wallet/pass/${gan}`)
console.log('')

// Check environment variables
console.log('📋 Environment Variables Check:')
console.log(`   APP_BASE_URL: ${process.env.APP_BASE_URL || '❌ Not set'}`)
console.log(`   APPLE_PASS_TYPE_ID: ${process.env.APPLE_PASS_TYPE_ID || '❌ Not set'}`)
console.log(`   APPLE_PASS_TEAM_ID: ${process.env.APPLE_PASS_TEAM_ID || '❌ Not set'}`)
console.log('')
console.log('   Certificate Configuration:')
console.log(`   APPLE_PASS_CERTIFICATE_PEM_BASE64: ${process.env.APPLE_PASS_CERTIFICATE_PEM_BASE64 ? '✅ Set (PEM format)' : '❌ Not set'}`)
console.log(`   APPLE_PASS_KEY_PEM_BASE64: ${process.env.APPLE_PASS_KEY_PEM_BASE64 ? '✅ Set (PEM format)' : '❌ Not set'}`)
console.log(`   APPLE_PASS_CERTIFICATE_BASE64: ${process.env.APPLE_PASS_CERTIFICATE_BASE64 ? '✅ Set (Legacy .p12)' : '❌ Not set'}`)
console.log(`   APPLE_WWDR_CERTIFICATE_BASE64: ${process.env.APPLE_WWDR_CERTIFICATE_BASE64 ? '✅ Set' : '❌ Not set'}`)
console.log(`   APPLE_PASS_CERTIFICATE_PASSWORD: ${process.env.APPLE_PASS_CERTIFICATE_PASSWORD ? '✅ Set' : '⚠️ Optional'}`)
console.log('')

// Test endpoint
const testUrl = `${baseUrl}/api/wallet/pass/${gan}`
console.log(`🌐 Testing endpoint: ${testUrl}`)
console.log('')

fetch(testUrl, {
  method: 'GET',
  headers: {
    'Accept': 'application/vnd.apple.pkpass, application/json'
  }
})
  .then(async (response) => {
    console.log(`📊 Response Status: ${response.status} ${response.statusText}`)
    console.log(`📋 Content-Type: ${response.headers.get('content-type') || 'N/A'}`)
    console.log('')

    if (response.status === 404) {
      console.error('❌ 404 Not Found - Endpoint does not exist')
      console.error('   Possible causes:')
      console.error('   1. Route file not deployed')
      console.error('   2. Wrong URL path')
      console.error('   3. Next.js routing issue')
    } else if (response.status === 500) {
      const errorText = await response.text()
      console.error('❌ 500 Server Error')
      console.error('   Response:', errorText.substring(0, 500))
      console.error('')
      console.error('   Possible causes:')
      console.error('   1. Certificates not configured in Vercel')
      console.error('   2. Certificate files not found')
      console.error('   3. Error in pass generation code')
    } else if (response.ok) {
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/vnd.apple.pkpass')) {
        console.log('✅ Success! Pass file generated')
        const buffer = await response.arrayBuffer()
        console.log(`   File size: ${buffer.byteLength} bytes`)
        console.log('')
        console.log('📱 To test:')
        console.log(`   1. Save response as .pkpass file`)
        console.log(`   2. Open on Mac or send to iPhone`)
      } else {
        const text = await response.text()
        console.log('⚠️ Unexpected response type')
        console.log('   Response:', text.substring(0, 200))
      }
    } else {
      console.error(`❌ Error: ${response.status}`)
      const text = await response.text()
      console.error('   Response:', text.substring(0, 500))
    }
  })
  .catch((error) => {
    console.error('❌ Network Error:', error.message)
    console.error('')
    console.error('   Possible causes:')
    console.error('   1. URL is incorrect')
    console.error('   2. Server is not accessible')
    console.error('   3. Network connectivity issue')
  })

