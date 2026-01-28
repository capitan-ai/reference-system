/**
 * Backfill line items for orders that don't have them
 * This will fetch orders from Square API and add their line items
 */

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
} catch (error) {
  console.error('Failed to initialize Square SDK:', error.message)
  process.exit(1)
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

async function processOrderForLineItems(order) {
  const orderId = order.order_id
  const organizationId = order.organization_id
  const locationId = order.location_id

  try {
    // Fetch full order details from Square API to get line items
    const orderResponse = await ordersApi.retrieveOrder(orderId)
    const fullOrder = orderResponse.result?.order

    if (!fullOrder) {
      console.warn(`   ⚠️ Order ${orderId} not found in Square API`)
      return { success: false, reason: 'order_not_found' }
    }

    const lineItems = fullOrder.lineItems || fullOrder.line_items || []
    
    if (lineItems.length === 0) {
      console.log(`   ℹ️ Order ${orderId} has no line items`)
      return { success: true, lineItemsSaved: 0, reason: 'no_line_items' }
    }

    console.log(`   📦 Order has ${lineItems.length} line items`)

    // Get order UUID
    const orderRecord = await prisma.$queryRaw`
      SELECT id FROM orders 
      WHERE order_id = ${orderId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    const orderUuid = orderRecord && orderRecord.length > 0 ? orderRecord[0].id : null
    
    if (!orderUuid) {
      console.error(`   ❌ Order UUID not found`)
      return { success: false, reason: 'no_order_uuid' }
    }

    // Process each line item (same logic as backfill-orders-last-10-days.js)
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
        // Extract all money fields (same as webhook handler)
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
        const orderTotalTaxMoney = fullOrder.totalTaxMoney || fullOrder.total_tax_money || {}
        const orderTotalTaxAmount = orderTotalTaxMoney.amount
          ? (typeof orderTotalTaxMoney.amount === 'bigint' ? Number(orderTotalTaxMoney.amount) : parseInt(orderTotalTaxMoney.amount))
          : null
        
        const orderTotalDiscountMoney = fullOrder.totalDiscountMoney || fullOrder.total_discount_money || {}
        const orderTotalDiscountAmount = orderTotalDiscountMoney.amount
          ? (typeof orderTotalDiscountMoney.amount === 'bigint' ? Number(orderTotalDiscountMoney.amount) : parseInt(orderTotalDiscountMoney.amount))
          : null
        
        const orderTotalTipMoney = fullOrder.totalTipMoney || fullOrder.total_tip_money || {}
        const orderTotalTipAmount = orderTotalTipMoney.amount
          ? (typeof orderTotalTipMoney.amount === 'bigint' ? Number(orderTotalTipMoney.amount) : parseInt(orderTotalTipMoney.amount))
          : null
        
        const orderTotalMoney = fullOrder.totalMoney || fullOrder.total_money || {}
        const orderTotalAmount = orderTotalMoney.amount
          ? (typeof orderTotalMoney.amount === 'bigint' ? Number(orderTotalMoney.amount) : parseInt(orderTotalMoney.amount))
          : null
        
        const orderTotalServiceChargeMoney = fullOrder.totalServiceChargeMoney || fullOrder.total_service_charge_money || {}
        const orderTotalServiceChargeAmount = orderTotalServiceChargeMoney.amount
          ? (typeof orderTotalServiceChargeMoney.amount === 'bigint' ? Number(orderTotalServiceChargeMoney.amount) : parseInt(orderTotalServiceChargeMoney.amount))
          : null
        
        const orderTotalCardSurchargeMoney = fullOrder.totalCardSurchargeMoney || fullOrder.total_card_surcharge_money || {}
        const orderTotalCardSurchargeAmount = orderTotalCardSurchargeMoney.amount
          ? (typeof orderTotalCardSurchargeMoney.amount === 'bigint' ? Number(orderTotalCardSurchargeMoney.amount) : parseInt(orderTotalCardSurchargeMoney.amount))
          : null
        
        const catalogVersion = item.catalogVersion || item.catalog_version
        const catalogVersionBigInt = catalogVersion ? BigInt(catalogVersion) : null
        
        const customerId = fullOrder.customerId || fullOrder.customer_id || null
        const orderState = fullOrder.state || order.state || null
        
        // Build complete line item data
        const lineItemData = {
          order_id: orderUuid,
          organization_id: organizationId,
          location_id: locationId,
          customer_id: customerId,
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
          order_state: orderState,
          order_version: fullOrder.version ? Number(fullOrder.version) : null,
          order_created_at: fullOrder.createdAt ? new Date(fullOrder.createdAt) : (fullOrder.created_at ? new Date(fullOrder.created_at) : null),
          order_updated_at: fullOrder.updatedAt ? new Date(fullOrder.updatedAt) : (fullOrder.updated_at ? new Date(fullOrder.updated_at) : null),
          order_closed_at: fullOrder.closedAt ? new Date(fullOrder.closedAt) : (fullOrder.closed_at ? new Date(fullOrder.closed_at) : null),
          
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
        
        // If no rows updated, insert new record using raw SQL (to handle BigInt)
        if (updateResult === 0) {
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
            `
          } catch (createError) {
            console.error(`   ⚠️ Error creating line item: ${createError.message}`)
            throw createError
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
  } catch (error) {
    console.error(`   ❌ Error processing order: ${error.message}`)
    return { success: false, reason: 'processing_error', error: error.message }
  }
}

async function backfillMissingLineItems() {
  console.log('🔄 Backfilling Missing Order Line Items\n')
  console.log('='.repeat(60))

  // Get all orders without line items
  console.log('\n📋 Finding orders without line items...')
  const ordersWithoutItems = await prisma.$queryRaw`
    SELECT DISTINCT o.id, o.order_id, o.organization_id, o.location_id, o.created_at
    FROM orders o
    LEFT JOIN order_line_items oli ON o.id = oli.order_id
    WHERE oli.id IS NULL
    ORDER BY o.created_at ASC
  `

  if (!ordersWithoutItems || ordersWithoutItems.length === 0) {
    console.log('✅ No orders without line items found!')
    return
  }

  console.log(`   ✅ Found ${ordersWithoutItems.length} orders without line items`)
  console.log(`   Date range: ${ordersWithoutItems[0].created_at} to ${ordersWithoutItems[ordersWithoutItems.length - 1].created_at}`)

  let processed = 0
  let successful = 0
  let failed = 0
  let totalLineItemsSaved = 0

  // Process in parallel batches for faster execution
  const BATCH_SIZE = 20 // Number of orders to process simultaneously (increased for speed)
  const DELAY_BETWEEN_BATCHES = 100 // ms delay between batches to avoid rate limiting

  try {
    for (let i = 0; i < ordersWithoutItems.length; i += BATCH_SIZE) {
      const batch = ordersWithoutItems.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(ordersWithoutItems.length / BATCH_SIZE)
      
      console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} orders)...`)
      
      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (order) => {
          processed++
          const orderNum = processed
          const total = ordersWithoutItems.length
          
          console.log(`[${orderNum}/${total}] Processing order: ${order.order_id}`)
          return await processOrderForLineItems(order)
        })
      )
      
      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            successful++
            totalLineItemsSaved += result.value.lineItemsSaved || 0
          } else {
            failed++
            if (result.value.reason !== 'no_line_items') {
              console.error(`   ❌ Failed: ${result.value.reason}`)
            }
          }
        } else {
          failed++
          console.error(`   ❌ Error: ${result.reason?.message || result.reason}`)
        }
      }
      
      // Progress update
      console.log(`   ✅ Batch ${batchNumber} complete: ${successful} successful, ${failed} failed`)
      console.log(`   📊 Progress: ${processed}/${ordersWithoutItems.length} (${Math.round(processed / ordersWithoutItems.length * 100)}%)`)
      
      // Small delay between batches to avoid overwhelming the API
      if (i + BATCH_SIZE < ordersWithoutItems.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES))
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 Summary:')
    console.log(`   Total orders processed: ${processed}`)
    console.log(`   ✅ Successful: ${successful}`)
    console.log(`   ❌ Failed: ${failed}`)
    console.log(`   📦 Total line items saved: ${totalLineItemsSaved}`)
    console.log('')

  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    console.error('   Stack:', error.stack)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

backfillMissingLineItems()
  .then(() => {
    console.log('✅ Backfill completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Backfill failed:', error)
    process.exit(1)
  })

