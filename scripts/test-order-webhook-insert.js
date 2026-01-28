/**
 * Test order.updated webhook by actually sending it to the webhook endpoint
 * This will test if orders and order_line_items are saved correctly
 */

const crypto = require('crypto')

// The actual webhook payload from logs
const webhookPayload = {
  "merchant_id": "MLJSE2F6EE60D",
  "type": "order.updated",
  "event_id": "8263629b-25dc-3143-bb4a-442915d38c35",
  "created_at": "2026-01-24T20:32:52.682Z",
  "data": {
    "type": "order_updated",
    "id": "RQNfktNCBiZUvJ7ACllbMTMrJiSZY",
    "object": {
      "order_updated": {
        "created_at": "2026-01-24T20:32:48.508Z",
        "location_id": "LT4ZHFBQQYB2N",
        "order_id": "RQNfktNCBiZUvJ7ACllbMTMrJiSZY",
        "state": "OPEN",
        "updated_at": "2026-01-24T20:32:52.556Z",
        "version": 4
      }
    }
  }
}

function createSignature(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(payload)
  return hmac.digest('base64')
}

async function testWebhookInsert() {
  console.log('🧪 Testing order.updated Webhook Insert\n')
  console.log('='.repeat(60))

  const webhookUrl = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhooks/square'
  const webhookSecret = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY

  if (!webhookSecret) {
    console.error('❌ SQUARE_WEBHOOK_SIGNATURE_KEY not set')
    console.log('   Using test signature mode...')
  }

  try {
    const body = JSON.stringify(webhookPayload)
    const signature = webhookSecret 
      ? createSignature(body, webhookSecret)
      : 'test-signature-mock'

    console.log(`\n📤 Sending webhook to: ${webhookUrl}`)
    console.log(`   Order ID: ${webhookPayload.data.object.order_updated.order_id}`)
    console.log(`   Merchant ID: ${webhookPayload.merchant_id}`)
    console.log(`   Location ID: ${webhookPayload.data.object.order_updated.location_id}`)

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-square-hmacsha256-signature': signature,
      },
      body: body
    })

    const responseText = await response.text()
    let responseData
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = { raw: responseText }
    }

    console.log(`\n📥 Response Status: ${response.status}`)
    console.log(`📥 Response Body:`, JSON.stringify(responseData, null, 2))

    if (response.ok) {
      console.log(`\n✅ Webhook processed successfully!`)
      console.log(`\nNow checking database...`)
      
      // Wait a moment for database write
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Check if order was saved
      const { PrismaClient } = require('@prisma/client')
      const prisma = new PrismaClient()
      
      try {
        const orderId = webhookPayload.data.object.order_updated.order_id
        const savedOrder = await prisma.$queryRaw`
          SELECT id, organization_id, order_id, state, created_at, updated_at
          FROM orders 
          WHERE order_id = ${orderId}
          LIMIT 1
        `
        
        if (savedOrder && savedOrder.length > 0) {
          console.log(`\n✅ Order saved to database:`)
          console.log(`   - Order ID: ${savedOrder[0].order_id}`)
          console.log(`   - Organization: ${savedOrder[0].organization_id?.substring(0, 8)}...`)
          console.log(`   - State: ${savedOrder[0].state}`)
          console.log(`   - Created: ${savedOrder[0].created_at}`)
          
          // Check line items
          const orderUuid = savedOrder[0].id
          const lineItems = await prisma.$queryRaw`
            SELECT id, uid, name, service_variation_id, organization_id
            FROM order_line_items
            WHERE order_id = ${orderUuid}::uuid
          `
          
          console.log(`\n✅ Order Line Items: ${lineItems.length} items`)
          if (lineItems.length > 0) {
            lineItems.forEach((item, idx) => {
              console.log(`   ${idx + 1}. ${item.name || 'unnamed'} (uid: ${item.uid?.substring(0, 20)}...)`)
            })
          } else {
            console.log(`   ⚠️ No line items found - order may not have line items or Square API call failed`)
          }
        } else {
          console.log(`\n❌ Order NOT saved to database`)
          console.log(`   This indicates the webhook processing failed`)
        }
        
        await prisma.$disconnect()
      } catch (dbError) {
        console.error(`\n❌ Error checking database:`, dbError.message)
      }
    } else {
      console.log(`\n❌ Webhook processing failed`)
      console.log(`   Status: ${response.status}`)
      console.log(`   Response: ${responseText.substring(0, 500)}`)
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n✅ Test complete\n')

  } catch (error) {
    console.error('❌ Error during test:', error)
    console.error('   Stack:', error.stack)
    throw error
  }
}

testWebhookInsert()
  .then(() => {
    console.log('Script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })



