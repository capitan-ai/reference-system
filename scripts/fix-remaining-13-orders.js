#!/usr/bin/env node
/**
 * Fix the remaining 13 missing orders from 2026
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

async function resolveOrganizationId(merchantId, locationId, orderId) {
  let organizationId = null

  if (merchantId) {
    try {
      const org = await prisma.$queryRaw`
        SELECT id FROM organizations 
        WHERE square_merchant_id = ${merchantId}
        LIMIT 1
      `
      if (org && org.length > 0) {
        return { organizationId: org[0].id, method: 'merchant_id' }
      }
    } catch (err) {
      // Ignore
    }
  }

  if (!organizationId && locationId) {
    try {
      const loc = await prisma.$queryRaw`
        SELECT organization_id FROM locations 
        WHERE square_location_id = ${locationId}
        LIMIT 1
      `
      if (loc && loc.length > 0) {
        return { organizationId: loc[0].organization_id, method: 'location_id' }
      }
    } catch (err) {
      // Ignore
    }
  }

  if (!organizationId && orderId) {
    try {
      const existingOrder = await prisma.$queryRaw`
        SELECT organization_id FROM orders 
        WHERE order_id = ${orderId}
        LIMIT 1
      `
      if (existingOrder && existingOrder.length > 0) {
        return { organizationId: existingOrder[0].organization_id, method: 'existing_order' }
      }
    } catch (err) {
      // Ignore
    }
  }

  if (!organizationId) {
    try {
      const defaultOrg = await prisma.$queryRaw`
        SELECT id FROM organizations 
        WHERE is_active = true
        ORDER BY created_at ASC
        LIMIT 1
      `
      if (defaultOrg && defaultOrg.length > 0) {
        return { organizationId: defaultOrg[0].id, method: 'fallback' }
      }
    } catch (err) {
      // Ignore
    }
  }

  return { organizationId, method: null }
}

async function processOrder(orderId) {
  let order
  try {
    const orderResponse = await ordersApi.retrieveOrder(orderId)
    order = orderResponse.result?.order
    if (!order) {
      return { success: false, reason: 'order_not_found' }
    }
  } catch (apiError) {
    return { success: false, reason: 'api_error', error: apiError.message }
  }

  const locationId = order.locationId || order.location_id || null
  const customerId = order.customerId || order.customer_id || null
  const merchantId = order.merchantId || order.merchant_id || null
  const lineItems = order.lineItems || order.line_items || []
  const orderState = order.state || null

  const { organizationId, method } = await resolveOrganizationId(merchantId, locationId, orderId)
  
  if (!organizationId) {
    return { success: false, reason: 'no_organization_id' }
  }

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
          // Ignore
        }
      }
    } catch (err) {
      // Ignore
    }
  }

  const orderCreatedAt = order.createdAt ? new Date(order.createdAt) : (order.created_at ? new Date(order.created_at) : new Date())
  const orderUpdatedAt = order.updatedAt ? new Date(order.updatedAt) : (order.updated_at ? new Date(order.updated_at) : new Date())

  // Save or update order
  try {
    const orderJson = convertBigIntToString(order)
    
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
    return { success: false, reason: 'order_save_error', error: orderError.message }
  }

  // Get order UUID
  let orderUuid = null
  try {
    const orderRecord = await prisma.$queryRaw`
      SELECT id FROM orders 
      WHERE order_id = ${orderId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    orderUuid = orderRecord && orderRecord.length > 0 ? orderRecord[0].id : null
    if (!orderUuid) {
      return { success: false, reason: 'no_order_uuid' }
    }
  } catch (queryError) {
    return { success: false, reason: 'order_uuid_error' }
  }

  // Process line items (simplified - same logic as before)
  let lineItemsSaved = 0
  let lineItemsSkipped = 0

  for (const item of lineItems) {
    const itemUid = item.uid || null
    if (!itemUid) {
      lineItemsSkipped++
      continue
    }

    try {
      // Extract all money amounts (same as previous scripts)
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
        
        order_state: orderState,
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
      
      // Use raw SQL with ON CONFLICT
      try {
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
          ON CONFLICT (organization_id, uid) WHERE uid IS NOT NULL DO UPDATE SET
            order_id = EXCLUDED.order_id,
            location_id = EXCLUDED.location_id,
            customer_id = EXCLUDED.customer_id,
            name = EXCLUDED.name,
            quantity = EXCLUDED.quantity,
            item_type = EXCLUDED.item_type,
            variation_name = EXCLUDED.variation_name,
            service_variation_id = EXCLUDED.service_variation_id,
            catalog_version = EXCLUDED.catalog_version,
            base_price_money_amount = EXCLUDED.base_price_money_amount,
            base_price_money_currency = EXCLUDED.base_price_money_currency,
            gross_sales_money_amount = EXCLUDED.gross_sales_money_amount,
            gross_sales_money_currency = EXCLUDED.gross_sales_money_currency,
            total_tax_money_amount = EXCLUDED.total_tax_money_amount,
            total_tax_money_currency = EXCLUDED.total_tax_money_currency,
            total_discount_money_amount = EXCLUDED.total_discount_money_amount,
            total_discount_money_currency = EXCLUDED.total_discount_money_currency,
            total_money_amount = EXCLUDED.total_money_amount,
            total_money_currency = EXCLUDED.total_money_currency,
            variation_total_price_money_amount = EXCLUDED.variation_total_price_money_amount,
            variation_total_price_money_currency = EXCLUDED.variation_total_price_money_currency,
            total_service_charge_money_amount = EXCLUDED.total_service_charge_money_amount,
            total_service_charge_money_currency = EXCLUDED.total_service_charge_money_currency,
            total_card_surcharge_money_amount = EXCLUDED.total_card_surcharge_money_amount,
            total_card_surcharge_money_currency = EXCLUDED.total_card_surcharge_money_currency,
            order_state = EXCLUDED.order_state,
            order_version = EXCLUDED.order_version,
            order_created_at = EXCLUDED.order_created_at,
            order_updated_at = EXCLUDED.order_updated_at,
            order_closed_at = EXCLUDED.order_closed_at,
            order_total_tax_money_amount = EXCLUDED.order_total_tax_money_amount,
            order_total_tax_money_currency = EXCLUDED.order_total_tax_money_currency,
            order_total_discount_money_amount = EXCLUDED.order_total_discount_money_amount,
            order_total_discount_money_currency = EXCLUDED.order_total_discount_money_currency,
            order_total_tip_money_amount = EXCLUDED.order_total_tip_money_amount,
            order_total_tip_money_currency = EXCLUDED.order_total_tip_money_currency,
            order_total_money_amount = EXCLUDED.order_total_money_amount,
            order_total_money_currency = EXCLUDED.order_total_money_currency,
            order_total_service_charge_money_amount = EXCLUDED.order_total_service_charge_money_amount,
            order_total_service_charge_money_currency = EXCLUDED.order_total_service_charge_money_currency,
            order_total_card_surcharge_money_amount = EXCLUDED.order_total_card_surcharge_money_amount,
            order_total_card_surcharge_money_currency = EXCLUDED.order_total_card_surcharge_money_currency,
            raw_json = EXCLUDED.raw_json,
            updated_at = NOW()
        `
        lineItemsSaved++
      } catch (itemError) {
        lineItemsSkipped++
      }
    } catch (itemError) {
      lineItemsSkipped++
    }
  }

  return { 
    success: true, 
    lineItemsSaved, 
    lineItemsSkipped,
    hasLineItems: lineItems.length > 0
  }
}

async function fixRemaining() {
  console.log('🔧 Fixing Remaining 13 Missing Orders\n')
  console.log('='.repeat(60))

  try {
    // Get the 13 missing orders from 2026
    const startDate2026 = new Date('2026-01-01T00:00:00Z')
    const endDate2026 = new Date('2026-12-31T23:59:59Z')
    const beginTime2026 = startDate2026.toISOString()
    const endTime2026 = endDate2026.toISOString()

    const locations = await prisma.$queryRaw`
      SELECT square_location_id FROM locations WHERE square_location_id IS NOT NULL
    `
    
    const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)
    const square2026OrderIds = new Set()

    console.log('\n📡 Fetching all 2026 orders from Square API...\n')
    for (const locationId of locationIds) {
      let cursor = null
      do {
        const searchRequest = {
          query: {
            filter: {
              dateTimeFilter: {
                createdAt: {
                  startAt: beginTime2026,
                  endAt: endTime2026
                }
              },
              stateFilter: { states: ['OPEN', 'COMPLETED', 'CANCELED'] }
            }
          },
          locationIds: [locationId],
          limit: 100
        }
        if (cursor) searchRequest.cursor = cursor

        try {
          const response = await ordersApi.searchOrders(searchRequest)
          const orders = response.result?.orders || []
          cursor = response.result?.cursor

          for (const order of orders) {
            square2026OrderIds.add(order.id)
          }
        } catch (apiError) {
          console.error(`   ❌ Error fetching from location ${locationId}: ${apiError.message}`)
          break
        }
      } while (cursor)
    }

    console.log(`✅ Found ${square2026OrderIds.size} orders from Square API (2026)\n`)

    // Find missing orders
    const squareOrderIdsArray = Array.from(square2026OrderIds)
    const missingOrders = await prisma.$queryRaw`
      SELECT DISTINCT order_id
      FROM (
        SELECT unnest(${squareOrderIdsArray}::text[]) as order_id
      ) sq
      WHERE order_id NOT IN (
        SELECT order_id FROM orders WHERE order_id = ANY(${squareOrderIdsArray}::text[])
      )
    `

    console.log(`📊 Found ${missingOrders.length} missing orders\n`)

    if (missingOrders.length === 0) {
      console.log('✅ No missing orders!')
      return
    }

    console.log(`🔄 Processing ${missingOrders.length} orders...\n`)

    let successful = 0
    let failed = 0
    let skipped = 0
    let lineItemsAdded = 0

    for (const order of missingOrders) {
      const orderId = order.order_id
      try {
        const result = await processOrder(orderId)
        if (result.success) {
          successful++
          if (result.hasLineItems) {
            lineItemsAdded += result.lineItemsSaved || 0
          } else {
            skipped++
          }
        } else {
          failed++
          console.log(`   ❌ Failed: ${orderId} - ${result.reason || result.error}`)
        }
      } catch (error) {
        failed++
        console.log(`   ❌ Error: ${orderId} - ${error.message}`)
      }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 FIX SUMMARY:\n')
    console.log(`   Total orders: ${missingOrders.length}`)
    console.log(`   ✅ Successfully processed: ${successful}`)
    console.log(`   ⏭️  Skipped (no line items): ${skipped}`)
    console.log(`   ❌ Failed: ${failed}`)
    console.log(`   📦 Line items added: ${lineItemsAdded}`)

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

fixRemaining()
  .then(() => {
    console.log('\n✅ Fix complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error)
    process.exit(1)
  })



