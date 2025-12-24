#!/usr/bin/env node
require('dotenv').config()
const fetch = require('node-fetch')

const webhookUrl = 'https://referral-system-salon.vercel.app/api/webhooks/square/referrals'

// Real Aby data from Square
const abyPayload = {
  merchant_id: 'TEST',
  type: 'customer.created',
  event_id: 'aby-real-' + Date.now(),
  created_at: new Date().toISOString(),
  data: {
    type: 'customer',
    id: 'Y4BV3AGY3NXYCK63PA4ZA2ZJ14',
    object: {
      customer: {
        id: 'Y4BV3AGY3NXYCK63PA4ZA2ZJ14',
        givenName: 'Aby',
        familyName: 'Az',
        emailAddress: null,
        phoneNumber: '+17542319108',
        createdAt: '2025-10-31T20:19:37.443Z',
        creationSource: 'THIRD_PARTY',
        updatedAt: '2025-10-31T20:19:37Z',
        version: 0
      }
    }
  }
}

async function addRealAby() {
  try {
    console.log('👤 Adding real Aby to database...')
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(abyPayload)
    })
    
    const result = await response.text()
    
    console.log('📡 Response:', response.status)
    console.log('📦 Body:', result)
    
    if (response.status === 200) {
      console.log('\n✅ Aby should now be in database!')
      console.log('📝 Next: Check database and then simulate booking')
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

addRealAby()

