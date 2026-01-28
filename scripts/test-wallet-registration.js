#!/usr/bin/env node

/**
 * Test script for Apple Wallet device registration
 * 
 * Usage:
 *   node scripts/test-wallet-registration.js [serialNumber]
 * 
 * Example:
 *   node scripts/test-wallet-registration.js 1234567890123456
 */

const crypto = require('crypto')

// Configuration
const BASE_URL = process.env.APP_BASE_URL || 'https://www.zorinastudio-referral.com'
const PASS_TYPE_ID = process.env.APPLE_PASS_TYPE_ID || 'pass.com.zorinastudio.giftcard'

// Generate auth token (same logic as in pass-generator.js)
function generateAuthToken(serialNumber) {
  const secret = process.env.APPLE_PASS_AUTH_SECRET || process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || 'default-secret'
  return crypto
    .createHmac('sha256', secret)
    .update(serialNumber)
    .digest('hex')
}

async function testRegistration(serialNumber) {
  if (!serialNumber) {
    console.error('❌ Error: Serial number is required')
    console.log('Usage: node scripts/test-wallet-registration.js <serialNumber>')
    process.exit(1)
  }

  // Generate test device library identifier
  const deviceLibraryIdentifier = 'test-device-' + crypto.randomBytes(8).toString('hex')
  const authToken = generateAuthToken(serialNumber)
  
  const registrationUrl = `${BASE_URL}/api/wallet/v1/devices/${deviceLibraryIdentifier}/registrations/${PASS_TYPE_ID}/${serialNumber}`
  
  console.log('🧪 Testing Apple Wallet Registration Endpoint')
  console.log('=' .repeat(60))
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`Pass Type ID: ${PASS_TYPE_ID}`)
  console.log(`Serial Number: ${serialNumber}`)
  console.log(`Device Library ID: ${deviceLibraryIdentifier}`)
  console.log(`Auth Token (preview): ${authToken.substring(0, 10)}...`)
  console.log('=' .repeat(60))
  console.log()

  try {
    // Test POST (registration)
    console.log('📱 Testing POST (Registration)...')
    const postResponse = await fetch(registrationUrl, {
      method: 'POST',
      headers: {
        'Authorization': `ApplePass ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pushToken: 'test-push-token-' + Date.now()
      })
    })

    console.log(`   Status: ${postResponse.status} ${postResponse.statusText}`)
    
    if (postResponse.status === 201) {
      console.log('   ✅ Registration successful!')
    } else {
      const errorText = await postResponse.text()
      console.log(`   ❌ Registration failed: ${errorText}`)
    }
    console.log()

    // Test GET (list registrations for device)
    console.log('📋 Testing GET (List Registrations)...')
    const listUrl = `${BASE_URL}/api/wallet/v1/devices/${deviceLibraryIdentifier}/registrations/${PASS_TYPE_ID}`
    const getResponse = await fetch(listUrl, {
      method: 'GET',
      headers: {
        'Authorization': `ApplePass ${authToken}`
      }
    })

    console.log(`   Status: ${getResponse.status} ${getResponse.statusText}`)
    
    if (getResponse.status === 200) {
      const data = await getResponse.json()
      console.log(`   ✅ Found ${data.length} registration(s):`)
      data.forEach((serial, idx) => {
        console.log(`      ${idx + 1}. ${serial}`)
      })
    } else {
      const errorText = await getResponse.text()
      console.log(`   ❌ Failed: ${errorText}`)
    }
    console.log()

    // Test DELETE (unregistration)
    console.log('🗑️  Testing DELETE (Unregistration)...')
    const deleteResponse = await fetch(registrationUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `ApplePass ${authToken}`
      }
    })

    console.log(`   Status: ${deleteResponse.status} ${deleteResponse.statusText}`)
    
    if (deleteResponse.status === 200) {
      console.log('   ✅ Unregistration successful!')
    } else {
      const errorText = await deleteResponse.text()
      console.log(`   ⚠️  Unregistration response: ${errorText}`)
    }
    console.log()

    // Test with wrong auth token (should fail)
    console.log('🔒 Testing with invalid auth token (should fail)...')
    const invalidResponse = await fetch(registrationUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'ApplePass invalid-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pushToken: 'test-push-token'
      })
    })

    console.log(`   Status: ${invalidResponse.status} ${invalidResponse.statusText}`)
    
    if (invalidResponse.status === 401) {
      console.log('   ✅ Correctly rejected invalid token!')
    } else {
      console.log('   ⚠️  Unexpected response (should be 401 Unauthorized)')
    }
    console.log()

    console.log('✅ All tests completed!')
    console.log()
    console.log('💡 Next steps:')
    console.log('   1. Check Vercel logs for detailed registration logs')
    console.log('   2. Visit /api/wallet/v1/test-registration to see system status')
    console.log('   3. Check device_pass_registrations table in database')

  } catch (error) {
    console.error('❌ Test failed with error:', error.message)
    console.error('   Stack:', error.stack)
    process.exit(1)
  }
}

// Run test
const serialNumber = process.argv[2] || '1234567890123456'
testRegistration(serialNumber)



