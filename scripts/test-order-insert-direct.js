/**
 * Directly test order insertion by simulating webhook processing
 * This tests if orders and order_line_items are saved correctly
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Import Square SDK
let squareClient
try {
  const squareModule = require('square')
  const { Client, Environment } = squareModule
  
  const { getSquareEnvironmentName } = require('../lib/utils/square-env')
  const squareEnvName = getSquareEnvironmentName()
  const resolvedEnvironment = squareEnvName === 'sandbox' ? Environment.Sandbox : Environment.Production
  
  squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
    environment: resolvedEnvironment,
  })
} catch (error) {
  console.error('Failed to initialize Square SDK:', error.message)
  process.exit(1)
}

// The order ID from the webhook payload
const ORDER_ID = 'RQNfktNCBiZUvJ7ACllbMTMrJiSZY'

async function testOrderInsert() {
  console.log('🧪 Testing Direct Order Insert\n')
  console.log('='.repeat(60))
  console.log(`Order ID: ${ORDER_ID}\n`)

  try {
    // Step 1: Fetch order from Square API
    console.log('1. Fetching order from Square API...')
    const ordersApi = squareClient.ordersApi
    let order
    try {
      const orderResponse = await ordersApi.retrieveOrder(ORDER_ID)
      order = orderResponse.result?.order

      if (!order) {
        console.error(`❌ Order ${ORDER_ID} not found in Square API`)
        return
      }
      
      console.log(`   ✅ Order found`)
      console.log(`      - Location ID: ${order.location_id || 'missing'}`)
      console.log(`      - Merchant ID: ${order.merchant_id || 'missing'}`)
      console.log(`      - State: ${order.state || 'missing'}`)
      console.log(`      - Line Items: ${order.line_items?.length || 0}`)
      console.log(`      - Full order keys: ${Object.keys(order).join(', ')}`)
      
      // Check if merchant_id is in a different location
      if (!order.merchant_id && orderResponse.result?.merchant_id) {
        order.merchant_id = orderResponse.result.merchant_id
        console.log(`      - Found merchant_id in response.result: ${order.merchant_id}`)
      }
    } catch (apiError) {
      console.error(`❌ Error fetching order from Square API:`, apiError.message)
      if (apiError.errors) {
        console.error('Square API errors:', JSON.stringify(apiError.errors, null, 2))
      }
      throw apiError
    }

    const locationId = order.location_id
    const merchantId = order.merchant_id
    const customerId = order.customer_id || null
    const lineItems = order.line_items || []

    // Step 2: Resolve organization_id
    console.log('\n2. Resolving organization_id...')
    let organizationId = null
    
    if (merchantId) {
      const org = await prisma.$queryRaw`
        SELECT id FROM organizations 
        WHERE square_merchant_id = ${merchantId}
        LIMIT 1
      `
      if (org && org.length > 0) {
        organizationId = org[0].id
        console.log(`   ✅ Resolved from merchant_id: ${organizationId.substring(0, 8)}...`)
      } else {
        console.warn(`   ⚠️ No organization found for merchant_id`)
      }
    }

    if (!organizationId && locationId) {
      const loc = await prisma.$queryRaw`
        SELECT organization_id FROM locations 
        WHERE square_location_id = ${locationId}
        LIMIT 1
      `
      if (loc && loc.length > 0) {
        organizationId = loc[0].organization_id
        console.log(`   ✅ Resolved from location: ${organizationId.substring(0, 8)}...`)
      } else {
        console.warn(`   ⚠️ No location found for square_location_id`)
      }
    }

    // Fallback: Try to get from existing orders
    if (!organizationId && ORDER_ID) {
      const existingOrder = await prisma.$queryRaw`
        SELECT organization_id FROM orders 
        WHERE order_id = ${ORDER_ID}
        LIMIT 1
      `
      if (existingOrder && existingOrder.length > 0) {
        organizationId = existingOrder[0].organization_id
        console.log(`   ✅ Resolved from existing order: ${organizationId.substring(0, 8)}...`)
      }
    }

    // Last resort: Get first active organization
    if (!organizationId) {
      const defaultOrg = await prisma.$queryRaw`
        SELECT id FROM organizations 
        WHERE is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `
      if (defaultOrg && defaultOrg.length > 0) {
        organizationId = defaultOrg[0].id
        console.log(`   ⚠️ Using fallback organization: ${organizationId.substring(0, 8)}...`)
      }
    }

    if (!organizationId) {
      console.error(`❌ Cannot resolve organization_id`)
      throw new Error('Cannot resolve organization_id')
    }

    console.log(`   ✅ Final organization_id: ${organizationId}`)

    // Step 3: Get location UUID
    console.log('\n3. Getting location UUID...')
    let locationUuid = null
    if (locationId) {
      const locationRecord = await prisma.$queryRaw`
        SELECT id FROM locations 
        WHERE square_location_id = ${locationId}
          AND organization_id = ${organizationId}::uuid
        LIMIT 1
      `
      if (locationRecord && locationRecord.length > 0) {
        locationUuid = locationRecord[0].id
        console.log(`   ✅ Location UUID: ${locationUuid.substring(0, 8)}...`)
      } else {
        console.warn(`   ⚠️ Location not found in database`)
      }
    }

    // Step 4: Upsert order
    console.log('\n4. Upserting order...')
    const orderData = {
      order_id: ORDER_ID,
      organization_id: organizationId,
      location_id: locationUuid,
      customer_id: customerId,
      state: order.state || 'OPEN',
      version: order.version || 1,
      created_at: order.created_at ? new Date(order.created_at) : new Date(),
      updated_at: order.updated_at ? new Date(order.updated_at) : new Date(),
    }

    const upsertedOrder = await prisma.$executeRaw`
      INSERT INTO orders (
        order_id, organization_id, location_id, customer_id, 
        state, version, created_at, updated_at
      ) VALUES (
        ${orderData.order_id}::text,
        ${orderData.organization_id}::uuid,
        ${orderData.location_id ? orderData.location_id : null}::uuid,
        ${orderData.customer_id || null}::text,
        ${orderData.state}::text,
        ${orderData.version}::int,
        ${orderData.created_at}::timestamptz,
        ${orderData.updated_at}::timestamptz
      )
      ON CONFLICT (order_id, organization_id) 
      DO UPDATE SET
        state = EXCLUDED.state,
        version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at,
        location_id = EXCLUDED.location_id,
        customer_id = EXCLUDED.customer_id
      RETURNING id, order_id, organization_id, state
    `

    // Get the order UUID
    const savedOrder = await prisma.$queryRaw`
      SELECT id, order_id, organization_id, state, created_at
      FROM orders 
      WHERE order_id = ${ORDER_ID}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `

    if (savedOrder && savedOrder.length > 0) {
      const orderUuid = savedOrder[0].id
      console.log(`   ✅ Order upserted successfully`)
      console.log(`      - Order UUID: ${orderUuid.substring(0, 8)}...`)
      console.log(`      - State: ${savedOrder[0].state}`)

      // Step 5: Insert line items
      console.log(`\n5. Processing ${lineItems.length} line items...`)
      
      if (lineItems.length === 0) {
        console.log(`   ⚠️ No line items in order`)
      } else {
        let insertedCount = 0
        let updatedCount = 0
        
        for (const item of lineItems) {
          const lineItemData = {
            order_id: orderUuid,
            organization_id: organizationId,
            uid: item.uid || null,
            name: item.name || null,
            quantity: item.quantity ? String(item.quantity) : null,
            item_type: item.item_type || null,
            base_price_money: item.base_price_money ? JSON.stringify(item.base_price_money) : null,
            variation_name: item.variation_name || null,
            service_variation_id: item.metadata?.service_variation_id || null,
            service_variation_version: item.metadata?.service_variation_version || null,
          }

          try {
            const result = await prisma.$executeRaw`
              INSERT INTO order_line_items (
                order_id, organization_id, uid, name, quantity,
                item_type, base_price_money, variation_name,
                service_variation_id, service_variation_version
              ) VALUES (
                ${lineItemData.order_id}::uuid,
                ${lineItemData.organization_id}::uuid,
                ${lineItemData.uid || null}::text,
                ${lineItemData.name || null}::text,
                ${lineItemData.quantity || null}::text,
                ${lineItemData.item_type || null}::text,
                ${lineItemData.base_price_money || null}::jsonb,
                ${lineItemData.variation_name || null}::text,
                ${lineItemData.service_variation_id || null}::text,
                ${lineItemData.service_variation_version ? parseInt(lineItemData.service_variation_version) : null}::int
              )
              ON CONFLICT (order_id, uid) 
              DO UPDATE SET
                name = EXCLUDED.name,
                quantity = EXCLUDED.quantity,
                item_type = EXCLUDED.item_type,
                base_price_money = EXCLUDED.base_price_money,
                variation_name = EXCLUDED.variation_name,
                service_variation_id = EXCLUDED.service_variation_id,
                service_variation_version = EXCLUDED.service_variation_version
            `
            insertedCount++
            console.log(`   ✅ Line item: ${item.name || 'unnamed'} (uid: ${item.uid?.substring(0, 20)}...)`)
          } catch (itemError) {
            console.error(`   ❌ Error inserting line item ${item.uid}:`, itemError.message)
            throw itemError
          }
        }

        console.log(`\n   ✅ Processed ${insertedCount} line items`)
      }

      // Step 6: Verify final state
      console.log('\n6. Verifying final state...')
      const finalOrder = await prisma.$queryRaw`
        SELECT id, order_id, organization_id, state
        FROM orders 
        WHERE order_id = ${ORDER_ID}
          AND organization_id = ${organizationId}::uuid
        LIMIT 1
      `

      const finalLineItems = await prisma.$queryRaw`
        SELECT COUNT(*)::int as count
        FROM order_line_items
        WHERE order_id = ${orderUuid}::uuid
      `

      console.log(`   ✅ Order exists: ${finalOrder[0]?.order_id}`)
      console.log(`   ✅ Line items count: ${finalLineItems[0]?.count || 0}`)

      console.log('\n' + '='.repeat(60))
      console.log('\n✅ TEST SUCCESSFUL!')
      console.log(`   Order and ${finalLineItems[0]?.count || 0} line items saved to database\n`)
    } else {
      console.error(`   ❌ Failed to save order`)
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error)
    console.error('   Stack:', error.stack)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testOrderInsert()
  .then(() => {
    console.log('Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })

