#!/usr/bin/env node
/**
 * Inspect raw_json from an order to see what Square API returns
 * Check for booking_id, fulfillments, pickup_details, etc.
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function inspectOrderRawJson() {
  console.log('🔍 Inspecting Order Raw JSON from Square API\n')
  console.log('='.repeat(60))

  try {
    // Get an order with raw_json
    const order = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id as square_order_id,
        o.customer_id,
        o.created_at,
        o.raw_json
      FROM orders o
      WHERE o.raw_json IS NOT NULL
        AND o.customer_id IS NOT NULL
      ORDER BY o.created_at DESC
      LIMIT 1
    `
    
    if (!order || order.length === 0) {
      console.log('❌ No orders found with raw_json')
      return
    }
    
    const orderData = order[0]
    const rawJson = orderData.raw_json
    
    console.log(`✅ Found order: ${orderData.square_order_id}`)
    console.log(`   Created: ${orderData.created_at}`)
    console.log(`   Customer: ${orderData.customer_id}`)
    console.log('\n📋 Order Object Structure:\n')
    
    // Show top-level keys
    console.log('Top-level keys:', Object.keys(rawJson).join(', '))
    
    // Check for fulfillments
    if (rawJson.fulfillments) {
      console.log('\n✅ Found fulfillments:')
      console.log(JSON.stringify(rawJson.fulfillments, null, 2))
    } else {
      console.log('\n❌ No fulfillments field')
    }
    
    // Check for metadata
    if (rawJson.metadata) {
      console.log('\n✅ Found metadata:')
      console.log(JSON.stringify(rawJson.metadata, null, 2))
    } else {
      console.log('\n❌ No metadata field')
    }
    
    // Check for custom_attributes
    if (rawJson.custom_attributes || rawJson.customAttributes) {
      console.log('\n✅ Found custom_attributes:')
      console.log(JSON.stringify(rawJson.custom_attributes || rawJson.customAttributes, null, 2))
    } else {
      console.log('\n❌ No custom_attributes field')
    }
    
    // Check line items for booking info
    const lineItems = rawJson.line_items || rawJson.lineItems || []
    console.log(`\n📦 Line Items (${lineItems.length}):`)
    
    if (lineItems.length > 0) {
      const firstLineItem = lineItems[0]
      console.log('\nFirst line item keys:', Object.keys(firstLineItem).join(', '))
      
      // Check for metadata in line items
      if (firstLineItem.metadata) {
        console.log('\n✅ Line item has metadata:')
        console.log(JSON.stringify(firstLineItem.metadata, null, 2))
      }
      
      // Check for custom_attributes in line items
      if (firstLineItem.custom_attributes || firstLineItem.customAttributes) {
        console.log('\n✅ Line item has custom_attributes:')
        console.log(JSON.stringify(firstLineItem.custom_attributes || firstLineItem.customAttributes, null, 2))
      }
      
      // Check for fulfillments in line items
      if (firstLineItem.fulfillments || firstLineItem.fulfillment) {
        console.log('\n✅ Line item has fulfillments:')
        console.log(JSON.stringify(firstLineItem.fulfillments || firstLineItem.fulfillment, null, 2))
      }
      
      // Check for any booking-related fields
      const bookingRelatedKeys = Object.keys(firstLineItem).filter(key => 
        key.toLowerCase().includes('booking') || 
        key.toLowerCase().includes('appointment')
      )
      if (bookingRelatedKeys.length > 0) {
        console.log('\n✅ Found booking-related keys in line item:', bookingRelatedKeys.join(', '))
        bookingRelatedKeys.forEach(key => {
          console.log(`   ${key}:`, JSON.stringify(firstLineItem[key], null, 2))
        })
      }
    }
    
    // Full raw JSON (truncated)
    console.log('\n' + '='.repeat(60))
    console.log('\n📄 Full Raw JSON (first 2000 chars):\n')
    const jsonString = JSON.stringify(rawJson, null, 2)
    console.log(jsonString.substring(0, 2000))
    if (jsonString.length > 2000) {
      console.log('\n... (truncated)')
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

inspectOrderRawJson()
  .then(() => {
    console.log('\n✅ Inspection complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Inspection failed:', error)
    process.exit(1)
  })



