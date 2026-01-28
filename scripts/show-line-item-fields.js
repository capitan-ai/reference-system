#!/usr/bin/env node
/**
 * Show all fields available in Square Order Line Items from the API
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function showLineItemFields() {
  console.log('📋 Square Order Line Item - All Available Fields\n')
  console.log('='.repeat(80))

  try {
    // Get an order with line items
    const order = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id as square_order_id,
        o.raw_json
      FROM orders o
      WHERE o.raw_json IS NOT NULL
        AND (o.raw_json->'lineItems') IS NOT NULL
        AND jsonb_array_length(o.raw_json->'lineItems') > 0
      ORDER BY o.created_at DESC
      LIMIT 1
    `
    
    if (!order || order.length === 0) {
      console.log('❌ No orders found with line items')
      return
    }
    
    const orderData = order[0]
    const rawJson = orderData.raw_json
    const lineItems = rawJson.lineItems || rawJson.line_items || []
    
    console.log(`✅ Found order: ${orderData.square_order_id}`)
    console.log(`   Line items: ${lineItems.length}\n`)
    
    if (lineItems.length === 0) {
      console.log('❌ No line items found')
      return
    }
    
    // Show complete structure of first line item
    const firstLineItem = lineItems[0]
    
    console.log('📦 Complete Line Item Structure:\n')
    console.log(JSON.stringify(firstLineItem, null, 2))
    
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 Field Summary:\n')
    
    // List all fields with their types and values
    Object.keys(firstLineItem).forEach(key => {
      const value = firstLineItem[key]
      const type = Array.isArray(value) ? 'array' : typeof value
      const preview = type === 'object' && value !== null 
        ? JSON.stringify(value).substring(0, 100) + (JSON.stringify(value).length > 100 ? '...' : '')
        : String(value).substring(0, 100)
      
      console.log(`  ${key}:`)
      console.log(`    Type: ${type}`)
      console.log(`    Value: ${preview}`)
      console.log()
    })
    
    // Check for nested objects
    console.log('\n' + '='.repeat(80))
    console.log('\n🔍 Nested Objects Analysis:\n')
    
    if (firstLineItem.metadata) {
      console.log('✅ metadata:', JSON.stringify(firstLineItem.metadata, null, 2))
    } else {
      console.log('❌ No metadata field')
    }
    
    if (firstLineItem.customAttributes || firstLineItem.custom_attributes) {
      console.log('\n✅ customAttributes:', JSON.stringify(firstLineItem.customAttributes || firstLineItem.custom_attributes, null, 2))
    } else {
      console.log('\n❌ No customAttributes field')
    }
    
    if (firstLineItem.fulfillments || firstLineItem.fulfillment) {
      console.log('\n✅ fulfillments:', JSON.stringify(firstLineItem.fulfillments || firstLineItem.fulfillment, null, 2))
    } else {
      console.log('\n❌ No fulfillments field')
    }
    
    if (firstLineItem.appliedTaxes || firstLineItem.applied_taxes) {
      console.log('\n✅ appliedTaxes:', JSON.stringify(firstLineItem.appliedTaxes || firstLineItem.applied_taxes, null, 2))
    } else {
      console.log('\n❌ No appliedTaxes field')
    }
    
    if (firstLineItem.appliedDiscounts || firstLineItem.applied_discounts) {
      console.log('\n✅ appliedDiscounts:', JSON.stringify(firstLineItem.appliedDiscounts || firstLineItem.applied_discounts, null, 2))
    } else {
      console.log('\n❌ No appliedDiscounts field')
    }
    
    if (firstLineItem.appliedServiceCharges || firstLineItem.applied_service_charges) {
      console.log('\n✅ appliedServiceCharges:', JSON.stringify(firstLineItem.appliedServiceCharges || firstLineItem.applied_service_charges, null, 2))
    } else {
      console.log('\n❌ No appliedServiceCharges field')
    }
    
    // Check all line items for variations
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 All Line Items in Order:\n')
    
    lineItems.forEach((item, idx) => {
      console.log(`\nLine Item ${idx + 1}:`)
      console.log(`  uid: ${item.uid || 'N/A'}`)
      console.log(`  name: ${item.name || 'N/A'}`)
      console.log(`  itemType: ${item.itemType || item.item_type || 'N/A'}`)
      console.log(`  catalogObjectId: ${item.catalogObjectId || item.catalog_object_id || 'N/A'}`)
      console.log(`  serviceVariationId: ${item.serviceVariationId || item.service_variation_id || 'N/A'}`)
      console.log(`  quantity: ${item.quantity || 'N/A'}`)
      console.log(`  variationName: ${item.variationName || item.variation_name || 'N/A'}`)
    })

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

showLineItemFields()
  .then(() => {
    console.log('\n✅ Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })



