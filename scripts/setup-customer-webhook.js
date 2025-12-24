#!/usr/bin/env node
require('dotenv').config()
const { Client, Environment } = require('square')

const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const webhooksApi = squareClient.webhooksApi

async function setupWebhook() {
  console.log('🔗 Setting up Square webhook for customer events...')
  
  try {
    // Your webhook URL (replace with your actual domain)
    const webhookUrl = process.env.WEBHOOK_URL || 'https://your-domain.com/api/webhooks/square/customers'
    
    console.log('📡 Webhook URL:', webhookUrl)
    
    // Subscribe to customer events
    const subscriptionRequest = {
      subscription: {
        name: 'Customer Sync Webhook',
        enabled: true,
        eventTypes: [
          'customer.created',
          'customer.updated'
        ],
        notificationUrl: webhookUrl,
        apiVersion: '2023-10-18'
      }
    }
    
    console.log('📋 Creating webhook subscription...')
    const response = await webhooksApi.createWebhookSubscription(subscriptionRequest)
    
    if (response.result.subscription) {
      const subscription = response.result.subscription
      console.log('✅ Webhook subscription created successfully!')
      console.log('📊 Subscription ID:', subscription.id)
      console.log('🔗 Notification URL:', subscription.notificationUrl)
      console.log('📅 Created at:', subscription.createdAt)
      console.log('🎯 Event types:', subscription.eventTypes)
      
      console.log('')
      console.log('🔑 IMPORTANT: Add this to your .env file:')
      console.log(`SQUARE_WEBHOOK_SECRET=${subscription.signatureKey}`)
      console.log('')
      console.log('📝 Next steps:')
      console.log('1. Add SQUARE_WEBHOOK_SECRET to your environment variables')
      console.log('2. Deploy your webhook endpoint to your production server')
      console.log('3. Test the webhook with Square\'s webhook simulator')
      
    } else {
      console.error('❌ Failed to create webhook subscription')
      console.error('Response:', response)
    }
    
  } catch (error) {
    console.error('💥 Error setting up webhook:', error)
    
    if (error.errors) {
      console.error('Square API Errors:')
      error.errors.forEach(err => {
        console.error(`- ${err.category}: ${err.detail}`)
      })
    }
  }
}

async function listExistingWebhooks() {
  console.log('📋 Checking existing webhook subscriptions...')
  
  try {
    const response = await webhooksApi.listWebhookSubscriptions()
    
    if (response.result.subscriptions) {
      console.log(`Found ${response.result.subscriptions.length} existing webhook(s):`)
      
      response.result.subscriptions.forEach(sub => {
        console.log(`- ID: ${sub.id}`)
        console.log(`  Name: ${sub.name}`)
        console.log(`  URL: ${sub.notificationUrl}`)
        console.log(`  Enabled: ${sub.enabled}`)
        console.log(`  Events: ${sub.eventTypes?.join(', ')}`)
        console.log('')
      })
    } else {
      console.log('No existing webhook subscriptions found.')
    }
    
  } catch (error) {
    console.error('Error listing webhooks:', error)
  }
}

// Main execution
async function main() {
  const command = process.argv[2]
  
  if (command === 'list') {
    await listExistingWebhooks()
  } else {
    await setupWebhook()
  }
}

main()
