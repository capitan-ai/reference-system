#!/usr/bin/env node
/**
 * Retry failed orders and create a review report
 * Identifies orders that need manual review vs retry
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const fs = require('fs')
const path = require('path')

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

async function retryAndReview() {
  console.log('🔄 Retrying Failed Orders and Creating Review Report\n')
  console.log('='.repeat(60))

  try {
    // Get all orders without line items
    const ordersWithoutLineItems = await prisma.$queryRaw`
      SELECT DISTINCT 
        o.order_id, 
        o.id as order_uuid, 
        o.organization_id,
        o.state,
        o.created_at,
        o.raw_json->>'created_at' as square_created_at
      FROM orders o
      WHERE o.id NOT IN (
        SELECT DISTINCT order_id 
        FROM order_line_items
        WHERE order_id IS NOT NULL
      )
      AND o.order_id IS NOT NULL
      ORDER BY o.created_at DESC
    `

    console.log(`📊 Found ${ordersWithoutLineItems.length} orders without line items\n`)
    console.log(`🔄 Checking each order from Square API...\n`)

    const results = {
      retrySuccess: [],
      retryFailed: [],
      noLineItems: [],
      notFound: [],
      apiErrors: []
    }

    let processed = 0
    const BATCH_SIZE = 50

    for (let i = 0; i < ordersWithoutLineItems.length; i += BATCH_SIZE) {
      const batch = ordersWithoutLineItems.slice(i, i + BATCH_SIZE)
      
      const batchResults = await Promise.all(
        batch.map(async (order) => {
          try {
            const orderResponse = await ordersApi.retrieveOrder(order.order_id)
            const squareOrder = orderResponse.result?.order
            
            if (!squareOrder) {
              return {
                orderId: order.order_id,
                status: 'not_found',
                state: order.state,
                created_at: order.square_created_at || order.created_at,
                lineItemsCount: 0
              }
            }

            const lineItems = squareOrder.lineItems || squareOrder.line_items || []
            
            if (lineItems.length === 0) {
              return {
                orderId: order.order_id,
                status: 'no_line_items',
                state: squareOrder.state || order.state,
                created_at: squareOrder.createdAt || squareOrder.created_at || order.square_created_at || order.created_at,
                lineItemsCount: 0,
                orderType: squareOrder.tenders?.length > 0 ? 'has_tenders' : 'no_tenders'
              }
            }

            // Order has line items - try to backfill
            const locationId = squareOrder.locationId || squareOrder.location_id || null
            const customerId = squareOrder.customerId || squareOrder.customer_id || null
            const orderState = squareOrder.state || null
            const orderCreatedAt = squareOrder.createdAt ? new Date(squareOrder.createdAt) : (squareOrder.created_at ? new Date(squareOrder.created_at) : new Date())
            const orderUpdatedAt = squareOrder.updatedAt ? new Date(squareOrder.updatedAt) : (squareOrder.updated_at ? new Date(squareOrder.updated_at) : new Date())
            const orderClosedAt = squareOrder.closedAt ? new Date(squareOrder.closedAt) : (squareOrder.closed_at ? new Date(squareOrder.closed_at) : null)

            const orderTotalTaxMoney = squareOrder.totalTaxMoney || squareOrder.total_tax_money || {}
            const orderTotalTaxAmount = orderTotalTaxMoney.amount ? Number(orderTotalTaxMoney.amount) : null
            const orderTotalDiscountMoney = squareOrder.totalDiscountMoney || squareOrder.total_discount_money || {}
            const orderTotalDiscountAmount = orderTotalDiscountMoney.amount ? Number(orderTotalDiscountMoney.amount) : null
            const orderTotalTipMoney = squareOrder.totalTipMoney || squareOrder.total_tip_money || {}
            const orderTotalTipAmount = orderTotalTipMoney.amount ? Number(orderTotalTipMoney.amount) : null
            const orderTotalMoney = squareOrder.totalMoney || squareOrder.total_money || {}
            const orderTotalAmount = orderTotalMoney.amount ? Number(orderTotalMoney.amount) : null
            const orderTotalServiceChargeMoney = squareOrder.totalServiceChargeMoney || squareOrder.total_service_charge_money || {}
            const orderTotalServiceChargeAmount = orderTotalServiceChargeMoney.amount ? Number(orderTotalServiceChargeMoney.amount) : null
            const orderTotalCardSurchargeMoney = squareOrder.totalCardSurchargeMoney || squareOrder.total_card_surcharge_money || {}
            const orderTotalCardSurchargeAmount = orderTotalCardSurchargeMoney.amount ? Number(orderTotalCardSurchargeMoney.amount) : null

            let saved = 0
            let errors = []

            for (const item of lineItems) {
              const itemUid = item.uid || null
              if (!itemUid) {
                continue
              }

              try {
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

                const catalogVersion = item.catalogVersion || item.catalog_version
                const catalogVersionNum = catalogVersion ? (typeof catalogVersion === 'bigint' ? Number(catalogVersion) : Number(catalogVersion)) : null

                const lineItemData = {
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
                  order_closed_at: orderClosedAt,
                  
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
                      ${lineItemData.order_total_money_amount}, ${lineItemData.total_money_currency},
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
                      order_updated_at = EXCLUDED.updated_at,
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
                  errors.push({ itemUid, error: itemError.message })
                }
              } catch (itemError) {
                errors.push({ itemUid: item.uid || 'unknown', error: itemError.message })
              }
            }

            if (saved > 0) {
              return {
                orderId: order.order_id,
                status: 'retry_success',
                state: orderState,
                created_at: squareOrder.createdAt || squareOrder.created_at || order.square_created_at || order.created_at,
                lineItemsCount: lineItems.length,
                savedCount: saved,
                errors: errors.length > 0 ? errors : null
              }
            } else {
              return {
                orderId: order.order_id,
                status: 'retry_failed',
                state: orderState,
                created_at: squareOrder.createdAt || squareOrder.created_at || order.square_created_at || order.created_at,
                lineItemsCount: lineItems.length,
                errors: errors
              }
            }

          } catch (apiError) {
            return {
              orderId: order.order_id,
              status: 'api_error',
              state: order.state,
              created_at: order.square_created_at || order.created_at,
              lineItemsCount: 0,
              error: apiError.message
            }
          }
        })
      )

      for (const result of batchResults) {
        processed++
        if (result.status === 'retry_success') {
          results.retrySuccess.push(result)
        } else if (result.status === 'retry_failed') {
          results.retryFailed.push(result)
        } else if (result.status === 'no_line_items') {
          results.noLineItems.push(result)
        } else if (result.status === 'not_found') {
          results.notFound.push(result)
        } else if (result.status === 'api_error') {
          results.apiErrors.push(result)
        }
      }

      if (processed % 100 === 0 || processed === ordersWithoutLineItems.length) {
        console.log(`   Progress: ${processed}/${ordersWithoutLineItems.length}`)
        console.log(`     ✅ Retry Success: ${results.retrySuccess.length}`)
        console.log(`     ❌ Retry Failed: ${results.retryFailed.length}`)
        console.log(`     ⚠️  No Line Items: ${results.noLineItems.length}`)
        console.log(`     🔍 Not Found: ${results.notFound.length}`)
        console.log(`     ⚠️  API Errors: ${results.apiErrors.length}\n`)
      }

      // Delay to avoid rate limiting
      if (i + BATCH_SIZE < ordersWithoutLineItems.length) {
        await new Promise(resolve => setTimeout(resolve, 150))
      }
    }

    // Generate report
    const report = {
      summary: {
        totalProcessed: processed,
        retrySuccess: results.retrySuccess.length,
        retryFailed: results.retryFailed.length,
        noLineItems: results.noLineItems.length,
        notFound: results.notFound.length,
        apiErrors: results.apiErrors.length,
        totalLineItemsAdded: results.retrySuccess.reduce((sum, r) => sum + (r.savedCount || 0), 0)
      },
      retrySuccess: results.retrySuccess,
      retryFailed: results.retryFailed,
      noLineItems: results.noLineItems,
      notFound: results.notFound,
      apiErrors: results.apiErrors
    }

    // Save report to file
    const reportPath = path.join(__dirname, '..', 'order-retry-review-report.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 FINAL SUMMARY:\n')
    console.log(`   Total processed: ${processed}`)
    console.log(`   ✅ Retry Success: ${results.retrySuccess.length} orders`)
    console.log(`   ❌ Retry Failed: ${results.retryFailed.length} orders`)
    console.log(`   ⚠️  No Line Items (legitimate): ${results.noLineItems.length} orders`)
    console.log(`   🔍 Not Found in Square: ${results.notFound.length} orders`)
    console.log(`   ⚠️  API Errors: ${results.apiErrors.length} orders`)
    console.log(`   📦 Total Line Items Added: ${report.summary.totalLineItemsAdded}`)

    console.log(`\n📄 Detailed report saved to: ${reportPath}`)

    if (results.retryFailed.length > 0) {
      console.log(`\n⚠️  Orders that need manual review (${results.retryFailed.length}):`)
      results.retryFailed.slice(0, 10).forEach(r => {
        console.log(`   ${r.orderId} (${r.lineItemsCount} line items, state: ${r.state})`)
        if (r.errors && r.errors.length > 0) {
          console.log(`     Errors: ${r.errors[0].error}`)
        }
      })
    }

    if (results.apiErrors.length > 0) {
      console.log(`\n⚠️  Orders with API errors (${results.apiErrors.length}):`)
      results.apiErrors.slice(0, 10).forEach(r => {
        console.log(`   ${r.orderId}: ${r.error}`)
      })
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

retryAndReview()
  .then(() => {
    console.log('\n✅ Retry and review complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Retry and review failed:', error)
    process.exit(1)
  })

