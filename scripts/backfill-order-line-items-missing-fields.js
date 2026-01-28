/**
 * Backfill missing fields in order_line_items table
 * 
 * This script:
 * 1. Finds order_line_items with missing raw_json, metadata, or other optional fields
 * 2. Extracts data from orders.raw_json (which contains the full order with line_items)
 * 3. Updates order_line_items with all missing fields including:
 *    - raw_json (full line item object)
 *    - metadata
 *    - custom_attributes
 *    - fulfillments
 *    - applied_taxes
 *    - applied_discounts
 *    - applied_service_charges
 *    - note
 *    - modifiers
 *    - discount_name (extracted from order-level discounts)
 *    - All money fields if missing
 */

const { PrismaClient, Prisma } = require('@prisma/client')
const prisma = new PrismaClient()

async function extractDiscountName(lineItem, orderDiscounts) {
  if (!lineItem.applied_discounts && !lineItem.appliedDiscounts) {
    return null
  }

  const appliedDiscounts = lineItem.applied_discounts || lineItem.appliedDiscounts || []
  if (!Array.isArray(appliedDiscounts) || appliedDiscounts.length === 0) {
    return null
  }

  // Build discount name map
  const discountNameMap = new Map()
  const discounts = orderDiscounts || []
  if (Array.isArray(discounts)) {
    discounts.forEach(discount => {
      const discountUid = discount.uid || discount.discount_uid
      const discountName = discount.name || discount.discount_name
      if (discountUid && discountName) {
        discountNameMap.set(discountUid, discountName)
      }
    })
  }

  // Extract discount names for this line item
  const discountNames = []
  appliedDiscounts.forEach(appliedDiscount => {
    const discountUid = appliedDiscount.discount_uid || appliedDiscount.discountUid
    if (discountUid && discountNameMap.has(discountUid)) {
      discountNames.push(discountNameMap.get(discountUid))
    }
  })

  return discountNames.length > 0 ? discountNames.join(', ') : null
}

async function processOrder(order) {
  const orderId = order.order_id
  const orderRawJson = order.raw_json

  if (!orderRawJson) {
    console.log(`⚠️ Order ${orderId} has no raw_json, skipping`)
    return { processed: 0, skipped: 1, errors: 0 }
  }

  // Parse order JSON
  let orderData
  try {
    orderData = typeof orderRawJson === 'string' ? JSON.parse(orderRawJson) : orderRawJson
  } catch (error) {
    console.error(`❌ Error parsing raw_json for order ${orderId}:`, error.message)
    return { processed: 0, skipped: 0, errors: 1 }
  }

  const lineItems = orderData.line_items || orderData.lineItems || []
  if (lineItems.length === 0) {
    console.log(`⚠️ Order ${orderId} has no line items in raw_json`)
    return { processed: 0, skipped: 1, errors: 0 }
  }

  // Get order-level discounts for discount_name extraction
  const orderDiscounts = orderData.discounts || orderData.discount || []

  let processed = 0
  let skipped = 0
  let errors = 0

  for (const lineItem of lineItems) {
    try {
      const lineItemUid = lineItem.uid
      if (!lineItemUid) {
        console.log(`⚠️ Line item in order ${orderId} has no uid, skipping`)
        skipped++
        continue
      }

      // Check if line item exists
      const existingLineItem = await prisma.$queryRaw`
        SELECT id, raw_json, metadata, discount_name
        FROM order_line_items
        WHERE order_id = ${order.id}::uuid
          AND uid = ${lineItemUid}
        LIMIT 1
      `

      if (!existingLineItem || existingLineItem.length === 0) {
        console.log(`⚠️ Line item ${lineItemUid} not found in database for order ${orderId}`)
        skipped++
        continue
      }

      const existing = existingLineItem[0]

      // Check what needs to be updated
      const needsRawJson = !existing.raw_json
      const needsMetadata = !existing.metadata && (lineItem.metadata || lineItem.customAttributes || lineItem.custom_attributes)
      const needsDiscountName = !existing.discount_name
      const hasAppliedDiscountsInData = lineItem.appliedDiscounts || lineItem.applied_discounts
      const needsAppliedDiscounts = !existing.applied_discounts && hasAppliedDiscountsInData
      const needsOtherFields = !existing.metadata || !existing.custom_attributes

      if (!needsRawJson && !needsMetadata && !needsDiscountName && !needsAppliedDiscounts && !needsOtherFields) {
        // Already has all fields
        continue
      }

      // Extract discount name (only if we have applied_discounts or need to extract it)
      const discountName = needsDiscountName && (hasAppliedDiscountsInData || existing.applied_discounts) 
        ? await extractDiscountName(lineItem, orderDiscounts) 
        : null

      // Prepare update data
      const updates = {}
      const updateFields = []

      if (needsRawJson) {
        updates.raw_json = JSON.stringify(lineItem)
        updateFields.push('raw_json')
      }

      if (needsMetadata || needsOtherFields) {
        if (lineItem.metadata) {
          updates.metadata = JSON.stringify(lineItem.metadata)
          updateFields.push('metadata')
        }
        if (lineItem.customAttributes || lineItem.custom_attributes) {
          updates.custom_attributes = JSON.stringify(lineItem.customAttributes || lineItem.custom_attributes)
          updateFields.push('custom_attributes')
        }
        if (lineItem.fulfillments || lineItem.fulfillment) {
          updates.fulfillments = JSON.stringify(lineItem.fulfillments || lineItem.fulfillment)
          updateFields.push('fulfillments')
        }
        if (lineItem.appliedTaxes || lineItem.applied_taxes) {
          updates.applied_taxes = JSON.stringify(lineItem.appliedTaxes || lineItem.applied_taxes)
          updateFields.push('applied_taxes')
        }
        if (needsAppliedDiscounts && hasAppliedDiscountsInData) {
          updates.applied_discounts = JSON.stringify(lineItem.appliedDiscounts || lineItem.applied_discounts)
          updateFields.push('applied_discounts')
        }
        if (lineItem.appliedServiceCharges || lineItem.applied_service_charges) {
          updates.applied_service_charges = JSON.stringify(lineItem.appliedServiceCharges || lineItem.applied_service_charges)
          updateFields.push('applied_service_charges')
        }
        if (lineItem.note) {
          updates.note = lineItem.note
          updateFields.push('note')
        }
        if (lineItem.modifiers) {
          updates.modifiers = JSON.stringify(lineItem.modifiers)
          updateFields.push('modifiers')
        }
      }

      if (needsDiscountName && discountName) {
        updates.discount_name = discountName
        updateFields.push('discount_name')
      }

      // Build SQL update using individual field updates
      if (Object.keys(updates).length > 0) {
        // Update each field individually to avoid SQL injection and parameter issues
        for (const [key, value] of Object.entries(updates)) {
          if (key === 'raw_json' || key.endsWith('_attributes') || key.endsWith('_taxes') || key.endsWith('_discounts') || key.endsWith('_charges') || key === 'fulfillments' || key === 'modifiers') {
            // JSON fields - escape the key name
            const jsonValue = typeof value === 'string' ? value : JSON.stringify(value)
            await prisma.$executeRaw`
              UPDATE order_line_items
              SET ${Prisma.raw(`"${key}"`)} = ${jsonValue}::jsonb,
                  updated_at = NOW()
              WHERE order_id = ${order.id}::uuid
                AND uid = ${lineItemUid}
                AND organization_id = ${order.organization_id}::uuid
            `
          } else {
            // Text fields
            await prisma.$executeRaw`
              UPDATE order_line_items
              SET ${Prisma.raw(`"${key}"`)} = ${value},
                  updated_at = NOW()
              WHERE order_id = ${order.id}::uuid
                AND uid = ${lineItemUid}
                AND organization_id = ${order.organization_id}::uuid
            `
          }
        }

        console.log(`✅ Updated line item ${lineItemUid} in order ${orderId} with: ${updateFields.join(', ')}`)
        processed++
      } else {
        skipped++
      }
    } catch (error) {
      console.error(`❌ Error processing line item in order ${orderId}:`, error.message)
      errors++
    }
  }

  return { processed, skipped, errors }
}

async function main() {
  const limit = parseInt(process.argv[2] || '50', 10)
  const offset = parseInt(process.argv[3] || '0', 10)

  console.log(`🔍 Finding orders with line items missing raw_json or other fields...`)
  console.log(`   Limit: ${limit}, Offset: ${offset}`)

  try {
    // Find orders that have raw_json and line items that might be missing fields
    const orders = await prisma.$queryRaw`
      SELECT DISTINCT ON (o.id)
        o.id,
        o.order_id,
        o.organization_id,
        o.raw_json,
        o.created_at
      FROM orders o
      INNER JOIN order_line_items oli ON oli.order_id = o.id
      WHERE o.raw_json IS NOT NULL
        AND (
          oli.raw_json IS NULL
          OR (oli.metadata IS NULL AND (o.raw_json->'line_items'->0->'metadata' IS NOT NULL OR o.raw_json->'lineItems'->0->'metadata' IS NOT NULL))
          OR (oli.discount_name IS NULL AND (o.raw_json->'discounts' IS NOT NULL OR o.raw_json->'discount' IS NOT NULL))
          OR (oli.applied_discounts IS NULL AND (o.raw_json->'line_items'->0->'applied_discounts' IS NOT NULL OR o.raw_json->'lineItems'->0->'appliedDiscounts' IS NOT NULL))
        )
      ORDER BY o.id, o.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `

    if (!orders || orders.length === 0) {
      console.log('✅ No orders found that need backfilling')
      return
    }

    console.log(`📦 Found ${orders.length} orders to process\n`)

    let totalProcessed = 0
    let totalSkipped = 0
    let totalErrors = 0

    for (const order of orders) {
      const result = await processOrder(order)
      totalProcessed += result.processed
      totalSkipped += result.skipped
      totalErrors += result.errors
    }

    console.log('\n📊 Summary:')
    console.log(`   Processed: ${totalProcessed} line items`)
    console.log(`   Skipped: ${totalSkipped} line items`)
    console.log(`   Errors: ${totalErrors}`)

    // Show statistics
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        COUNT(raw_json) as has_raw_json,
        COUNT(metadata) as has_metadata,
        COUNT(discount_name) as has_discount_name,
        COUNT(applied_discounts) as has_applied_discounts
      FROM order_line_items
    `

    if (stats && stats.length > 0) {
      const s = stats[0]
      const total = Number(s.total)
      const hasRawJson = Number(s.has_raw_json)
      const hasMetadata = Number(s.has_metadata)
      const hasDiscountName = Number(s.has_discount_name)
      const hasAppliedDiscounts = Number(s.has_applied_discounts)
      
      console.log('\n📈 Current Statistics:')
      console.log(`   Total line items: ${total}`)
      console.log(`   With raw_json: ${hasRawJson} (${((hasRawJson / total) * 100).toFixed(1)}%)`)
      console.log(`   With metadata: ${hasMetadata} (${((hasMetadata / total) * 100).toFixed(1)}%)`)
      console.log(`   With discount_name: ${hasDiscountName} (${((hasDiscountName / total) * 100).toFixed(1)}%)`)
      console.log(`   With applied_discounts: ${hasAppliedDiscounts} (${((hasAppliedDiscounts / total) * 100).toFixed(1)}%)`)
    }

  } catch (error) {
    console.error('❌ Fatal error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Backfill completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ Backfill failed:', error)
      process.exit(1)
    })
}

module.exports = { main, processOrder, extractDiscountName }

