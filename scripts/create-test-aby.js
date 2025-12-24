#!/usr/bin/env node
require('dotenv').config()
const fetch = require('node-fetch')

const webhookUrl = 'https://referral-system-salon.vercel.app/api/webhooks/square/referrals'

// Simulate Aby's customer.created webhook
const abyPayload = {
  merchant_id: 'TEST',
  type: 'customer.created',
  event_id: 'aby-' + Date.now(),
  created_at: new Date().toISOString(),
  data: {
    type: 'customer',
    id: 'ABY_REAL_CUSTOMER_' + Date.now(),
    object: {
      customer: {
        id: 'ABY_REAL_CUSTOMER_' + Date.now(),
        givenName: 'Aby',
        familyName: 'Test',
        emailAddress: 'aby.test@gmail.com',
        phoneNumber: '+17542319108'
      }
    }
  }
}

async function createTestAby() {
  try {
    console.log('👤 Creating test Aby profile...')
    console.log('📦 Payload:', JSON.stringify(abyPayload, null, 2))
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(abyPayload)
    })
    
    const result = await response.text()
    
    console.log('\n📡 Response status:', response.status)
    console.log('📦 Response body:', result)
    
    console.log('\n✅ Test Aby created!')
    console.log('📝 Next: Have Aby create a booking with Umi\'s code: CUST_MHA4LEYB5ERA')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

createTestAby()

