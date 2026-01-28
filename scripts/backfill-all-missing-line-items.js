#!/usr/bin/env node
/**
 * Backfill all missing line items for orders that exist in DB but don't have line items
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

async function backfillAllMissingLineItems() {
  console.log('🔄 Backfilling All Missing Line Items\n')
  console.log('='.repeat(60))

  try {
    // Get all orders from Square API for all years
    const years = [2023, 2024, 2025, 2026]
    const allSquareOrderIds = new Set()

    const locations = await prisma.$queryRaw`
      SELECT square_location_id FROM locations WHERE square_location_id IS NOT NULL
    `
    
    const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)

    console.log('\n📡 Fetching all orders from Square API...\n')
    for (const year of years) {
      const startDate = new Date(`${year}-01-01T00:00:00Z`)
      const endDate = new Date(`${year}-12-31T23:59:59Z`)
      const beginTime = startDate.toISOString()
      const endTime = endDate.toISOString()

      for (const locationId of locationIds) {
        let cursor = null
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
              allSquareOrderIds.add(order.id)
            }
          } catch (apiError) {
            console.error(`   ❌ Error fetching ${year} from location ${locationId}: ${apiError.message}`)
            break
          }
        } while (cursor)
      }
    }

    console.log(`✅ Found ${allSquareOrderIds.size} total orders from Square API\n`)

    // Find orders in DB that don't have line items
    const squareOrderIdsArray = Array.from(allSquareOrderIds)
    
    const ordersWithoutLineItems = await prisma.$queryRaw`
      SELECT DISTINCT o.order_id, o.id as order_uuid, o.organization_id
      FROM orders o
      WHERE o.order_id = ANY(${squareOrderIdsArray}::text[])
        AND o.id NOT IN (
          SELECT DISTINCT order_id 
          FROM order_line_items
        )
      ORDER BY o.order_id
    `

    console.log(`📊 Found ${ordersWithoutLineItems.length} orders without line items\n`)

    if (ordersWithoutLineItems.length === 0) {
      console.log('✅ All orders have line items!')
      return
    }

    let successful = 0
    let failed = 0
    let skipped = 0
    let lineItemsAdded = 0
    const BATCH_SIZE = 100

    console.log(`🔄 Fetching and processing orders...\n`)

    for (let i = 0; i < ordersWithoutLineItems.length; i += BATCH_SIZE) {
      const batch = ordersWithoutLineItems.slice(i, i + BATCH_SIZE)
      
      const batchResults = await Promise.all(
        batch.map(async (order) => {
          try {
            const orderResponse = await ordersApi.retrieveOrder(order.order_id)
            const squareOrder = orderResponse.result?.order
            
            if (!squareOrder) {
              return { success: false, orderId: order.order_id, reason: 'not_found' }
            }

            const lineItems = squareOrder.lineItems || squareOrder.line_items || []
            
            if (lineItems.length === 0) {
              return { success: true, orderId: order.order_id, reason: 'no_line_items', count: 0 }
            }

            const locationId = squareOrder.locationId || squareOrder.location_id || null
            const customerId = squareOrder.customerId || squareOrder.customer_id || null
            const orderState = squareOrder.state || null
            const orderCreatedAt = squareOrder.createdAt ? new Date(squareOrder.createdAt) : (squareOrder.created_at ? new Date(squareOrder.created_at) : new Date())
            const orderUpdatedAt = squareOrder.updatedAt ? new Date(squareOrder.updatedAt) : (squareOrder.updated_at ? new Date(squareOrder.updated_at) : new Date())

            let saved = 0
            let errors = 0

            for (const item of lineItems) {
              const itemUid = item.uid || null
              if (!itemUid) {
                continue
              }

              try {
                // Extract money amounts (same as previous scripts)
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

                const orderTotalTaxMoney = squareOrder.totalTaxMoney || squareOrder.total_tax_money || {}
                const orderTotalTaxAmount = orderTotalTaxMoney.amount ? Number(orderTotalTaxMoney.amount) : null
                const orderTotalDiscountMoney = squareOrder.totalDiscountMoney || order.total_discount_money || {}
                const orderTotalDiscountAmount = orderTotalDiscountMoney.amount ? Number(orderTotalDiscountMoney.amount) : null
                const orderTotalTipMoney = squareOrder.totalTipMoney || squareOrder.total_tip_money || {}
                const orderTotalTipAmount = orderTotalTipMoney.amount ? Number(orderTotalTipMoney.amount) : null
                const orderTotalMoney = squareOrder.totalMoney || squareOrder.total_money || {}
                const orderTotalAmount = orderTotalMoney.amount ? Number(orderTotalMoney.amount) : null
                const orderTotalServiceChargeMoney = squareOrder.totalServiceChargeMoney || squareOrder.total_service_charge_money || {}
                const orderTotalServiceChargeAmount = orderTotalServiceChargeMoney.amount ? Number(orderTotalServiceChargeMoney.amount) : null
                const orderTotalCardSurchargeMoney = squareOrder.totalCardSurchargeMoney || squareOrder.total_card_surcharge_money || {}
                const orderTotalCardSurchargeAmount = orderTotalCardSurchargeMoney.amount ? Number(orderTotalCardSurchargeMoney.amount) : null

                const catalogVersion = item.catalogVersion || item.catalog_version
                const catalogVersionNum = catalogVersion ? (typeof catalogVersion === 'bigint' ? Number(catalogVersion) : Number(catalogVersion)) : null

                const lineItemData = {
                  id: require('crypto').randomUUID(),
                  order_id: order.order_uuid,
                  organization_id: order.organization_id,
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
                  order_version: squareOrder.version ? Number(squareOrder.version) : null,
                  order_created_at: orderCreatedAt,
                  order_updated_at: orderUpdatedAt,
                  order_closed_at: squareOrder.closedAt ? new Date(squareOrder.closedAt) : (squareOrder.closed_at ? new Date(squareOrder.closed_at) : null),
                  
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
                  saved++
                } catch (itemError) {
                  errors++
                }
              } catch (itemError) {
                errors++
              }
            }

            return { 
              success: saved > 0 || lineItems.length === 0, 
              orderId: order.order_id, 
              saved, 
              total: lineItems.length,
              errors
            }
          } catch (error) {
            return { success: false, orderId: order.order_id, reason: 'error', error: error.message }
          }
        })
      )

      for (const result of batchResults) {
        if (result.success) {
          if (result.count === 0) {
            skipped++
          } else {
            successful++
            lineItemsAdded += result.saved || 0
          }
        } else {
          failed++
        }
      }

      if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= ordersWithoutLineItems.length) {
        console.log(`   Progress: ${Math.min(i + BATCH_SIZE, ordersWithoutLineItems.length)}/${ordersWithoutLineItems.length} (${successful} successful, ${skipped} skipped, ${failed} failed)`)
      }

      // Delay to avoid rate limiting
      if (i + BATCH_SIZE < ordersWithoutLineItems.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 BACKFILL SUMMARY:\n')
    console.log(`   Total orders processed: ${ordersWithoutLineItems.length}`)
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

backfillAllMissingLineItems()
  .then(() => {
    console.log('\n✅ Backfill complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Backfill failed:', error)
    process.exit(1)
  })



