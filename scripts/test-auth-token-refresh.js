#!/usr/bin/env node
/**
 * Test Supabase Auth token refresh endpoint
 * Usage: node scripts/test-auth-token-refresh.js [refresh_token]
 */

require('dotenv').config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const refreshToken = process.argv[2] || process.env.SUPABASE_REFRESH_TOKEN

if (!supabaseUrl) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL is not set')
  process.exit(1)
}

if (!anonKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
  process.exit(1)
}

if (!refreshToken) {
  console.error('❌ Refresh token is required')
  console.error('   Usage: node scripts/test-auth-token-refresh.js <refresh_token>')
  console.error('   Or set SUPABASE_REFRESH_TOKEN environment variable')
  process.exit(1)
}

// Verify URL format
if (supabaseUrl.includes('db.')) {
  console.error('❌ ERROR: NEXT_PUBLIC_SUPABASE_URL should NOT include "db." prefix!')
  console.error(`   Current: ${supabaseUrl}`)
  console.error(`   Should be: ${supabaseUrl.replace('db.', '')}`)
  process.exit(1)
}

async function testTokenRefresh() {
  const url = `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`
  
  console.log('🔍 Testing Supabase Auth Token Refresh\n')
  console.log('='.repeat(60))
  console.log(`📡 URL: ${url}`)
  console.log(`🔑 Anon Key: ${anonKey.substring(0, 20)}...`)
  console.log(`🔄 Refresh Token: ${refreshToken.substring(0, 20)}...\n`)
  
  try {
    const startTime = Date.now()
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refresh_token: refreshToken
      })
    })
    
    const duration = Date.now() - startTime
    const responseText = await response.text()
    
    console.log(`⏱️  Response time: ${duration}ms`)
    console.log(`📊 Status: ${response.status} ${response.statusText}\n`)
    
    // Print response headers
    console.log('📋 Response Headers:')
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().includes('sb-') || key.toLowerCase().includes('cf-')) {
        console.log(`   ${key}: ${value}`)
      }
    })
    console.log()
    
    // Try to parse JSON response
    let responseData
    try {
      responseData = JSON.parse(responseText)
    } catch (e) {
      responseData = responseText
    }
    
    if (response.ok) {
      console.log('✅ Token refresh successful!')
      if (typeof responseData === 'object') {
        console.log('📦 Response data:')
        console.log(JSON.stringify(responseData, null, 2))
      } else {
        console.log('📦 Response:', responseData)
      }
      process.exit(0)
    } else {
      console.error('❌ Token refresh failed!')
      if (typeof responseData === 'object') {
        console.error('📦 Error details:')
        console.error(JSON.stringify(responseData, null, 2))
      } else {
        console.error('📦 Error:', responseData)
      }
      
      // Provide helpful error messages
      if (response.status === 401) {
        console.error('\n💡 This usually means:')
        console.error('   • Refresh token is invalid or expired')
        console.error('   • Anon key is incorrect')
        console.error('   • Token was revoked')
      } else if (response.status === 522) {
        console.error('\n💡 522 error means:')
        console.error('   • Supabase Auth service is down or timing out')
        console.error('   • Check Supabase dashboard for service status')
      } else if (response.status === 400) {
        console.error('\n💡 400 error usually means:')
        console.error('   • Invalid request format')
        console.error('   • Missing required fields')
      }
      
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message)
    if (error.message.includes('fetch')) {
      console.error('\n💡 Network error - check:')
      console.error('   • Internet connectivity')
      console.error('   • Supabase URL is correct')
      console.error('   • Firewall/proxy settings')
    }
    process.exit(1)
  }
}

testTokenRefresh()

