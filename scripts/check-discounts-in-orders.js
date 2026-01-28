/**
 * Check how many orders have discounts and how many line items should have discount_name
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('🔍 Analyzing discounts in orders and line items...\n')

  try {
    // Check orders with discounts in raw_json
    const ordersWithDiscounts = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM orders
      WHERE raw_json IS NOT NULL
        AND (
          raw_json->'discounts' IS NOT NULL
          OR raw_json->'discount' IS NOT NULL
        )
    `

    const totalOrders = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM orders
      WHERE raw_json IS NOT NULL
    `

    console.log('📊 Orders Analysis:')
    console.log(`   Total orders with raw_json: ${Number(totalOrders[0].count)}`)
    console.log(`   Orders with discounts: ${Number(ordersWithDiscounts[0].count)}`)
    console.log(`   Percentage: ${((Number(ordersWithDiscounts[0].count) / Number(totalOrders[0].count)) * 100).toFixed(1)}%\n`)

    // Check line items with applied_discounts
    const lineItemsWithAppliedDiscounts = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items
      WHERE applied_discounts IS NOT NULL
    `

    const totalLineItems = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items
    `

    console.log('📊 Line Items Analysis:')
    console.log(`   Total line items: ${Number(totalLineItems[0].count)}`)
    console.log(`   Line items with applied_discounts: ${Number(lineItemsWithAppliedDiscounts[0].count)}`)
    console.log(`   Percentage: ${((Number(lineItemsWithAppliedDiscounts[0].count) / Number(totalLineItems[0].count)) * 100).toFixed(1)}%\n`)

    // Check line items with discount_name
    const lineItemsWithDiscountName = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items
      WHERE discount_name IS NOT NULL
    `

    console.log(`   Line items with discount_name: ${Number(lineItemsWithDiscountName[0].count)}`)
    console.log(`   Percentage: ${((Number(lineItemsWithDiscountName[0].count) / Number(totalLineItems[0].count)) * 100).toFixed(1)}%\n`)

    // Sample some orders with discounts to see the structure
    console.log('🔍 Sampling orders with discounts...\n')
    const sampleOrders = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.raw_json->'discounts' as discounts,
        o.raw_json->'discount' as discount,
        COUNT(oli.id) as line_item_count
      FROM orders o
      LEFT JOIN order_line_items oli ON oli.order_id = o.id
      WHERE o.raw_json IS NOT NULL
        AND (
          o.raw_json->'discounts' IS NOT NULL
          OR o.raw_json->'discount' IS NOT NULL
        )
      GROUP BY o.id, o.order_id, o.raw_json
      LIMIT 5
    `

    if (sampleOrders && sampleOrders.length > 0) {
      console.log('📋 Sample orders with discounts:')
      for (const order of sampleOrders) {
        console.log(`\n   Order: ${order.order_id}`)
        console.log(`   Line items: ${Number(order.line_item_count)}`)
        if (order.discounts) {
          console.log(`   Discounts array: ${JSON.stringify(order.discounts, null, 2)}`)
        }
        if (order.discount) {
          console.log(`   Discount (single): ${JSON.stringify(order.discount, null, 2)}`)
        }
      }
    }

    // Check line items that have applied_discounts but no discount_name
    const missingDiscountNames = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      WHERE oli.applied_discounts IS NOT NULL
        AND oli.discount_name IS NULL
        AND o.raw_json IS NOT NULL
        AND (
          o.raw_json->'discounts' IS NOT NULL
          OR o.raw_json->'discount' IS NOT NULL
        )
    `

    console.log(`\n⚠️ Line items with applied_discounts but missing discount_name: ${Number(missingDiscountNames[0].count)}`)
    console.log(`   (These should be backfilled)\n`)

    // Check a sample of line items with applied_discounts
    const sampleLineItems = await prisma.$queryRaw`
      SELECT 
        oli.uid,
        oli.name,
        oli.applied_discounts,
        oli.discount_name,
        o.order_id,
        o.raw_json->'discounts' as order_discounts
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      WHERE oli.applied_discounts IS NOT NULL
      LIMIT 5
    `

    if (sampleLineItems && sampleLineItems.length > 0) {
      console.log('📋 Sample line items with applied_discounts:')
      for (const item of sampleLineItems) {
        console.log(`\n   Line Item UID: ${item.uid}`)
        console.log(`   Name: ${item.name}`)
        console.log(`   Applied Discounts: ${JSON.stringify(item.applied_discounts, null, 2)}`)
        console.log(`   Discount Name: ${item.discount_name || 'NULL'}`)
        console.log(`   Order Discounts: ${JSON.stringify(item.order_discounts, null, 2)}`)
      }
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Analysis completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ Analysis failed:', error)
      process.exit(1)
    })
}

module.exports = { main }



