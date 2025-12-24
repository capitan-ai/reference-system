#!/usr/bin/env node
require('dotenv').config()

async function testAbyBooking() {
  try {
    const webhookUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}/api/webhooks/square/referrals`
      : 'https://referral-system-salon-ih61p7wau-umis-projects-e802f152.vercel.app/api/webhooks/square/referrals'
    
    const payload = {
      merchant_id: "MLJSE2F6EE60D",
      location_id: "LT4ZHFBQQYB2N",
      type: "booking.created",
      event_id: "test-aby-booking-" + Date.now(),
      created_at: new Date().toISOString(),
      data: {
        type: "booking",
        id: "test-booking-aby",
        object: {
          booking: {
            customer_id: "Y4BV3AGY3NXYCK63PA4ZA2ZJ14",
            id: "test-booking-aby",
            status: "ACCEPTED",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        }
      }
    }
    
    console.log('🧪 Testing booking.created webhook for Aby...')
    console.log('=' .repeat(80))
    console.log('Webhook URL:', webhookUrl)
    console.log('Customer ID:', payload.data.object.booking.customer_id)
    console.log('=' .repeat(80) + '\n')
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    })
    
    const responseData = await response.text()
    
    console.log('📡 Response status:', response.status)
    console.log('📦 Response body:', responseData)
    
    if (response.status === 200) {
      console.log('\n✅ Webhook processed successfully!')
    } else {
      console.log('\n❌ Webhook failed')
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

testAbyBooking()

