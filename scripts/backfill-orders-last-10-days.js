/**
 * Backfill orders from the last 10 days
 * Fetches orders from Square API and inserts them into the database
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const crypto = require('crypto')

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
} catch (error) {
  console.error('Failed to initialize Square SDK:', error.message)
  process.exit(1)
}

// Calculate date range (last 10 days)
const endDate = new Date()
const startDate = new Date()
startDate.setDate(startDate.getDate() - 10)

// Format dates for Square API (ISO 8601)
const beginTime = startDate.toISOString()
const endTime = endDate.toISOString()

console.log('📅 Date Range:')
console.log(`   Start: ${startDate.toISOString()}`)
console.log(`   End:   ${endDate.toISOString()}`)
console.log('')

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

async function processOrder(orderFromSearch) {
  const orderId = orderFromSearch.id
  
  // Fetch full order details from Square API to get line items (same as webhook handler)
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

  // Use location_id from full order (more reliable than search result)
  const locationId = order.locationId || order.location_id || orderFromSearch.locationId || orderFromSearch.location_id || null
  const customerId = order.customerId || order.customer_id || orderFromSearch.customerId || orderFromSearch.customer_id || null
  const merchantId = order.merchantId || order.merchant_id || orderFromSearch.merchantId || orderFromSearch.merchant_id || null
  const lineItems = order.lineItems || order.line_items || []
  const orderState = order.state || orderFromSearch.state || 'OPEN'

  console.log(`   📍 Order locationId: ${locationId || 'missing'}`)
  console.log(`   📦 Order has ${lineItems.length} line items`)

  // Resolve organization_id
  const { organizationId, method } = await resolveOrganizationId(merchantId, locationId, orderId)
  
  if (!organizationId) {
    console.error(`❌ Cannot process order ${orderId}: organization_id is required but could not be resolved`)
    console.error(`   merchant_id: ${merchantId || 'missing'}`)
    console.error(`   location_id: ${locationId || 'missing'}`)
    return { success: false, reason: 'no_organization_id' }
  }

  console.log(`   ✅ Resolved organization_id via ${method}: ${organizationId.substring(0, 8)}...`)

  // IMPORTANT: The database foreign key constraint is:
  // FOREIGN KEY (location_id) REFERENCES locations(square_location_id)
  // This means location_id should be the square_location_id (string), NOT the UUID!
  // However, the Prisma schema says it's a UUID FK to locations.id
  // We'll use the square_location_id directly to satisfy the actual DB constraint
  let locationIdForOrder = null
  if (locationId) {
    // Verify location exists in database
    try {
      const locationRecord = await prisma.$queryRaw`
        SELECT square_location_id FROM locations 
        WHERE square_location_id = ${locationId}
        LIMIT 1
      `
      if (locationRecord && locationRecord.length > 0) {
        locationIdForOrder = locationId
        console.log(`   ✅ Location exists: ${locationId}`)
      } else {
        // Location doesn't exist - create it
        try {
          await prisma.location.create({
            data: {
              organization_id: organizationId,
              square_location_id: locationId,
              name: `Location ${locationId.substring(0, 8)}...`
            }
          })
          locationIdForOrder = locationId
          console.log(`   ✅ Created location: ${locationId}`)
        } catch (createErr) {
          console.warn(`   ⚠️ Could not create location: ${createErr.message}`)
        }
      }
    } catch (err) {
      console.warn(`   ⚠️ Could not verify location: ${err.message}`)
    }
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

  // Save/update the order
  let orderUuid = null
  try {
    // Convert BigInt values to strings for JSON serialization
    const orderJson = convertBigIntToString(order)
    
    // Insert order - location_id should be square_location_id (string), not UUID
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
        ${order.createdAt ? new Date(order.createdAt) : (order.created_at ? new Date(order.created_at) : new Date())},
        ${order.updatedAt ? new Date(order.updatedAt) : (order.updated_at ? new Date(order.updated_at) : new Date())},
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
    console.log(`   ✅ Saved order ${orderId} (state: ${orderState})`)
  } catch (orderError) {
    console.error(`   ❌ Error saving order: ${orderError.message}`)
    return { success: false, reason: 'order_save_error', error: orderError.message }
  }

  // Get order UUID for line items (need the internal UUID, not order_id)
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

  if (!orderUuid) {
    console.error(`   ❌ Cannot save line items: order UUID not found`)
    return { success: false, reason: 'no_order_uuid' }
  }

  // Process line items
  let lineItemsSaved = 0
  let lineItemsSkipped = 0
  
  for (const item of lineItems) {
    const itemUid = item.uid || null
    if (!itemUid) {
      console.warn(`   ⚠️ Skipping line item without uid`)
      lineItemsSkipped++
      continue
    }

    try {
      // Extract money amounts (convert BigInt to Number if needed) - same as webhook handler
      const basePriceMoney = item.basePriceMoney || item.base_price_money || {}
      const basePriceAmount = basePriceMoney.amount 
        ? (typeof basePriceMoney.amount === 'bigint' ? Number(basePriceMoney.amount) : parseInt(basePriceMoney.amount))
        : null
      
      const totalMoney = item.totalMoney || item.total_money || {}
      const totalAmount = totalMoney.amount
        ? (typeof totalMoney.amount === 'bigint' ? Number(totalMoney.amount) : parseInt(totalMoney.amount))
        : null
      
      const grossSalesMoney = item.grossSalesMoney || item.gross_sales_money || {}
      const grossSalesAmount = grossSalesMoney.amount
        ? (typeof grossSalesMoney.amount === 'bigint' ? Number(grossSalesMoney.amount) : parseInt(grossSalesMoney.amount))
        : null
      
      const totalTaxMoney = item.totalTaxMoney || item.total_tax_money || {}
      const totalTaxAmount = totalTaxMoney.amount
        ? (typeof totalTaxMoney.amount === 'bigint' ? Number(totalTaxMoney.amount) : parseInt(totalTaxMoney.amount))
        : 0
      
      const totalDiscountMoney = item.totalDiscountMoney || item.total_discount_money || {}
      const totalDiscountAmount = totalDiscountMoney.amount
        ? (typeof totalDiscountMoney.amount === 'bigint' ? Number(totalDiscountMoney.amount) : parseInt(totalDiscountMoney.amount))
        : 0
      
      const variationTotalPriceMoney = item.variationTotalPriceMoney || item.variation_total_price_money || {}
      const variationTotalPriceAmount = variationTotalPriceMoney.amount
        ? (typeof variationTotalPriceMoney.amount === 'bigint' ? Number(variationTotalPriceMoney.amount) : parseInt(variationTotalPriceMoney.amount))
        : null
      
      const totalServiceChargeMoney = item.totalServiceChargeMoney || item.total_service_charge_money || {}
      const totalServiceChargeAmount = totalServiceChargeMoney.amount
        ? (typeof totalServiceChargeMoney.amount === 'bigint' ? Number(totalServiceChargeMoney.amount) : parseInt(totalServiceChargeMoney.amount))
        : 0
      
      const totalCardSurchargeMoney = item.totalCardSurchargeMoney || item.total_card_surcharge_money || {}
      const totalCardSurchargeAmount = totalCardSurchargeMoney.amount
        ? (typeof totalCardSurchargeMoney.amount === 'bigint' ? Number(totalCardSurchargeMoney.amount) : parseInt(totalCardSurchargeMoney.amount))
        : 0
      
      // Order-level money fields
      const orderTotalTaxMoney = order.totalTaxMoney || order.total_tax_money || {}
      const orderTotalTaxAmount = orderTotalTaxMoney.amount
        ? (typeof orderTotalTaxMoney.amount === 'bigint' ? Number(orderTotalTaxMoney.amount) : parseInt(orderTotalTaxMoney.amount))
        : null
      
      const orderTotalDiscountMoney = order.totalDiscountMoney || order.total_discount_money || {}
      const orderTotalDiscountAmount = orderTotalDiscountMoney.amount
        ? (typeof orderTotalDiscountMoney.amount === 'bigint' ? Number(orderTotalDiscountMoney.amount) : parseInt(orderTotalDiscountMoney.amount))
        : null
      
      const orderTotalTipMoney = order.totalTipMoney || order.total_tip_money || {}
      const orderTotalTipAmount = orderTotalTipMoney.amount
        ? (typeof orderTotalTipMoney.amount === 'bigint' ? Number(orderTotalTipMoney.amount) : parseInt(orderTotalTipMoney.amount))
        : null
      
      const orderTotalMoney = order.totalMoney || order.total_money || {}
      const orderTotalAmount = orderTotalMoney.amount
        ? (typeof orderTotalMoney.amount === 'bigint' ? Number(orderTotalMoney.amount) : parseInt(orderTotalMoney.amount))
        : null
      
      const orderTotalServiceChargeMoney = order.totalServiceChargeMoney || order.total_service_charge_money || {}
      const orderTotalServiceChargeAmount = orderTotalServiceChargeMoney.amount
        ? (typeof orderTotalServiceChargeMoney.amount === 'bigint' ? Number(orderTotalServiceChargeMoney.amount) : parseInt(orderTotalServiceChargeMoney.amount))
        : null
      
      const orderTotalCardSurchargeMoney = order.totalCardSurchargeMoney || order.total_card_surcharge_money || {}
      const orderTotalCardSurchargeAmount = orderTotalCardSurchargeMoney.amount
        ? (typeof orderTotalCardSurchargeMoney.amount === 'bigint' ? Number(orderTotalCardSurchargeMoney.amount) : parseInt(orderTotalCardSurchargeMoney.amount))
        : null
      
      const catalogVersion = item.catalogVersion || item.catalog_version
      const catalogVersionBigInt = catalogVersion ? BigInt(catalogVersion) : null
      
      // Build complete line item data (matching webhook handler)
      const lineItemData = {
        order_id: orderUuid,
        organization_id: organizationId,
        location_id: locationIdForOrder, // square_location_id
        customer_id: customerId || null,
        uid: itemUid,
        service_variation_id: item.catalogObjectId || item.catalog_object_id || item.metadata?.serviceVariationId || item.metadata?.service_variation_id || null,
        catalog_version: catalogVersionBigInt,
        quantity: item.quantity ? String(item.quantity) : null,
        name: item.name || null,
        variation_name: item.variationName || item.variation_name || null,
        item_type: item.itemType || item.item_type || null,
        
        // Money fields
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
        
        // Order-level fields
        order_state: orderState || order.state || null,
        order_version: order.version ? Number(order.version) : null,
        order_created_at: order.createdAt ? new Date(order.createdAt) : (order.created_at ? new Date(order.created_at) : null),
        order_updated_at: order.updatedAt ? new Date(order.updatedAt) : (order.updated_at ? new Date(order.updated_at) : null),
        order_closed_at: order.closedAt ? new Date(order.closedAt) : (order.closed_at ? new Date(order.closed_at) : null),
        
        // Order totals
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
        
        // Raw JSON
        raw_json: convertBigIntToString(item),
      }
      
      // Try UPDATE first, then INSERT if not found (same as webhook handler)
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
      
      // If no rows updated, insert new record using Prisma create
      if (updateResult === 0) {
        try {
          await prisma.orderLineItem.create({
            data: lineItemData
          })
        } catch (createError) {
          // If create fails, log the error but don't fail the whole process
          console.error(`   ⚠️ Error creating line item (will try raw insert): ${createError.message}`)
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

  if (lineItems.length > 0) {
    console.log(`   ✅ Saved ${lineItemsSaved} line items (${lineItemsSkipped} skipped)`)
  }

  return { success: true, lineItemsSaved, lineItemsSkipped }
}

async function backfillOrders() {
  console.log('🔄 Backfilling Orders from Last 10 Days\n')
  console.log('='.repeat(60))

  // First, get all locations from database
  console.log('\n📋 Step 1: Fetching locations from database...')
  const locations = await prisma.$queryRaw`
    SELECT square_location_id, organization_id, name
    FROM locations
    WHERE square_location_id IS NOT NULL
  `
  
  if (!locations || locations.length === 0) {
    console.error('❌ No locations found in database')
    console.error('   Please ensure locations are synced first')
    return
  }

  console.log(`   ✅ Found ${locations.length} location(s)`)
  const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)
  console.log(`   Location IDs: ${locationIds.join(', ')}`)

  let totalOrders = 0
  let processedOrders = 0
  let successfulOrders = 0
  let failedOrders = 0

  try {
    // Search orders for each location
    for (const locationId of locationIds) {
      console.log(`\n📡 Fetching orders for location: ${locationId}...`)
      
      let cursor = null
      let locationOrderCount = 0

      do {
        // Search orders using searchOrders API
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
          if (apiError.errors) {
            console.error('Square API errors:', JSON.stringify(apiError.errors, null, 2))
          }
          break
        }

        const orders = response.result?.orders || []
        cursor = response.result?.cursor

        console.log(`   ✅ Found ${orders.length} orders in this batch`)
        locationOrderCount += orders.length
        totalOrders += orders.length

        // Process each order
        for (const order of orders) {
          processedOrders++
          console.log(`\n[${processedOrders}/${totalOrders}] Processing order: ${order.id}`)
          
          const result = await processOrder(order)
          
          if (result.success) {
            successfulOrders++
          } else {
            failedOrders++
            console.error(`   ❌ Failed: ${result.reason}`)
          }

          // Small delay to avoid overwhelming the database
          await new Promise(resolve => setTimeout(resolve, 50))
        }

        // Delay between batches
        if (cursor) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      } while (cursor)

      console.log(`   ✅ Processed ${locationOrderCount} orders for location ${locationId}`)
      
      // Delay between locations
      if (locationIds.indexOf(locationId) < locationIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 Summary:')
    console.log(`   Total orders fetched: ${totalOrders}`)
    console.log(`   Orders processed: ${processedOrders}`)
    console.log(`   ✅ Successful: ${successfulOrders}`)
    console.log(`   ❌ Failed: ${failedOrders}`)
    console.log('')

  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    console.error('   Stack:', error.stack)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

backfillOrders()
  .then(() => {
    console.log('✅ Backfill completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Backfill failed:', error)
    process.exit(1)
  })

