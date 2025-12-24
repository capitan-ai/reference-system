#!/usr/bin/env node

// Load environment variables
require('dotenv').config()

console.log('🚀 Starting debug test...')

const { Client, Environment } = require('square')

console.log('📡 Initializing Square client...')

// Initialize Square client
const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})

const customersApi = squareClient.customersApi

console.log('✅ Square client initialized')

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
    
    console.log('🎉 Test completed successfully!')
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    if (error.errors) {
      console.error('Error details:', error.errors)
    }
  }
}

testConnection()
