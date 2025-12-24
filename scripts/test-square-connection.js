#!/usr/bin/env node

// Load environment variables
require('dotenv').config()

const { Client, Environment } = require('square')

console.log('🔍 Testing Square API connection...')
console.log('Token:', process.env.SQUARE_ACCESS_TOKEN?.trim().substring(0, 20) + '...')
console.log('Environment:', process.env.SQUARE_ENV?.trim())

// Initialize Square client
const squareEnv = process.env.SQUARE_ENV?.trim()?.toLowerCase()
const environment = squareEnv === 'sandbox' ? Environment.Sandbox : Environment.Production
let accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()

if (!accessToken) {
  console.error('❌ SQUARE_ACCESS_TOKEN is not set')
  process.exit(1)
}

// Remove "Bearer " prefix if present (Square SDK handles this automatically)
if (accessToken.startsWith('Bearer ')) {
  accessToken = accessToken.substring(7)
}

console.log(`🔑 Environment: ${environment === Environment.Production ? 'Production' : 'Sandbox'}`)
console.log(`🔑 Token length: ${accessToken.length} characters`)

const squareClient = new Client({
  accessToken: accessToken,
  environment,
})

const customersApi = squareClient.customersApi

async function testConnection() {
  try {
    console.log('📡 Testing API connection...')
    const response = await customersApi.listCustomers()
    console.log('✅ API connection successful!')
    console.log('📊 Found', response.result.customers?.length || 0, 'customers')
    
    if (response.result.customers && response.result.customers.length > 0) {
      const customer = response.result.customers[0]
      console.log('👤 Sample customer:', {
        id: customer.id,
        name: `${customer.givenName} ${customer.familyName}`,
        email: customer.emailAddress
      })
    }
  } catch (error) {
    console.error('❌ API connection failed:', error.message)
    if (error.errors) {
      console.error('Error details:', error.errors)
    }
  }
}

testConnection()
