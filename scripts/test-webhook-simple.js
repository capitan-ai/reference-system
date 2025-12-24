#!/usr/bin/env node
require('dotenv').config()
const crypto = require('crypto')

// Test webhook signature verification
function verifySquareSignature(payload, signature, webhookSecret) {
  const hmac = crypto.createHmac('sha256', webhookSecret)
  hmac.update(payload)
  const expectedSignature = hmac.digest('base64')
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )
}

// Simulate a Square customer.created webhook payload
const testPayload = {
  merchant_id: 'MLJSE2F6EE60D',
  type: 'customer.created',
  event_id: 'test-event-123',
  created_at: new Date().toISOString(),
  data: {
    type: 'customer',
    id: 'test-customer-123',
    object: {
      customer: {
        id: 'TEST_CUSTOMER_ID_123',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        given_name: 'Test',
        family_name: 'Customer',
        email_address: 'test@example.com',
        phone_number: '+1234567890'
      }
    }
  }
}

async function testWebhook() {
  console.log('🧪 Testing Square webhook handler...')
  
  const payload = JSON.stringify(testPayload)
  const webhookSecret = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  
  // Generate signature
  const hmac = crypto.createHmac('sha256', webhookSecret)
  hmac.update(payload)
  const signature = hmac.digest('base64')
  
  console.log('📡 Test payload:', JSON.stringify(testPayload, null, 2))
  console.log('🔑 Generated signature:', signature)
  
  // Test signature verification
  const isValid = verifySquareSignature(payload, signature, webhookSecret)
  console.log('✅ Signature verification:', isValid ? 'PASSED' : 'FAILED')
  
  // Test webhook endpoint
  const webhookUrl = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/square/customers'
  
  try {
    console.log(`📡 Sending test webhook to: ${webhookUrl}`)
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-square-signature': signature
      },
      body: payload
    })
    
    const responseText = await response.text()
    console.log(`📊 Response status: ${response.status}`)
    console.log('📋 Response body:', responseText)
    
    if (response.ok) {
      console.log('✅ Webhook test successful!')
    } else {
      console.log('❌ Webhook test failed!')
    }
    
  } catch (error) {
    console.error('💥 Error testing webhook:', error.message)
    console.log('💡 Make sure your webhook endpoint is running locally or deployed')
  }
}

testWebhook()
