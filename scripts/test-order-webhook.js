/**
 * Test order.updated webhook processing
 * Tests if orders and order_line_items are saved correctly
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

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

async function testOrderWebhook() {
  console.log('🧪 Testing order.updated Webhook Processing\n')
  console.log('='.repeat(60))

  try {
    const merchantId = webhookPayload.merchant_id
    const locationId = webhookPayload.data.object.order_updated.location_id
    const orderId = webhookPayload.data.object.order_updated.order_id

    // Step 1: Check if organization exists for merchant_id
    console.log('\n1. Checking organization for merchant_id...')
    const org = await prisma.$queryRaw`
      SELECT id, square_merchant_id, name 
      FROM organizations 
      WHERE square_merchant_id = ${merchantId}
      LIMIT 1
    `
    
    if (org && org.length > 0) {
      console.log(`   ✅ Found organization: ${org[0].name || 'Unnamed'} (${org[0].id.substring(0, 8)}...)`)
    } else {
      console.log(`   ❌ No organization found for merchant_id: ${merchantId}`)
      console.log(`   ⚠️ This will cause organization_id resolution to fail!`)
    }

    // Step 2: Check if location exists
    console.log('\n2. Checking location...')
    const loc = await prisma.$queryRaw`
      SELECT id, square_location_id, organization_id, name 
      FROM locations 
      WHERE square_location_id = ${locationId}
      LIMIT 1
    `
    
    if (loc && loc.length > 0) {
      console.log(`   ✅ Found location: ${loc[0].name} (org: ${loc[0].organization_id?.substring(0, 8)}...)`)
    } else {
      console.log(`   ⚠️ Location ${locationId} not found in database`)
      console.log(`   ⚠️ Location-based resolution will fail if merchant_id is missing`)
    }

    // Step 3: Check if order already exists
    console.log('\n3. Checking if order already exists...')
    const existingOrder = await prisma.$queryRaw`
      SELECT id, organization_id, order_id, state, created_at
      FROM orders 
      WHERE order_id = ${orderId}
      LIMIT 1
    `
    
    if (existingOrder && existingOrder.length > 0) {
      console.log(`   ℹ️ Order already exists: ${existingOrder[0].order_id}`)
      console.log(`      - Organization: ${existingOrder[0].organization_id?.substring(0, 8)}...`)
      console.log(`      - State: ${existingOrder[0].state}`)
      console.log(`      - Created: ${existingOrder[0].created_at}`)
    } else {
      console.log(`   ℹ️ Order does not exist yet - will be created`)
    }

    // Step 4: Simulate the resolution logic
    console.log('\n4. Simulating organization_id resolution...')
    let organizationId = null
    
    // Method 1: From merchant_id
    if (merchantId) {
      const orgResult = await prisma.$queryRaw`
        SELECT id FROM organizations 
        WHERE square_merchant_id = ${merchantId}
        LIMIT 1
      `
      if (orgResult && orgResult.length > 0) {
        organizationId = orgResult[0].id
        console.log(`   ✅ Method 1 (merchant_id): Resolved to ${organizationId.substring(0, 8)}...`)
      } else {
        console.log(`   ❌ Method 1 (merchant_id): Failed - no organization found`)
      }
    } else {
      console.log(`   ⚠️ Method 1 (merchant_id): Skipped - merchant_id missing`)
    }

    // Method 2: From location_id
    if (!organizationId && locationId) {
      const locResult = await prisma.$queryRaw`
        SELECT organization_id FROM locations 
        WHERE square_location_id = ${locationId}
        LIMIT 1
      `
      if (locResult && locResult.length > 0) {
        organizationId = locResult[0].organization_id
        console.log(`   ✅ Method 2 (location_id): Resolved to ${organizationId.substring(0, 8)}...`)
      } else {
        console.log(`   ❌ Method 2 (location_id): Failed - location not found`)
      }
    } else if (!organizationId) {
      console.log(`   ⚠️ Method 2 (location_id): Skipped - location_id missing or already resolved`)
    }

    // Method 3: From existing order
    if (!organizationId && existingOrder && existingOrder.length > 0) {
      organizationId = existingOrder[0].organization_id
      console.log(`   ✅ Method 3 (existing order): Resolved to ${organizationId.substring(0, 8)}...`)
    }

    // Method 4: Fallback to first active org
    if (!organizationId) {
      const fallbackOrg = await prisma.$queryRaw`
        SELECT id FROM organizations 
        WHERE is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `
      if (fallbackOrg && fallbackOrg.length > 0) {
        organizationId = fallbackOrg[0].id
        console.log(`   ⚠️ Method 4 (fallback): Using ${organizationId.substring(0, 8)}...`)
      }
    }

    // Step 5: Final result
    console.log('\n5. Resolution Result:')
    if (organizationId) {
      console.log(`   ✅ SUCCESS: organization_id = ${organizationId}`)
      console.log(`   ✅ Webhook should be able to process this order`)
    } else {
      console.log(`   ❌ FAILED: Could not resolve organization_id`)
      console.log(`   ❌ Webhook will fail with error`)
    }

    // Step 6: Check order_line_items for this order
    console.log('\n6. Checking order_line_items for this order...')
    if (existingOrder && existingOrder.length > 0) {
      const orderUuid = existingOrder[0].id
      const lineItems = await prisma.$queryRaw`
        SELECT COUNT(*)::int as count
        FROM order_line_items
        WHERE order_id = ${orderUuid}::uuid
      `
      console.log(`   Found ${lineItems[0]?.count || 0} line items for this order`)
    } else {
      console.log(`   Order doesn't exist yet, so no line items to check`)
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n✅ Test complete\n')
    console.log('Next steps:')
    console.log('1. If organization_id resolved successfully, the webhook should work')
    console.log('2. To test actual webhook processing, send POST to /api/webhooks/square')
    console.log('3. Check logs for any errors during processing')

  } catch (error) {
    console.error('❌ Error during test:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testOrderWebhook()
  .then(() => {
    console.log('Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })



