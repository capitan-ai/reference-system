#!/usr/bin/env node
/**
 * Backfill all orders from 2023 and 2024
 * Fixes state field issue and ensures all orders (including cancelled) are saved
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

async function resolveOrganizationId(merchantId, locationId, orderId) {
  let organizationId = null

  // Method 1: From merchant_id
  if (merchantId) {
    try {
      const org = await prisma.$queryRaw`
        SELECT id FROM organizations 
        WHERE square_merchant_id = ${merchantId}
        LIMIT 1
      `
      if (org && org.length > 0) {
        organizationId = org[0].id
        return { organizationId, method: 'merchant_id' }
      }
    } catch (err) {
      console.error(`❌ Error resolving organization_id from merchant_id: ${err.message}`)
    }
  }

  // Method 2: From location_id
  if (!organizationId && locationId) {
    try {
      const loc = await prisma.$queryRaw`
        SELECT organization_id FROM locations 
        WHERE square_location_id = ${locationId}
        LIMIT 1
      `
      if (loc && loc.length > 0) {
        organizationId = loc[0].organization_id
        return { organizationId, method: 'location_id' }
      }
    } catch (err) {
      console.error(`❌ Error resolving organization_id from location: ${err.message}`)
    }
  }

  // Method 3: From existing order
  if (!organizationId && orderId) {
    try {
      const existingOrder = await prisma.$queryRaw`
        SELECT organization_id FROM orders 
        WHERE order_id = ${orderId}
        LIMIT 1
      `
      if (existingOrder && existingOrder.length > 0) {
        organizationId = existingOrder[0].organization_id
        return { organizationId, method: 'existing_order' }
      }
    } catch (err) {
      // Ignore
    }
  }

  // Method 4: Fallback to first active organization
  if (!organizationId) {
    try {
      const defaultOrg = await prisma.$queryRaw`
        SELECT id FROM organizations 
        WHERE is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `
      if (defaultOrg && defaultOrg.length > 0) {
        organizationId = defaultOrg[0].id
        return { organizationId, method: 'fallback' }
      }
    } catch (err) {
      console.error(`❌ Error getting fallback organization: ${err.message}`)
    }
  }

  return { organizationId, method: null }
}

// Helper function to convert BigInt values in object
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

async function processOrder(orderFromSearch) {
  const orderId = orderFromSearch.id
  
  // Fetch full order details from Square API to get line items
  let order
  try {
    const orderResponse = await ordersApi.retrieveOrder(orderId)
    order = orderResponse.result?.order

    if (!order) {
      console.error(`   ❌ Order ${orderId} not found in Square API`)
      return { success: false, reason: 'order_not_found' }
    }
  } catch (apiError) {
    console.error(`   ❌ Error fetching order ${orderId} from Square API: ${apiError.message}`)
    return { success: false, reason: 'api_error', error: apiError.message }
  }

  const locationId = order.locationId || order.location_id || orderFromSearch.locationId || orderFromSearch.location_id || null
  const customerId = order.customerId || order.customer_id || orderFromSearch.customerId || orderFromSearch.customer_id || null
  const merchantId = order.merchantId || order.merchant_id || orderFromSearch.merchantId || orderFromSearch.merchant_id || null
  const lineItems = order.lineItems || order.line_items || []
  // IMPORTANT: Always get state from the order object, never default to 'OPEN'
  const orderState = order.state || orderFromSearch.state || null

  // Resolve organization_id
  const { organizationId, method } = await resolveOrganizationId(merchantId, locationId, orderId)
  
  if (!organizationId) {
    console.error(`❌ Cannot process order ${orderId}: organization_id is required but could not be resolved`)
    return { success: false, reason: 'no_organization_id' }
  }

  // Verify/create location
  let locationIdForOrder = null
  if (locationId) {
    try {
      const locationRecord = await prisma.$queryRaw`
        SELECT square_location_id FROM locations 
        WHERE square_location_id = ${locationId}
        LIMIT 1
      `
      if (locationRecord && locationRecord.length > 0) {
        locationIdForOrder = locationId
      } else {
        try {
          await prisma.location.create({
            data: {
              organization_id: organizationId,
              square_location_id: locationId,
              name: `Location ${locationId.substring(0, 8)}...`
            }
          })
          locationIdForOrder = locationId
        } catch (createErr) {
          console.warn(`   ⚠️ Could not create location: ${createErr.message}`)
        }
      }
    } catch (err) {
      console.warn(`   ⚠️ Could not verify location: ${err.message}`)
    }
  }

  // Prepare order dates (needed for both order and line items)
  const orderCreatedAt = order.createdAt ? new Date(order.createdAt) : (order.created_at ? new Date(order.created_at) : new Date())
  const orderUpdatedAt = order.updatedAt ? new Date(order.updatedAt) : (order.updated_at ? new Date(order.updated_at) : new Date())

  // Save/update the order - IMPORTANT: Always update state even on conflict
  let orderUuid = null
  try {
    const orderJson = convertBigIntToString(order)
    
    // CRITICAL FIX: Always update state, even if order already exists
    await prisma.$executeRaw`
      INSERT INTO orders (
        id,
        organization_id,
        order_id,
        location_id,
        customer_id,
        state,
        version,
        reference_id,
        created_at,
        updated_at,
        raw_json
      ) VALUES (
        gen_random_uuid(),
        ${organizationId}::uuid,
        ${orderId},
        ${locationIdForOrder || null},
        ${customerId || null},
        ${orderState},
        ${order.version ? Number(order.version) : null},
        ${order.referenceId || order.reference_id || null},
        ${orderCreatedAt},
        ${orderUpdatedAt},
        ${JSON.stringify(orderJson)}::jsonb
      )
      ON CONFLICT (organization_id, order_id) DO UPDATE SET
        location_id = COALESCE(EXCLUDED.location_id, orders.location_id),
        customer_id = COALESCE(EXCLUDED.customer_id, orders.customer_id),
        state = EXCLUDED.state,
        version = COALESCE(EXCLUDED.version, orders.version),
        reference_id = COALESCE(EXCLUDED.reference_id, orders.reference_id),
        updated_at = EXCLUDED.updated_at,
        raw_json = COALESCE(EXCLUDED.raw_json, orders.raw_json)
    `
  } catch (orderError) {
    console.error(`   ❌ Error saving order: ${orderError.message}`)
    return { success: false, reason: 'order_save_error', error: orderError.message }
  }

  // Get order UUID for line items
  try {
    const orderRecord = await prisma.$queryRaw`
      SELECT id FROM orders 
      WHERE order_id = ${orderId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    orderUuid = orderRecord && orderRecord.length > 0 ? orderRecord[0].id : null
    if (!orderUuid) {
      console.error(`   ❌ Order UUID not found after insert`)
      return { success: false, reason: 'no_order_uuid' }
    }
  } catch (queryError) {
    console.error(`   ❌ Error querying for order UUID: ${queryError.message}`)
    return { success: false, reason: 'order_uuid_error' }
  }

  // Process line items (same logic as backfill-orders-last-10-days.js)
  let lineItemsSaved = 0
  let lineItemsSkipped = 0
  
  for (const item of lineItems) {
    const itemUid = item.uid || null
    if (!itemUid) {
      lineItemsSkipped++
      continue
    }

    try {
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
      
      const variationTotalPriceMoney = item.variationTotalPriceMoney || item.variation_total_price_money || {}
      const variationTotalPriceAmount = variationTotalPriceMoney.amount ? Number(variationTotalPriceMoney.amount) : null
      
      const totalServiceChargeMoney = item.totalServiceChargeMoney || item.total_service_charge_money || {}
      const totalServiceChargeAmount = totalServiceChargeMoney.amount ? Number(totalServiceChargeMoney.amount) : 0
      
      const totalCardSurchargeMoney = item.totalCardSurchargeMoney || item.total_card_surcharge_money || {}
      const totalCardSurchargeAmount = totalCardSurchargeMoney.amount ? Number(totalCardSurchargeMoney.amount) : 0

      // Order totals
      const orderTotalTaxMoney = order.totalTaxMoney || order.total_tax_money || {}
      const orderTotalTaxAmount = orderTotalTaxMoney.amount ? Number(orderTotalTaxMoney.amount) : null
      
      const orderTotalDiscountMoney = order.totalDiscountMoney || order.total_discount_money || {}
      const orderTotalDiscountAmount = orderTotalDiscountMoney.amount ? Number(orderTotalDiscountMoney.amount) : null
      
      const orderTotalTipMoney = order.totalTipMoney || order.total_tip_money || {}
      const orderTotalTipAmount = orderTotalTipMoney.amount ? Number(orderTotalTipMoney.amount) : null
      
      const orderTotalMoney = order.totalMoney || order.total_money || {}
      const orderTotalAmount = orderTotalMoney.amount ? Number(orderTotalMoney.amount) : null
      
      const orderTotalServiceChargeMoney = order.totalServiceChargeMoney || order.total_service_charge_money || {}
      const orderTotalServiceChargeAmount = orderTotalServiceChargeMoney.amount ? Number(orderTotalServiceChargeMoney.amount) : null
      
      const orderTotalCardSurchargeMoney = order.totalCardSurchargeMoney || order.total_card_surcharge_money || {}
      const orderTotalCardSurchargeAmount = orderTotalCardSurchargeMoney.amount ? Number(orderTotalCardSurchargeMoney.amount) : null

      const catalogVersion = item.catalogVersion || item.catalog_version
      const catalogVersionNum = catalogVersion ? (typeof catalogVersion === 'bigint' ? Number(catalogVersion) : Number(catalogVersion)) : null

      const lineItemData = {
        id: require('crypto').randomUUID(),
        order_id: orderUuid,
        organization_id: organizationId,
        location_id: locationId,
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
        variation_total_price_money_amount: variationTotalPriceAmount,
        variation_total_price_money_currency: variationTotalPriceMoney.currency || 'USD',
        total_service_charge_money_amount: totalServiceChargeAmount,
        total_service_charge_money_currency: totalServiceChargeMoney.currency || 'USD',
        total_card_surcharge_money_amount: totalCardSurchargeAmount,
        total_card_surcharge_money_currency: totalCardSurchargeMoney.currency || 'USD',
        
        order_state: orderState || order.state || null,
        order_version: order.version ? Number(order.version) : null,
        order_created_at: orderCreatedAt,
        order_updated_at: orderUpdatedAt,
        order_closed_at: order.closedAt ? new Date(order.closedAt) : (order.closed_at ? new Date(order.closed_at) : null),
        
        order_total_tax_money_amount: orderTotalTaxAmount,
        order_total_tax_money_currency: orderTotalTaxMoney.currency || 'USD',
        order_total_discount_money_amount: orderTotalDiscountAmount,
        order_total_discount_money_currency: orderTotalDiscountMoney.currency || 'USD',
        order_total_tip_money_amount: orderTotalTipAmount,
        order_total_tip_money_currency: orderTotalTipMoney.currency || 'USD',
        order_total_money_amount: orderTotalAmount,
        order_total_money_currency: orderTotalMoney.currency || 'USD',
        order_total_service_charge_money_amount: orderTotalServiceChargeAmount,
        order_total_service_charge_money_currency: orderTotalServiceChargeMoney.currency || 'USD',
        order_total_card_surcharge_money_amount: orderTotalCardSurchargeAmount,
        order_total_card_surcharge_money_currency: orderTotalCardSurchargeMoney.currency || 'USD',
        
        raw_json: convertBigIntToString(item),
      }
      
      // Try UPDATE first, then INSERT if not found
      const updateResult = await prisma.$executeRaw`
        UPDATE order_line_items
        SET 
          order_id = ${lineItemData.order_id}::uuid,
          location_id = ${lineItemData.location_id},
          customer_id = ${lineItemData.customer_id},
          name = ${lineItemData.name},
          quantity = ${lineItemData.quantity},
          item_type = ${lineItemData.item_type},
          variation_name = ${lineItemData.variation_name},
          service_variation_id = ${lineItemData.service_variation_id},
          catalog_version = ${lineItemData.catalog_version},
          base_price_money_amount = ${lineItemData.base_price_money_amount},
          base_price_money_currency = ${lineItemData.base_price_money_currency},
          gross_sales_money_amount = ${lineItemData.gross_sales_money_amount},
          gross_sales_money_currency = ${lineItemData.gross_sales_money_currency},
          total_tax_money_amount = ${lineItemData.total_tax_money_amount},
          total_tax_money_currency = ${lineItemData.total_tax_money_currency},
          total_discount_money_amount = ${lineItemData.total_discount_money_amount},
          total_discount_money_currency = ${lineItemData.total_discount_money_currency},
          total_money_amount = ${lineItemData.total_money_amount},
          total_money_currency = ${lineItemData.total_money_currency},
          variation_total_price_money_amount = ${lineItemData.variation_total_price_money_amount},
          variation_total_price_money_currency = ${lineItemData.variation_total_price_money_currency},
          total_service_charge_money_amount = ${lineItemData.total_service_charge_money_amount},
          total_service_charge_money_currency = ${lineItemData.total_service_charge_money_currency},
          total_card_surcharge_money_amount = ${lineItemData.total_card_surcharge_money_amount},
          total_card_surcharge_money_currency = ${lineItemData.total_card_surcharge_money_currency},
          order_state = ${lineItemData.order_state},
          order_version = ${lineItemData.order_version},
          order_created_at = ${lineItemData.order_created_at},
          order_updated_at = ${lineItemData.order_updated_at},
          order_closed_at = ${lineItemData.order_closed_at},
          order_total_tax_money_amount = ${lineItemData.order_total_tax_money_amount},
          order_total_tax_money_currency = ${lineItemData.order_total_tax_money_currency},
          order_total_discount_money_amount = ${lineItemData.order_total_discount_money_amount},
          order_total_discount_money_currency = ${lineItemData.order_total_discount_money_currency},
          order_total_tip_money_amount = ${lineItemData.order_total_tip_money_amount},
          order_total_tip_money_currency = ${lineItemData.order_total_tip_money_currency},
          order_total_money_amount = ${lineItemData.order_total_money_amount},
          order_total_money_currency = ${lineItemData.order_total_money_currency},
          order_total_service_charge_money_amount = ${lineItemData.order_total_service_charge_money_amount},
          order_total_service_charge_money_currency = ${lineItemData.order_total_service_charge_money_currency},
          order_total_card_surcharge_money_amount = ${lineItemData.order_total_card_surcharge_money_amount},
          order_total_card_surcharge_money_currency = ${lineItemData.order_total_card_surcharge_money_currency},
          raw_json = COALESCE(${JSON.stringify(lineItemData.raw_json)}::jsonb, order_line_items.raw_json),
          updated_at = NOW()
        WHERE organization_id = ${organizationId}::uuid
          AND uid = ${itemUid}
      `
      
      if (updateResult === 0) {
        try {
          await prisma.orderLineItem.create({
            data: lineItemData
          })
        } catch (createError) {
          // Fallback to raw SQL insert
          await prisma.$executeRaw`
            INSERT INTO order_line_items (
              id, order_id, organization_id, location_id, customer_id, uid,
              service_variation_id, catalog_version, quantity, name, variation_name, item_type,
              base_price_money_amount, base_price_money_currency,
              gross_sales_money_amount, gross_sales_money_currency,
              total_tax_money_amount, total_tax_money_currency,
              total_discount_money_amount, total_discount_money_currency,
              total_money_amount, total_money_currency,
              variation_total_price_money_amount, variation_total_price_money_currency,
              total_service_charge_money_amount, total_service_charge_money_currency,
              total_card_surcharge_money_amount, total_card_surcharge_money_currency,
              order_state, order_version, order_created_at, order_updated_at, order_closed_at,
              order_total_tax_money_amount, order_total_tax_money_currency,
              order_total_discount_money_amount, order_total_discount_money_currency,
              order_total_tip_money_amount, order_total_tip_money_currency,
              order_total_money_amount, order_total_money_currency,
              order_total_service_charge_money_amount, order_total_service_charge_money_currency,
              order_total_card_surcharge_money_amount, order_total_card_surcharge_money_currency,
              raw_json, created_at, updated_at
            ) VALUES (
              gen_random_uuid(), ${lineItemData.order_id}::uuid, ${lineItemData.organization_id}::uuid,
              ${lineItemData.location_id}, ${lineItemData.customer_id}, ${lineItemData.uid},
              ${lineItemData.service_variation_id}, ${lineItemData.catalog_version},
              ${lineItemData.quantity}, ${lineItemData.name}, ${lineItemData.variation_name}, ${lineItemData.item_type},
              ${lineItemData.base_price_money_amount}, ${lineItemData.base_price_money_currency},
              ${lineItemData.gross_sales_money_amount}, ${lineItemData.gross_sales_money_currency},
              ${lineItemData.total_tax_money_amount}, ${lineItemData.total_tax_money_currency},
              ${lineItemData.total_discount_money_amount}, ${lineItemData.total_discount_money_currency},
              ${lineItemData.total_money_amount}, ${lineItemData.total_money_currency},
              ${lineItemData.variation_total_price_money_amount}, ${lineItemData.variation_total_price_money_currency},
              ${lineItemData.total_service_charge_money_amount}, ${lineItemData.total_service_charge_money_currency},
              ${lineItemData.total_card_surcharge_money_amount}, ${lineItemData.total_card_surcharge_money_currency},
              ${lineItemData.order_state}, ${lineItemData.order_version},
              ${lineItemData.order_created_at}, ${lineItemData.order_updated_at}, ${lineItemData.order_closed_at},
              ${lineItemData.order_total_tax_money_amount}, ${lineItemData.order_total_tax_money_currency},
              ${lineItemData.order_total_discount_money_amount}, ${lineItemData.order_total_discount_money_currency},
              ${lineItemData.order_total_tip_money_amount}, ${lineItemData.order_total_tip_money_currency},
              ${lineItemData.order_total_money_amount}, ${lineItemData.order_total_money_currency},
              ${lineItemData.order_total_service_charge_money_amount}, ${lineItemData.order_total_service_charge_money_currency},
              ${lineItemData.order_total_card_surcharge_money_amount}, ${lineItemData.order_total_card_surcharge_money_currency},
              ${JSON.stringify(lineItemData.raw_json)}::jsonb, NOW(), NOW()
            )
          `
        }
      }
      lineItemsSaved++
    } catch (itemError) {
      console.error(`   ❌ Error saving line item ${itemUid}: ${itemError.message}`)
      lineItemsSkipped++
    }
  }

  return { success: true, lineItemsSaved, lineItemsSkipped, state: orderState }
}

async function backfillOrders(year) {
  const startDate = new Date(`${year}-01-01T00:00:00Z`)
  const endDate = new Date(`${year}-12-31T23:59:59Z`)
  const beginTime = startDate.toISOString()
  const endTime = endDate.toISOString()

  console.log(`\n🔄 Backfilling ${year} Orders\n`)
  console.log(`   Start: ${startDate.toISOString()}`)
  console.log(`   End:   ${endDate.toISOString()}`)
  console.log('='.repeat(60))

  const locations = await prisma.$queryRaw`
    SELECT square_location_id, organization_id, name
    FROM locations
    WHERE square_location_id IS NOT NULL
  `
  
  if (!locations || locations.length === 0) {
    console.error('❌ No locations found in database')
    return { total: 0, successful: 0, failed: 0 }
  }

  const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)
  let totalOrders = 0
  let processedOrders = 0
  let successfulOrders = 0
  let failedOrders = 0
  const statesCount = { COMPLETED: 0, CANCELED: 0, OPEN: 0, OTHER: 0 }

  for (const locationId of locationIds) {
    console.log(`\n📡 Fetching orders for location: ${locationId}...`)
    
    let cursor = null
    let locationOrderCount = 0

    do {
      const searchRequest = {
        query: {
          filter: {
            dateTimeFilter: {
              createdAt: {
                startAt: beginTime,
                endAt: endTime
              }
            },
            stateFilter: {
              states: ['OPEN', 'COMPLETED', 'CANCELED']
            }
          }
        },
        locationIds: [locationId],
        limit: 100
      }
      
      if (cursor) {
        searchRequest.cursor = cursor
      }

      let response
      try {
        response = await ordersApi.searchOrders(searchRequest)
      } catch (apiError) {
        console.error(`❌ Error fetching orders for location ${locationId}:`, apiError.message)
        break
      }

      const orders = response.result?.orders || []
      cursor = response.result?.cursor
      locationOrderCount += orders.length
      totalOrders += orders.length

      if (locationOrderCount % 500 === 0 || orders.length < 100) {
        console.log(`   ✅ Found ${orders.length} orders in this batch (Total for location: ${locationOrderCount})`)
      }

      // Process orders in parallel batches for speed
      const BATCH_SIZE = 20 // Process 20 orders in parallel
      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE)
        
        const batchResults = await Promise.all(
          batch.map(async (order) => {
            try {
              const result = await processOrder(order)
              return { success: result.success, state: result.state || 'OTHER', orderId: order.id }
            } catch (error) {
              console.error(`   ❌ Error processing order ${order.id}: ${error.message}`)
              return { success: false, state: 'OTHER', orderId: order.id }
            }
          })
        )

        for (const result of batchResults) {
          processedOrders++
          if (result.success) {
            successfulOrders++
            const state = result.state
            if (statesCount[state] !== undefined) {
              statesCount[state]++
            } else {
              statesCount.OTHER++
            }
          } else {
            failedOrders++
          }
        }

        if (processedOrders % 200 === 0) {
          console.log(`   Progress: ${processedOrders} processed (${successfulOrders} successful, ${failedOrders} failed)`)
        }

        // Small delay between batches to avoid overwhelming the database
        if (i + BATCH_SIZE < orders.length) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }

      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    } while (cursor)

    console.log(`   ✅ Processed ${locationOrderCount} orders for location ${locationId}`)
    
    if (locationIds.indexOf(locationId) < locationIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(`\n📊 ${year} Summary:`)
  console.log(`   Total orders fetched: ${totalOrders}`)
  console.log(`   Orders processed: ${processedOrders}`)
  console.log(`   ✅ Successful: ${successfulOrders}`)
  console.log(`   ❌ Failed: ${failedOrders}`)
  console.log(`\n   By state:`)
  console.log(`      COMPLETED: ${statesCount.COMPLETED}`)
  console.log(`      CANCELED: ${statesCount.CANCELED}`)
  console.log(`      OPEN: ${statesCount.OPEN}`)
  console.log(`      OTHER: ${statesCount.OTHER}`)

  return { total: processedOrders, successful: successfulOrders, failed: failedOrders }
}

async function main() {
  console.log('🚀 Starting backfill for 2023 and 2024\n')
  
  const results2023 = await backfillOrders(2023)
  const results2024 = await backfillOrders(2024)

  console.log('\n' + '='.repeat(60))
  console.log('\n📊 FINAL SUMMARY:\n')
  console.log('2023:')
  console.log(`   Total: ${results2023.total}`)
  console.log(`   Successful: ${results2023.successful}`)
  console.log(`   Failed: ${results2023.failed}`)
  console.log('\n2024:')
  console.log(`   Total: ${results2024.total}`)
  console.log(`   Successful: ${results2024.successful}`)
  console.log(`   Failed: ${results2024.failed}`)

  await prisma.$disconnect()
}

main()
  .then(() => {
    console.log('\n✅ Backfill completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Backfill failed:', error)
    console.error('   Stack:', error.stack)
    process.exit(1)
  })

