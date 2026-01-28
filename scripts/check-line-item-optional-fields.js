#!/usr/bin/env node
/**
 * Check if any orders have line items with optional fields like:
 * metadata, customAttributes, fulfillments, appliedTaxes, etc.
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkOptionalFields() {
  console.log('🔍 Checking for Optional Line Item Fields\n')
  console.log('='.repeat(80))

  try {
    // Get multiple orders to check for optional fields
    const orders = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id as square_order_id,
        o.raw_json
      FROM orders o
      WHERE o.raw_json IS NOT NULL
        AND (o.raw_json->'lineItems') IS NOT NULL
        AND jsonb_array_length(o.raw_json->'lineItems') > 0
      ORDER BY o.created_at DESC
      LIMIT 20
    `
    
    if (!orders || orders.length === 0) {
      console.log('❌ No orders found with line items')
      return
    }
    
    console.log(`✅ Checking ${orders.length} orders for optional fields...\n`)
    
    const optionalFields = {
      metadata: 0,
      customAttributes: 0,
      custom_attributes: 0,
      fulfillments: 0,
      appliedTaxes: 0,
      applied_taxes: 0,
      appliedDiscounts: 0,
      applied_discounts: 0,
      appliedServiceCharges: 0,
      applied_service_charges: 0,
      note: 0,
      modifiers: 0
    }
    
    const examples = {}
    
    for (const order of orders) {
      const rawJson = order.raw_json
      const lineItems = rawJson.lineItems || rawJson.line_items || []
      
      for (const lineItem of lineItems) {
        // Check each optional field
        for (const field of Object.keys(optionalFields)) {
          if (lineItem[field] !== undefined && lineItem[field] !== null) {
            optionalFields[field]++
            
            // Store first example
            if (!examples[field]) {
              examples[field] = {
                orderId: order.square_order_id,
                value: lineItem[field]
              }
            }
          }
        }
      }
    }
    
    console.log('📊 Field Occurrence Count:\n')
    for (const [field, count] of Object.entries(optionalFields)) {
      const status = count > 0 ? '✅' : '❌'
      console.log(`  ${status} ${field}: ${count} occurrence(s)`)
      
      if (count > 0 && examples[field]) {
        console.log(`     Example from order: ${examples[field].orderId}`)
        console.log(`     Value: ${JSON.stringify(examples[field].value, null, 2).substring(0, 200)}`)
        if (JSON.stringify(examples[field].value).length > 200) {
          console.log(`     ... (truncated)`)
        }
        console.log()
      }
    }
    
    // Show detailed example if any found
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 Detailed Examples:\n')
    
    for (const [field, example] of Object.entries(examples)) {
      if (example) {
        console.log(`\n${field}:`)
        console.log(JSON.stringify(example.value, null, 2))
        console.log()
      }
    }
    
    // Also check order-level fields
    console.log('\n' + '='.repeat(80))
    console.log('\n🔍 Checking Order-Level Optional Fields:\n')
    
    const orderOptionalFields = {
      metadata: 0,
      customAttributes: 0,
      custom_attributes: 0,
      fulfillments: 0,
      reference_id: 0,
      note: 0
    }
    
    const orderExamples = {}
    
    for (const order of orders) {
      const rawJson = order.raw_json
      
      for (const field of Object.keys(orderOptionalFields)) {
        if (rawJson[field] !== undefined && rawJson[field] !== null) {
          orderOptionalFields[field]++
          
          if (!orderExamples[field]) {
            orderExamples[field] = {
              orderId: order.square_order_id,
              value: rawJson[field]
            }
          }
        }
      }
    }
    
    for (const [field, count] of Object.entries(orderOptionalFields)) {
      const status = count > 0 ? '✅' : '❌'
      console.log(`  ${status} ${field}: ${count} occurrence(s)`)
      
      if (count > 0 && orderExamples[field]) {
        console.log(`     Example: ${JSON.stringify(orderExamples[field].value, null, 2).substring(0, 200)}`)
        if (JSON.stringify(orderExamples[field].value).length > 200) {
          console.log(`     ... (truncated)`)
        }
        console.log()
      }
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

checkOptionalFields()
  .then(() => {
    console.log('\n✅ Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })



