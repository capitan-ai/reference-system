#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})

const customersApi = squareClient.customersApi
const customAttributesApi = squareClient.customAttributesApi

async function checkCustomAttributes() {
  try {
    const abyCustomerId = 'Y4BV3AGY3NXYCK63PA4ZA2ZJ14'
    
    console.log('🔍 Fetching custom attributes from Square API...')
    console.log('=' .repeat(80))
    console.log(`Customer ID: ${abyCustomerId}`)
    console.log('=' .repeat(80) + '\n')
    
    // Use the custom attributes API
    const response = await customAttributesApi.listCustomerCustomAttributes(abyCustomerId)
    
    // Convert BigInt to string for JSON serialization
    const result = JSON.parse(JSON.stringify(response.result, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ))
    
    console.log('📦 Full response from Square:')
    console.log(JSON.stringify(result, null, 2))
    
    console.log('\n' + '=' .repeat(80))
    console.log('\n🎯 Custom Attributes Summary:')
    
    if (result && result.customAttributes && result.customAttributes.length > 0) {
      console.log(`✅ Found ${result.customAttributes.length} custom attribute(s):`)
      result.customAttributes.forEach(attr => {
        console.log(`  ${attr.key}: ${attr.value}`)
      })
    } else {
      console.log('❌ No custom attributes found')
    }
    
    console.log('\n' + '=' .repeat(80))
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  }
}

checkCustomAttributes()

