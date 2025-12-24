#!/usr/bin/env node
require('dotenv').config()
const fetch = require('node-fetch')

const webhookUrl = 'https://referral-system-salon.vercel.app/api/webhooks/square/referrals'

// Simulate a customer.created webhook payload
const testPayload = {
  merchant_id: 'TEST',
  type: 'customer.created',
  event_id: 'test-' + Date.now(),
  created_at: new Date().toISOString(),
  data: {
    type: 'customer',
    id: 'TEST_CUSTOMER_' + Date.now(),
    object: {
      customer: {
        id: 'TEST_CUSTOMER_' + Date.now(),
        givenName: 'Test',
        familyName: 'Customer',
        emailAddress: 'test@example.com',
        phoneNumber: '+15551234567'
      }
    }
  }
}

async function testWebhook() {
  try {
    console.log('🧪 Testing webhook with customer.created payload...')
    console.log('📦 Payload:', JSON.stringify(testPayload, null, 2))
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    })
    
    const result = await response.text()
    
    console.log('\n📡 Response status:', response.status)
    console.log('📦 Response body:', result)
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

testWebhook()

