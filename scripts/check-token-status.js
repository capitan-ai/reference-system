#!/usr/bin/env node

// Load environment variables
require('dotenv').config()

const https = require('https')

// Check which env file is being loaded
const fs = require('fs')
const path = require('path')
const envFiles = ['.env.local', '.env']
let loadedFrom = 'environment variable or system'

for (const envFile of envFiles) {
  const envPath = path.join(process.cwd(), envFile)
  if (fs.existsSync(envPath)) {
    loadedFrom = envFile
    break
  }
}

const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
const squareEnv = process.env.SQUARE_ENV?.trim()

if (!accessToken) {
  console.error('❌ SQUARE_ACCESS_TOKEN is not set')
  console.error(`   Checked env file: ${loadedFrom}`)
  process.exit(1)
}

// Determine base URL based on environment
const baseUrl = squareEnv === 'sandbox' 
  ? 'connect.squareupsandbox.com'
  : 'connect.squareup.com'

console.log('🔍 Checking Square Access Token Status')
console.log('='.repeat(60))
console.log(`📁 Loading from: ${loadedFrom}`)
console.log(`🌍 Environment: ${squareEnv || 'production'}`)
console.log(`🔑 Token (first 30 chars): ${accessToken.substring(0, 30)}...`)
console.log(`🔑 Token (last 10 chars): ...${accessToken.substring(accessToken.length - 10)}`)
console.log(`🔑 Token length: ${accessToken.length} characters`)
console.log(`🌐 Base URL: ${baseUrl}`)
console.log('')

// Make request to check token status
const options = {
  hostname: baseUrl,
  path: '/oauth2/token/status',
  method: 'POST',
  headers: {
    'Square-Version': '2025-10-16',
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
}

console.log('📡 Checking token status...\n')

const req = https.request(options, (res) => {
  let data = ''

  res.on('data', (chunk) => {
    data += chunk
  })

  res.on('end', () => {
    try {
      if (res.statusCode === 200) {
        const result = JSON.parse(data)
        
        console.log('✅ Token Status Retrieved Successfully\n')
        console.log('📋 Token Information:')
        console.log('─'.repeat(60))
        
        if (result.scopes) {
          console.log(`\n🔑 Granted Scopes (${result.scopes.length}):`)
          result.scopes.forEach((scope, index) => {
            console.log(`   ${index + 1}. ${scope}`)
          })
          
          // Debug: Show raw scopes array
          console.log(`\n🔍 Raw Scopes Array:`, JSON.stringify(result.scopes, null, 2))
          
          // Check for required scopes (using correct naming from Square API)
          const requiredScopes = [
            'ORDERS_WRITE',
            'PAYMENTS_WRITE',
            'GIFTCARDS_WRITE', // Note: Square uses GIFTCARDS_WRITE (no underscore)
            'CUSTOMERS_READ',
            'CUSTOMERS_WRITE'
          ]
          
          console.log('\n🔍 Required Scopes Check:')
          console.log('─'.repeat(60))
          requiredScopes.forEach(scope => {
            // Check both exact match and case-insensitive
            const hasScope = result.scopes.includes(scope) || 
                           result.scopes.some(s => s.toUpperCase() === scope.toUpperCase())
            const icon = hasScope ? '✅' : '❌'
            console.log(`   ${icon} ${scope}`)
          })
          
          // Check if all required scopes are present
          const missingScopes = requiredScopes.filter(scope => {
            return !result.scopes.includes(scope) && 
                   !result.scopes.some(s => s.toUpperCase() === scope.toUpperCase())
          })
          
          if (missingScopes.length > 0) {
            console.log(`\n⚠️  Missing Scopes: ${missingScopes.join(', ')}`)
            console.log('   You need to reauthorize your app with these scopes.')
          } else {
            console.log('\n✅ All required scopes are present!')
          }
        }
        
        if (result.expires_at) {
          const expiresAt = new Date(result.expires_at)
          const now = new Date()
          const daysUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24))
          
          console.log(`\n⏰ Token Expiration:`)
          console.log(`   Expires at: ${expiresAt.toISOString()}`)
          console.log(`   Days until expiry: ${daysUntilExpiry}`)
          
          if (daysUntilExpiry < 0) {
            console.log(`   ❌ Token has EXPIRED!`)
          } else if (daysUntilExpiry < 7) {
            console.log(`   ⚠️  Token expires soon (${daysUntilExpiry} days)`)
          } else {
            console.log(`   ✅ Token is valid`)
          }
        }
        
        if (result.client_id) {
          console.log(`\n🆔 Client ID: ${result.client_id}`)
        }
        
        if (result.merchant_id) {
          console.log(`\n🏪 Merchant ID: ${result.merchant_id}`)
        }
        
        console.log('\n' + '='.repeat(60))
        
      } else {
        console.error(`❌ Failed to check token status`)
        console.error(`Status Code: ${res.statusCode}`)
        console.error(`Response: ${data}`)
        
        try {
          const error = JSON.parse(data)
          if (error.errors) {
            console.error('\nSquare API Errors:')
            error.errors.forEach(err => {
              console.error(`   - ${err.code}: ${err.detail}`)
            })
          }
        } catch (e) {
          // Not JSON, just show raw response
        }
      }
    } catch (error) {
      console.error('❌ Error parsing response:', error.message)
      console.error('Raw response:', data)
    }
  })
})

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message)
})

req.end()

