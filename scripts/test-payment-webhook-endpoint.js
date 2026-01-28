#!/usr/bin/env node
/**
 * Test payment webhook endpoint to verify it's working
 */

require('dotenv').config()

async function testPaymentWebhook() {
  const webhookUrl = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/square'
  
  console.log('🧪 Testing Payment Webhook Endpoint\n')
  console.log('='.repeat(80))
  console.log(`Webhook URL: ${webhookUrl}\n`)
  
  // Create a mock payment webhook payload (similar to Square's format)
  const mockPaymentWebhook = {
    type: 'payment.created',
    event_id: 'test-event-' + Date.now(),
    created_at: new Date().toISOString(),
    data: {
      type: 'payment',
      id: 'test-payment-webhook',
      object: {
        payment: {
          id: 'test-payment-' + Date.now(),
          status: 'COMPLETED',
          amount_money: {
            amount: 10000, // $100.00
            currency: 'USD'
          },
          order_id: 'P1c1WYwCzcpQQkLaHIiiDTQokLSZY', // Use the real order ID we're investigating
          customer_id: 'VZSEXBFZA5ET0TAGKTKB9MMKJW',
          location_id: 'LNQKVBTQZN3EZ',
          merchant_id: process.env.SQUARE_MERCHANT_ID || 'test-merchant',
          created_at: new Date().toISOString()
        }
      }
    }
  }
  
  console.log('Mock Payment Webhook Payload:')
  console.log(JSON.stringify(mockPaymentWebhook, null, 2))
  console.log()
  
  try {
    console.log('Sending webhook request...\n')
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Square-Signature': 'test-signature' // Mock signature
      },
      body: JSON.stringify(mockPaymentWebhook)
    })
    
    const responseText = await response.text()
    console.log(`Response Status: ${response.status} ${response.statusText}`)
    console.log(`Response Body: ${responseText}`)
    
    if (response.ok) {
      console.log('\n✅ Webhook endpoint responded successfully!')
      console.log('   Check the database to see if payment was saved')
      console.log('   Check debug.log for instrumentation logs')
    } else {
      console.log('\n❌ Webhook endpoint returned error')
      console.log('   This might indicate a problem with the handler')
    }
  } catch (error) {
    console.error('\n❌ Error sending webhook request:')
    console.error(`   ${error.message}`)
    console.error('\n   Possible causes:')
    console.error('   1. Webhook endpoint is not running')
    console.error('   2. Webhook URL is incorrect')
    console.error('   3. Network/firewall issue')
  }
}

testPaymentWebhook()
  .then(() => {
    console.log('\n✅ Test Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test Failed:', error)
    process.exit(1)
  })



