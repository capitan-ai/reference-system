#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const customersApi = squareClient.customersApi

// Test custom attributes retrieval
async function testCustomAttributes() {
  console.log('🧪 Testing Custom Attributes Retrieval...')
  
  try {
    await prisma.$connect()
    
    // Get a sample customer from database
    const customer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, personal_code
      FROM square_existing_clients 
      WHERE activated_as_referrer = TRUE 
      LIMIT 1
    `
    
    if (!customer || customer.length === 0) {
      console.log('❌ No activated referrer found in database')
      return
    }
    
    const customerData = customer[0]
    console.log(`👤 Testing with customer: ${customerData.given_name} ${customerData.family_name}`)
    console.log(`   Square ID: ${customerData.square_customer_id}`)
    console.log(`   Referral Code: ${customerData.personal_code}`)
    
    // Test retrieving custom attributes
    console.log('\n📡 Fetching custom attributes from Square...')
    const response = await customersApi.retrieveCustomer(customerData.square_customer_id)
    
    if (response.result.customer && response.result.customer.customAttributes) {
      console.log('✅ Custom attributes found:')
      response.result.customer.customAttributes.forEach(attr => {
        console.log(`   - ${attr.key}: ${attr.value}`)
      })
      
      // Check for referral code
      const referralCodeAttr = response.result.customer.customAttributes.find(
        attr => attr.key === 'referral_code'
      )
      
      if (referralCodeAttr) {
        console.log(`\n🎯 Referral code found: ${referralCodeAttr.value}`)
        console.log('✅ Webhook will be able to process this referral!')
      } else {
        console.log('\n❌ No referral_code custom attribute found')
        console.log('⚠️ Make sure to run the referral code generation script')
      }
    } else {
      console.log('❌ No custom attributes found for this customer')
    }
    
  } catch (error) {
    console.error('❌ Error testing custom attributes:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// Test webhook endpoint
async function testWebhookEndpoint() {
  console.log('\n🧪 Testing Webhook Endpoint...')
  
  const webhookUrl = 'https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/api/webhooks/square/payments'
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'GET'
    })
    
    const data = await response.text()
    console.log(`📊 Webhook Status: ${response.status}`)
    console.log(`📄 Response: ${data}`)
    
    if (response.ok) {
      console.log('✅ Webhook endpoint is accessible')
    } else {
      console.log('❌ Webhook endpoint has issues')
    }
  } catch (error) {
    console.error('❌ Error testing webhook:', error.message)
  }
}

// Main test function
async function runTests() {
  console.log('🧪 Testing Referral System Setup')
  console.log('=' .repeat(50))
  
  await testCustomAttributes()
  console.log('\n' + '=' .repeat(50))
  await testWebhookEndpoint()
  console.log('\n' + '=' .repeat(50))
  
  console.log('🎉 Tests completed!')
  console.log('\n📋 Next steps:')
  console.log('   1. Generate referral codes for customers')
  console.log('   2. Test booking with referral code')
  console.log('   3. Verify webhook processes the referral')
  console.log('   4. Check gift cards are created')
}

// Run the tests
runTests()
