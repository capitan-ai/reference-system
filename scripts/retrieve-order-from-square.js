#!/usr/bin/env node
/**
 * Retrieve a specific order from Square API and show all available data
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const ordersApi = square.ordersApi

// Helper to safely stringify JSON with BigInt support
function safeStringify(obj, indent = 2) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  , indent)
}

async function retrieveOrder(orderId) {
  console.log('🔍 Retrieving Order from Square API\n')
  console.log('='.repeat(80))
  console.log(`Order ID (internal UUID): ${orderId}\n`)

  try {
    // First, check if this is in our database to get the Square order ID
    const orderRecord = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id as square_order_id,
        o.organization_id,
        o.raw_json
      FROM orders o
      WHERE o.id = ${orderId}::uuid
      LIMIT 1
    `
    
    if (!orderRecord || orderRecord.length === 0) {
      console.log('❌ Order not found in database')
      console.log('   Trying to retrieve directly from Square using provided ID...\n')
      
      // Try to retrieve directly (maybe it's a Square order ID)
        try {
          const response = await ordersApi.retrieveOrder(orderId)
          if (response.result?.order) {
            console.log('✅ Found order in Square!\n')
            console.log('📋 Complete Order Data from Square API:\n')
            console.log(safeStringify(response.result.order))
            return
          }
        } catch (squareError) {
          console.error('❌ Error retrieving from Square:', squareError.message)
          if (squareError.errors) {
            console.error('Square API errors:', safeStringify(squareError.errors))
          }
          return
        }
    }
    
    const order = orderRecord[0]
    const squareOrderId = order.square_order_id
    
    console.log('✅ Found order in database:')
    console.log(`   Internal UUID: ${order.id}`)
    console.log(`   Square Order ID: ${squareOrderId}`)
    console.log(`   Organization ID: ${order.organization_id}\n`)
    
    // Retrieve from Square API
    console.log('📡 Retrieving from Square API...\n')
    
    try {
      const response = await ordersApi.retrieveOrder(squareOrderId)
      
      if (!response.result?.order) {
        console.log('❌ No order returned from Square API')
        return
      }
      
      const squareOrder = response.result.order
      
      console.log('✅ Successfully retrieved order from Square!\n')
      console.log('='.repeat(80))
      console.log('\n📋 Complete Order Object from Square API:\n')
      console.log(safeStringify(squareOrder))
      
      console.log('\n' + '='.repeat(80))
      console.log('\n📊 Field Summary:\n')
      
      // Show top-level keys
      console.log('Top-level keys:', Object.keys(squareOrder).join(', '))
      
      // Show line items details
      const lineItems = squareOrder.lineItems || []
      console.log(`\n📦 Line Items (${lineItems.length}):\n`)
      
      if (lineItems.length > 0) {
        lineItems.forEach((item, idx) => {
          console.log(`\nLine Item ${idx + 1}:`)
          console.log(`  Keys: ${Object.keys(item).join(', ')}`)
          console.log(`  Full data:`)
          console.log(safeStringify(item))
        })
      }
      
      // Check for fulfillments at order level
      if (squareOrder.fulfillments) {
        console.log('\n✅ Order-level fulfillments:')
        console.log(safeStringify(squareOrder.fulfillments))
      }
      
      // Check for metadata
      if (squareOrder.metadata) {
        console.log('\n✅ Order-level metadata:')
        console.log(safeStringify(squareOrder.metadata))
      }
      
      // Check for custom attributes
      if (squareOrder.customAttributes || squareOrder.custom_attributes) {
        console.log('\n✅ Order-level custom attributes:')
        console.log(safeStringify(squareOrder.customAttributes || squareOrder.custom_attributes))
      }
      
      // Compare with what we have in database
      console.log('\n' + '='.repeat(80))
      console.log('\n🔍 Comparison with Database:\n')
      
      if (order.raw_json) {
        console.log('✅ We have raw_json stored in database')
        console.log('   Comparing fields...\n')
        
        const dbOrder = order.raw_json
        const squareKeys = new Set(Object.keys(squareOrder))
        const dbKeys = new Set(Object.keys(dbOrder))
        
        const onlyInSquare = [...squareKeys].filter(k => !dbKeys.has(k))
        const onlyInDb = [...dbKeys].filter(k => !squareKeys.has(k))
        
        if (onlyInSquare.length > 0) {
          console.log('⚠️  Fields in Square API but not in our stored data:')
          onlyInSquare.forEach(key => {
            const value = safeStringify(squareOrder[key])
            console.log(`   - ${key}: ${value.substring(0, 100)}`)
          })
        }
        
        if (onlyInDb.length > 0) {
          console.log('\n⚠️  Fields in our stored data but not in Square API:')
          onlyInDb.forEach(key => {
            console.log(`   - ${key}`)
          })
        }
        
        if (onlyInSquare.length === 0 && onlyInDb.length === 0) {
          console.log('✅ All fields match!')
        }
      } else {
        console.log('⚠️  No raw_json stored in database')
      }

    } catch (squareError) {
      console.error('❌ Error retrieving from Square API:', squareError.message)
      if (squareError.errors) {
        console.error('Square API errors:', JSON.stringify(squareError.errors, null, 2))
      }
      throw squareError
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Get order ID from command line argument
const orderId = process.argv[2] || 'a3b1f1a7-201f-449f-ab7a-e931ddaa37a1'

retrieveOrder(orderId)
  .then(() => {
    console.log('\n✅ Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })

