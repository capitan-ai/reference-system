#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

async function testCustomAttributes() {
  try {
    const environment = Environment.Production
    const squareClient = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
      environment,
    })
    
    console.log('Available APIs:', Object.keys(squareClient))
    
    // Try different ways to access custom attributes
    if (squareClient.customAttributesApi) {
      console.log('✅ customAttributesApi found')
    } else {
      console.log('❌ customAttributesApi not found')
    }
    
    if (squareClient.customAttributes) {
      console.log('✅ customAttributes found')
    } else {
      console.log('❌ customAttributes not found')
    }
    
  } catch (error) {
    console.error('Error:', error.message)
  }
}

testCustomAttributes()


