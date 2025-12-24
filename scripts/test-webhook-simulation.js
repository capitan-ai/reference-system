#!/usr/bin/env node
require('dotenv').config()
const crypto = require('crypto')

// Simulate Square payment webhook
async function simulatePaymentWebhook() {
  console.log('💰 Simulating Square Payment Webhook...')
  
  const webhookUrl = 'https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/api/webhooks/square/payments'
  
  // Test payload (simulating a payment completion)
  const testPayload = {
    merchant_id: 'ML8KQKXKQKXKQ',
    type: 'payment.updated',
    event_id: 'test-event-' + Date.now(),
    created_at: new Date().toISOString(),
    data: {
      type: 'payment',
      id: 'test-payment-' + Date.now(),
      object: {
        payment: {
          id: 'test-payment-' + Date.now(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          amount_money: {
            amount: 5000, // $50.00
            currency: 'USD'
          },
          status: 'COMPLETED',
          source_type: 'CARD',
          customer_id: 'test-customer-id',
          location_id: process.env.SQUARE_LOCATION_ID || 'test-location'
        }
      }
    }
  }

  const payloadString = JSON.stringify(testPayload)
  const signature = crypto
    .createHmac('sha256', process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || 'test-key')
    .update(payloadString)
    .digest('base64')

  const headers = {
    'Content-Type': 'application/json',
    'X-Square-Signature': signature,
    'X-Square-Environment': 'production'
  }

  try {
    console.log('📡 Sending webhook to:', webhookUrl)
    console.log('📦 Payload:', JSON.stringify(testPayload, null, 2))
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: payloadString
    })

    const responseText = await response.text()
    
    console.log(`📊 Response Status: ${response.status}`)
    console.log(`📄 Response Body: ${responseText}`)
    
    if (response.ok) {
      console.log('✅ Webhook simulation successful!')
    } else {
      console.log('❌ Webhook simulation failed')
    }
    
  } catch (error) {
    console.error('💥 Webhook simulation error:', error.message)
  }
}

// Test customer webhook
async function simulateCustomerWebhook() {
  console.log('👤 Simulating Square Customer Webhook...')
  
  const webhookUrl = 'https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/api/webhooks/square/customers'
  
  const testPayload = {
    merchant_id: 'ML8KQKXKQKXKQ',
    type: 'customer.created',
    event_id: 'test-customer-event-' + Date.now(),
    created_at: new Date().toISOString(),
    data: {
      type: 'customer',
      id: 'test-customer-event-' + Date.now(),
      object: {
        customer: {
          id: 'test-customer-' + Date.now(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          given_name: 'Test',
          family_name: 'Customer',
          email_address: 'test@example.com',
          phone_number: '+1234567890',
          custom_attributes: [
            {
              key: 'referral_code',
              value: 'TEST1234'
            }
          ]
        }
      }
    }
  }

  const payloadString = JSON.stringify(testPayload)
  const signature = crypto
    .createHmac('sha256', process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || 'test-key')
    .update(payloadString)
    .digest('base64')

  const headers = {
    'Content-Type': 'application/json',
    'X-Square-Signature': signature,
    'X-Square-Environment': 'production'
  }

  try {
    console.log('📡 Sending customer webhook to:', webhookUrl)
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: payloadString
    })

    const responseText = await response.text()
    
    console.log(`📊 Response Status: ${response.status}`)
    console.log(`📄 Response Body: ${responseText}`)
    
    if (response.ok) {
      console.log('✅ Customer webhook simulation successful!')
    } else {
      console.log('❌ Customer webhook simulation failed')
    }
    
  } catch (error) {
    console.error('💥 Customer webhook simulation error:', error.message)
  }
}

// Main test function
async function runWebhookTests() {
  console.log('🧪 Webhook Testing Suite')
  console.log('=' .repeat(50))
  
  // Test 1: Customer webhook
  await simulateCustomerWebhook()
  console.log('\n' + '=' .repeat(50))
  
  // Test 2: Payment webhook
  await simulatePaymentWebhook()
  console.log('\n' + '=' .repeat(50))
  
  console.log('🎉 Webhook tests completed!')
  console.log('📋 Check your Vercel logs for webhook processing details')
}

// Run the tests
runWebhookTests()
