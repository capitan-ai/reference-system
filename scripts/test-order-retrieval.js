#!/usr/bin/env node
/**
 * Test retrieving a specific order from Square API
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Import Square SDK
let squareClient
let ordersApi
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
  ordersApi = squareClient.ordersApi
  
  console.log(`🔑 Using Square ${squareEnvName} environment`)
} catch (error) {
  console.error('Failed to initialize Square SDK:', error.message)
  process.exit(1)
}

async function testOrderRetrieval() {
  try {
    // Get a sample order that's failing
    const sampleOrders = await prisma.$queryRaw`
      SELECT DISTINCT o.order_id, o.state
      FROM orders o
      WHERE o.id NOT IN (
        SELECT DISTINCT order_id 
        FROM order_line_items 
        WHERE order_created_at >= '2025-01-01' 
          AND order_created_at < '2026-01-01'
      )
      AND o.order_id IS NOT NULL
      LIMIT 5
    `

    console.log(`\n🔍 Testing order retrieval for ${sampleOrders.length} sample orders...\n`)

    for (const order of sampleOrders) {
      const orderId = order.order_id
      console.log(`\n📦 Testing order: ${orderId}`)
      console.log(`   State in DB: ${order.state}`)
      
      try {
        const orderResponse = await ordersApi.retrieveOrder(orderId)
        const squareOrder = orderResponse.result?.order
        
        if (!squareOrder) {
          console.log(`   ❌ Order not found in Square API`)
          continue
        }

        console.log(`   ✅ Order found in Square`)
        console.log(`   State: ${squareOrder.state}`)
        console.log(`   Created: ${squareOrder.createdAt || squareOrder.created_at}`)
        
        const lineItems = squareOrder.lineItems || squareOrder.line_items || []
        console.log(`   Line items: ${lineItems.length}`)
        
        if (lineItems.length > 0) {
          console.log(`   First line item:`)
          const firstItem = lineItems[0]
          console.log(`     - UID: ${firstItem.uid}`)
          console.log(`     - Name: ${firstItem.name}`)
          console.log(`     - Quantity: ${firstItem.quantity}`)
          console.log(`     - Type: ${firstItem.itemType || firstItem.item_type}`)
        } else {
          console.log(`   ⚠️  No line items in Square`)
        }

      } catch (apiError) {
        console.log(`   ❌ API Error: ${apiError.message}`)
        if (apiError.errors && apiError.errors.length > 0) {
          console.log(`   Error details:`, JSON.stringify(apiError.errors, null, 2))
        }
        if (apiError.response) {
          console.log(`   Response status: ${apiError.response.statusCode}`)
          console.log(`   Response body:`, JSON.stringify(apiError.response.body, null, 2))
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testOrderRetrieval()
  .then(() => {
    console.log('\n✅ Test complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })



