#!/usr/bin/env node
/**
 * Backfill order_line_items table from existing orders in orders table
 * 
 * Fetches full order details from Square API for each order and saves line items
 * 
 * Usage:
 *   node scripts/backfill-order-line-items.js [limit] [offset]
 * 
 * Example:
 *   node scripts/backfill-order-line-items.js 50 0
 */

const path = require('path')
const fs = require('fs')
const dotenv = require('dotenv')

const envLocalPath = path.join(__dirname, '..', '.env.local')
const envPath = path.join(__dirname, '..', '.env')

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath, override: true })
}
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false })
}

const prisma = require('../lib/prisma-client')
const { execSync } = require('child_process')
const { getSquareEnvironmentName } = require('../lib/utils/square-env')
const crypto = require('crypto')

const squareEnvName = getSquareEnvironmentName()
const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()

if (!accessToken) {
  console.error('❌ SQUARE_ACCESS_TOKEN not found in environment')
  process.exit(1)
}

// Square API base URL (production or sandbox)
const squareApiBaseUrl = squareEnvName === 'sandbox' 
  ? 'https://connect.squareupsandbox.com'
  : 'https://connect.squareup.com'

// Helper function to generate deterministic UUID from order_id + uid
function generateLineItemId(orderId, uid, index = 0) {
  // Create deterministic UUID from order_id + uid (or order_id + index if no uid)
  const uniqueString = uid ? `${orderId}-${uid}` : `${orderId}-line-${index}`
  // Use crypto to create a deterministic hash
  const hash = crypto.createHash('sha256').update(uniqueString).digest('hex')
  // Convert first 32 chars to UUID format (8-4-4-4-12)
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`
}

// Function to fetch order from Square API using HTTP request
async function fetchOrderFromSquare(orderId) {
  const url = `${squareApiBaseUrl}/v2/orders/${orderId}`
  const command = `curl -s "${url}" -H "Square-Version: 2025-10-16" -H "Authorization: Bearer ${accessToken}" -H "Content-Type: application/json"`

  try {
    const result = execSync(command, { encoding: 'utf-8', shell: true })
    const json = JSON.parse(result)

    if (json.errors && json.errors.length > 0) {
      throw new Error(`Square API errors: ${JSON.stringify(json.errors)}`)
    }

    return json.order || null
  } catch (error) {
    if (error.stdout) {
      try {
        const json = JSON.parse(error.stdout)
        if (json.errors) {
          throw new Error(`Square API errors: ${JSON.stringify(json.errors)}`)
        }
        return json.order || null
      } catch (e) {
        throw new Error(`Failed to parse response: ${error.stdout}`)
      }
    }
    throw error
  }
}

// Function to process a single order and save its line items
async function processOrder(orderId) {
  try {
    // Fetch full order details from Square API using HTTP request
    // Reference: https://developer.squareup.com/reference/square/orders-api/retrieve-order
    const order = await fetchOrderFromSquare(orderId)

    if (!order) {
      console.error(`❌ Order ${orderId} not found in Square API`)
      return { success: false, reason: 'not_found' }
    }

    // Square API returns snake_case format (line_items, location_id, customer_id)
    const lineItems = order.line_items || []

    // Debug: Log order structure
    console.log(`📋 Order ${orderId} retrieved from Square API:`)
    console.log(`   - Order ID: ${order.id}`)
    console.log(`   - State: ${order.state}`)
    console.log(`   - Has line_items field: ${!!order.line_items}`)
    console.log(`   - Line items count: ${lineItems.length}`)
    if (lineItems.length > 0) {
      console.log(`   - First line item uid: ${lineItems[0]?.uid || 'none'}`)
    }

    const locationId = order.location_id || null
    const customerId = order.customer_id || null

    if (lineItems.length === 0) {
      console.log(`   ℹ️  Order ${orderId} has no line items`)
      if (!order.line_items) {
        console.log(`   ⚠️  Order response does not contain 'line_items' field`)
        console.log(`   Available fields: ${Object.keys(order).slice(0, 15).join(', ')}`)
      } else {
        console.log(`   ℹ️  Order has line_items array but it's empty`)
      }
      return { success: true, lineItemsProcessed: 0 }
    }

    console.log(`📦 Processing order ${orderId} with ${lineItems.length} line items`)

    let processed = 0
    let errors = 0

    // Process each line item
    for (const lineItem of lineItems) {
      try {
        const lineItemData = {
          order_id: orderId,
          location_id: locationId,
          customer_id: customerId || null,
          
          uid: lineItem.uid || null,
          catalog_object_id: lineItem.catalog_object_id || null,
          catalog_version: lineItem.catalog_version ? BigInt(lineItem.catalog_version) : null,
          quantity: lineItem.quantity || null,
          name: lineItem.name || null,
          variation_name: lineItem.variation_name || null,
          item_type: lineItem.item_type || null,
          
          // Money fields (use ?? instead of || to preserve 0 values)
          base_price_money_amount: lineItem.base_price_money?.amount ?? null,
          base_price_money_currency: lineItem.base_price_money?.currency || 'USD',
          
          gross_sales_money_amount: lineItem.gross_sales_money?.amount ?? null,
          gross_sales_money_currency: lineItem.gross_sales_money?.currency || 'USD',
          
          total_tax_money_amount: lineItem.total_tax_money?.amount ?? 0,
          total_tax_money_currency: lineItem.total_tax_money?.currency || 'USD',
          
          total_discount_money_amount: lineItem.total_discount_money?.amount ?? 0,
          total_discount_money_currency: lineItem.total_discount_money?.currency || 'USD',
          
          total_money_amount: lineItem.total_money?.amount ?? null,
          total_money_currency: lineItem.total_money?.currency || 'USD',
          
          variation_total_price_money_amount: lineItem.variation_total_price_money?.amount ?? null,
          variation_total_price_money_currency: lineItem.variation_total_price_money?.currency || 'USD',
          
          total_service_charge_money_amount: lineItem.total_service_charge_money?.amount ?? 0,
          total_service_charge_money_currency: lineItem.total_service_charge_money?.currency || 'USD',
          
          total_card_surcharge_money_amount: lineItem.total_card_surcharge_money?.amount ?? 0,
          total_card_surcharge_money_currency: lineItem.total_card_surcharge_money?.currency || 'USD',
          
          // Order-level fields
          order_state: order.state || null,
          order_version: order.version || null,
          order_created_at: order.created_at ? new Date(order.created_at) : null,
          order_updated_at: order.updated_at ? new Date(order.updated_at) : null,
          order_closed_at: order.closed_at ? new Date(order.closed_at) : null,
          
          // Order totals (use ?? instead of || to preserve 0 values)
          order_total_tax_money_amount: order.total_tax_money?.amount ?? null,
          order_total_tax_money_currency: order.total_tax_money?.currency || 'USD',
          
          order_total_discount_money_amount: order.total_discount_money?.amount ?? null,
          order_total_discount_money_currency: order.total_discount_money?.currency || 'USD',
          
          order_total_tip_money_amount: order.total_tip_money?.amount ?? null,
          order_total_tip_money_currency: order.total_tip_money?.currency || 'USD',
          
          order_total_money_amount: order.total_money?.amount ?? null,
          order_total_money_currency: order.total_money?.currency || 'USD',
          
          order_total_service_charge_money_amount: order.total_service_charge_money?.amount ?? null,
          order_total_service_charge_money_currency: order.total_service_charge_money?.currency || 'USD',
          
          order_total_card_surcharge_money_amount: order.total_card_surcharge_money?.amount ?? null,
          order_total_card_surcharge_money_currency: order.total_card_surcharge_money?.currency || 'USD',
        }

        // Generate deterministic UUID from order_id + uid (or order_id + index if no uid)
        const uniqueId = generateLineItemId(orderId, lineItem.uid, processed)

        // Use deterministic UUID for upsert (this ensures no duplicates)
        await prisma.orderLineItem.upsert({
          where: { id: uniqueId },
          update: {
            ...lineItemData,
            id: uniqueId, // Keep the same ID on update
          },
          create: {
            ...lineItemData,
            id: uniqueId,
          }
        })

        processed++
      } catch (lineItemError) {
        errors++
        console.error(`   ❌ Error saving line item ${lineItem.uid || 'no-uid'}:`, lineItemError.message)
        if (lineItemError.code) {
          console.error(`      Error code: ${lineItemError.code}`)
        }
        if (lineItemError.meta) {
          console.error(`      DB meta:`, JSON.stringify(lineItemError.meta).substring(0, 200))
        }
      }
    }

    console.log(`✅ Processed order ${orderId}: ${processed} line items saved, ${errors} errors`)

    return { 
      success: true, 
      lineItemsProcessed: processed,
      lineItemsErrors: errors
    }
  } catch (error) {
    console.error(`❌ Error processing order ${orderId}:`, error.message)
    if (error.errors) {
      console.error('Square API errors:', JSON.stringify(error.errors, null, 2))
    }
    if (error.code) {
      console.error(`   Error code: ${error.code}`)
    }
    if (error.stack) {
      console.error(`   Stack trace: ${error.stack.split('\n').slice(0, 3).join('\n')}`)
    }
    return { success: false, reason: 'error', error: error.message }
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10)
  const offset = parseInt(process.argv[3] || '0', 10)

  console.log(`🔄 Backfilling order line items`)
  console.log(`   Using Square API (${squareEnvName} environment)`)
  console.log(`   Base URL: ${squareApiBaseUrl}`)
  console.log(`   Limit: ${limit}, Offset: ${offset}`)
  console.log('')

  try {
    // Get all orders from database
    const orders = await prisma.order.findMany({
      select: {
        id: true,
        location_id: true,
        customer_id: true,
        state: true,
        created_at: true,
      },
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
      skip: offset,
    })

    if (!orders || orders.length === 0) {
      console.log('ℹ️  No orders found in database')
      return
    }

    console.log(`📋 Found ${orders.length} orders to process\n`)

    let totalProcessed = 0
    let totalErrors = 0
    let totalLineItems = 0
    let notFoundCount = 0

    for (const order of orders) {
      const result = await processOrder(order.id)
      
      if (result.success) {
        totalProcessed++
        totalLineItems += result.lineItemsProcessed || 0
        totalErrors += result.lineItemsErrors || 0
      } else {
        if (result.reason === 'not_found') {
          notFoundCount++
        }
        totalErrors++
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    console.log('\n' + '='.repeat(60))
    console.log('📊 Backfill Summary:')
    console.log(`   Orders processed successfully: ${totalProcessed}`)
    console.log(`   Total line items saved: ${totalLineItems}`)
    console.log(`   Orders not found in Square: ${notFoundCount}`)
    console.log(`   Total errors: ${totalErrors}`)
    console.log('='.repeat(60))

  } catch (error) {
    console.error('❌ Fatal error during backfill:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .catch((error) => {
    console.error('❌ Backfill failed:', error)
    process.exit(1)
  })

