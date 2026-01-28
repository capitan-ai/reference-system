#!/usr/bin/env node
/**
 * Test inserting line items for a specific 2025 order
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

function convertBigIntToString(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return obj.toString()
  if (Array.isArray(obj)) return obj.map(convertBigIntToString)
  if (typeof obj === 'object') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertBigIntToString(value)
    }
    return result
  }
  return obj
}

async function testInsert() {
  try {
    // Get a 2025 order that's missing line items
    const startDate = new Date('2025-01-01T00:00:00Z')
    const endDate = new Date('2025-12-31T23:59:59Z')
    const beginTime = startDate.toISOString()
    const endTime = endDate.toISOString()

    const locations = await prisma.$queryRaw`
      SELECT square_location_id FROM locations WHERE square_location_id IS NOT NULL LIMIT 1
    `
    
    const locationId = locations[0].square_location_id

    // Get one 2025 order from Square
    const searchRequest = {
      query: {
        filter: {
          dateTimeFilter: {
            createdAt: {
              startAt: beginTime,
              endAt: endTime
            }
          },
          stateFilter: { states: ['OPEN', 'COMPLETED', 'CANCELED'] }
        }
      },
      locationIds: [locationId],
      limit: 1
    }

    const response = await ordersApi.searchOrders(searchRequest)
    const orders = response.result?.orders || []
    
    if (orders.length === 0) {
      console.log('No 2025 orders found')
      return
    }

    const testOrderId = orders[0].id
    console.log(`\n🔍 Testing order: ${testOrderId}\n`)

    // Check if it has line items in DB
    const dbCheck = await prisma.$queryRaw`
      SELECT o.id, o.order_id, o.organization_id, COUNT(oli.id)::int as line_item_count
      FROM orders o
      LEFT JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.order_id = ${testOrderId}
      GROUP BY o.id, o.order_id, o.organization_id
    `

    if (dbCheck.length === 0) {
      console.log('❌ Order not in database')
      return
    }

    const orderRecord = dbCheck[0]
    console.log(`✅ Order in DB:`)
    console.log(`   UUID: ${orderRecord.id}`)
    console.log(`   Organization ID: ${orderRecord.organization_id}`)
    console.log(`   Line items in DB: ${orderRecord.line_item_count}`)

    // Fetch from Square
    const orderResponse = await ordersApi.retrieveOrder(testOrderId)
    const squareOrder = orderResponse.result?.order

    if (!squareOrder) {
      console.log('❌ Order not found in Square')
      return
    }

    console.log(`\n✅ Order in Square:`)
    console.log(`   Created: ${squareOrder.createdAt || squareOrder.created_at}`)
    console.log(`   State: ${squareOrder.state}`)

    const lineItems = squareOrder.lineItems || squareOrder.line_items || []
    console.log(`   Line items: ${lineItems.length}`)

    if (lineItems.length === 0) {
      console.log('⚠️  No line items in Square')
      return
    }

    // Try to insert first line item
    const item = lineItems[0]
    const itemUid = item.uid || null

    if (!itemUid) {
      console.log('❌ Line item has no UID')
      return
    }

    console.log(`\n🔄 Testing insertion of line item:`)
    console.log(`   UID: ${itemUid}`)
    console.log(`   Name: ${item.name}`)

    const locationIdFromOrder = squareOrder.locationId || squareOrder.location_id || null
    const customerId = squareOrder.customerId || squareOrder.customer_id || null
    const orderState = squareOrder.state
    const orderCreatedAt = squareOrder.createdAt ? new Date(squareOrder.createdAt) : (squareOrder.created_at ? new Date(squareOrder.created_at) : new Date())
    const orderUpdatedAt = squareOrder.updatedAt ? new Date(squareOrder.updatedAt) : (squareOrder.updated_at ? new Date(squareOrder.updated_at) : new Date())

    // Extract money amounts
    const basePriceMoney = item.basePriceMoney || item.base_price_money || {}
    const basePriceAmount = basePriceMoney.amount ? Number(basePriceMoney.amount) : null
    const grossSalesMoney = item.grossSalesMoney || item.gross_sales_money || {}
    const grossSalesAmount = grossSalesMoney.amount ? Number(grossSalesMoney.amount) : null
    const totalTaxMoney = item.totalTaxMoney || item.total_tax_money || {}
    const totalTaxAmount = totalTaxMoney.amount ? Number(totalTaxMoney.amount) : 0
    const totalDiscountMoney = item.totalDiscountMoney || item.total_discount_money || {}
    const totalDiscountAmount = totalDiscountMoney.amount ? Number(totalDiscountMoney.amount) : 0
    const totalMoney = item.totalMoney || item.total_money || {}
    const totalAmount = totalMoney.amount ? Number(totalMoney.amount) : null

    const catalogVersion = item.catalogVersion || item.catalog_version
    const catalogVersionNum = catalogVersion ? (typeof catalogVersion === 'bigint' ? Number(catalogVersion) : Number(catalogVersion)) : null

    const lineItemData = {
      id: require('crypto').randomUUID(),
      order_id: orderRecord.id,
      organization_id: orderRecord.organization_id,
      location_id: locationIdFromOrder,
      customer_id: customerId,
      uid: itemUid,
      service_variation_id: item.catalogObjectId || item.catalog_object_id || item.serviceVariationId || item.service_variation_id || null,
      catalog_version: catalogVersionNum,
      quantity: item.quantity || null,
      name: item.name || null,
      variation_name: item.variationName || item.variation_name || null,
      item_type: item.itemType || item.item_type || null,
      
      base_price_money_amount: basePriceAmount,
      base_price_money_currency: basePriceMoney.currency || 'USD',
      gross_sales_money_amount: grossSalesAmount,
      gross_sales_money_currency: grossSalesMoney.currency || 'USD',
      total_tax_money_amount: totalTaxAmount,
      total_tax_money_currency: totalTaxMoney.currency || 'USD',
      total_discount_money_amount: totalDiscountAmount,
      total_discount_money_currency: totalDiscountMoney.currency || 'USD',
      total_money_amount: totalAmount,
      total_money_currency: totalMoney.currency || 'USD',
      
      order_state: orderState,
      order_version: squareOrder.version ? Number(squareOrder.version) : null,
      order_created_at: orderCreatedAt,
      order_updated_at: orderUpdatedAt,
      order_closed_at: squareOrder.closedAt ? new Date(squareOrder.closedAt) : (squareOrder.closed_at ? new Date(squareOrder.closed_at) : null),
      
      raw_json: convertBigIntToString(item),
    }

    console.log(`\n📝 Attempting to create line item...`)

    try {
      await prisma.orderLineItem.create({
        data: lineItemData
      })
      console.log(`✅ Successfully created line item!`)
    } catch (createError) {
      console.log(`❌ Create error: ${createError.message}`)
      console.log(`   Code: ${createError.code}`)
      if (createError.meta) {
        console.log(`   Meta:`, JSON.stringify(createError.meta, null, 2))
      }
      
      // Try to see if it already exists
      const existing = await prisma.$queryRaw`
        SELECT id, uid, order_created_at
        FROM order_line_items
        WHERE organization_id = ${orderRecord.organization_id}::uuid
          AND uid = ${itemUid}
      `
      
      if (existing.length > 0) {
        console.log(`\n⚠️  Line item already exists:`)
        console.log(`   ID: ${existing[0].id}`)
        console.log(`   UID: ${existing[0].uid}`)
        console.log(`   Order created at: ${existing[0].order_created_at}`)
        console.log(`   (This is why it's not showing up in 2025 query - wrong date!)`)
      }
    }

  } catch (error) {
    console.error('❌ Error:', error)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

testInsert()
  .then(() => {
    console.log('\n✅ Test complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })



