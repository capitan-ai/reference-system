#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const locationsApi = square.locationsApi

async function debugLocationApi() {
  console.log('🔍 Debugging Square Locations API\n')
  console.log('=' .repeat(60))
  
  try {
    // Try listLocations first
    console.log('\n1️⃣ Trying listLocations()...\n')
    const listResponse = await locationsApi.listLocations()
    const locations = listResponse.result?.locations || []
    
    console.log(`   Found ${locations.length} locations:`)
    locations.forEach((loc, idx) => {
      console.log(`\n   ${idx + 1}. ${loc.name || 'Unnamed'}`)
      console.log(`      ID: ${loc.id}`)
      console.log(`      Merchant ID: ${loc.merchant_id || '❌ MISSING'}`)
      console.log(`      Status: ${loc.status || 'N/A'}`)
      console.log(`      Country: ${loc.country || 'N/A'}`)
      console.log(`      Currency: ${loc.currency || 'N/A'}`)
      if (loc.merchant_id) {
        console.log(`      ✅ Has merchant_id: ${loc.merchant_id}`)
      }
    })
    
    // Try retrieveLocation for specific locations
    console.log('\n2️⃣ Trying retrieveLocation() for specific locations...\n')
    const testLocationIds = ['LT4ZHFBQQYB2N', 'LNQKVBTQZN3EZ']
    
    for (const locationId of testLocationIds) {
      console.log(`\n   Testing location: ${locationId}`)
      try {
        const response = await locationsApi.retrieveLocation(locationId)
        const location = response.result?.location
        
        if (location) {
          console.log(`      Name: ${location.name || 'N/A'}`)
          console.log(`      Merchant ID: ${location.merchant_id || '❌ MISSING'}`)
          console.log(`      Status: ${location.status || 'N/A'}`)
          console.log(`      Full response keys: ${Object.keys(location).join(', ')}`)
        } else {
          console.log(`      ❌ Location not found`)
        }
      } catch (error) {
        console.log(`      ❌ Error: ${error.message}`)
        if (error.statusCode) {
          console.log(`         Status: ${error.statusCode}`)
        }
      }
    }
    
    // Check if we can get merchant_id from the merchant API
    console.log('\n3️⃣ Checking if we can get merchant info...\n')
    try {
      const merchantsApi = square.merchantsApi
      const merchantResponse = await merchantsApi.retrieveMerchant('me')
      const merchant = merchantResponse.result?.merchant
      
      if (merchant) {
        console.log(`   ✅ Merchant ID: ${merchant.id || 'N/A'}`)
        console.log(`      Business Name: ${merchant.business_name || 'N/A'}`)
        console.log(`      Country: ${merchant.country || 'N/A'}`)
      }
    } catch (error) {
      console.log(`   ⚠️  Could not get merchant info: ${error.message}`)
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.statusCode) {
      console.error(`   Status code: ${error.statusCode}`)
    }
    if (error.errors) {
      console.error(`   Square errors:`, JSON.stringify(error.errors, null, 2))
    }
  }
}

debugLocationApi()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })



