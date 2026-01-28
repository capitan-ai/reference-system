/**
 * Analyze loyalty discounts in order line items
 * 
 * This script:
 * 1. Finds line items with loyalty discounts
 * 2. Shows the structure of loyalty discount data
 * 3. Provides statistics on loyalty discount usage
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('🔍 Analyzing loyalty discounts in order line items...\n')

  try {
    // 1. Check line items with loyalty-related discount names
    console.log('📊 Checking line items by discount_name...')
    const lineItemsByDiscountName = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as count,
        discount_name
      FROM order_line_items
      WHERE discount_name IS NOT NULL
        AND (
          discount_name ILIKE '%loyalty%'
          OR discount_name ILIKE '%points%'
          OR discount_name ILIKE '%reward%'
        )
      GROUP BY discount_name
      ORDER BY count DESC
    `

    console.log(`   Found ${lineItemsByDiscountName.length} unique loyalty-related discount names:\n`)
    lineItemsByDiscountName.forEach(item => {
      console.log(`   - "${item.discount_name}": ${Number(item.count)} line items`)
    })

    // 2. Check line items with loyalty in applied_discounts JSON
    console.log('\n📊 Checking line items by applied_discounts JSON...')
    const lineItemsByAppliedDiscounts = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items
      WHERE applied_discounts IS NOT NULL
        AND (
          applied_discounts::text ILIKE '%loyalty%'
          OR applied_discounts::text ILIKE '%points%'
          OR applied_discounts::text ILIKE '%LOYALTY%'
        )
    `

    console.log(`   Line items with loyalty in applied_discounts: ${Number(lineItemsByAppliedDiscounts[0].count)}\n`)

    // 3. Check orders.raw_json for loyalty discounts
    console.log('📊 Checking orders.raw_json for loyalty discounts...')
    const ordersWithLoyalty = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM orders
      WHERE raw_json IS NOT NULL
        AND (
          (raw_json->'discounts')::text ILIKE '%loyalty%'
          OR (raw_json->'discounts')::text ILIKE '%points%'
          OR (raw_json->'discounts')::text ILIKE '%LOYALTY%'
        )
    `

    console.log(`   Orders with loyalty discounts in raw_json: ${Number(ordersWithLoyalty[0].count)}\n`)

    // 4. Get sample line items with loyalty discounts
    console.log('📋 Sample line items with loyalty discounts:\n')
    const sampleLineItems = await prisma.$queryRaw`
      SELECT 
        oli.uid,
        oli.name as service_name,
        oli.discount_name,
        oli.applied_discounts,
        oli.total_discount_money_amount / 100.0 as discount_amount,
        oli.total_money_amount / 100.0 as total_amount,
        o.order_id,
        o.created_at as order_date
      FROM order_line_items oli
      JOIN orders o ON oli.order_id = o.id
      WHERE (
        oli.discount_name IS NOT NULL
        AND (
          oli.discount_name ILIKE '%loyalty%'
          OR oli.discount_name ILIKE '%points%'
          OR oli.discount_name ILIKE '%reward%'
        )
      )
      OR (
        oli.applied_discounts IS NOT NULL
        AND (
          oli.applied_discounts::text ILIKE '%loyalty%'
          OR oli.applied_discounts::text ILIKE '%points%'
          OR oli.applied_discounts::text ILIKE '%LOYALTY%'
        )
      )
      ORDER BY o.created_at DESC
      LIMIT 10
    `

    if (sampleLineItems && sampleLineItems.length > 0) {
      sampleLineItems.forEach((item, index) => {
        console.log(`${index + 1}. Line Item: ${item.uid}`)
        console.log(`   Service: ${item.service_name}`)
        console.log(`   Discount Name: ${item.discount_name || 'N/A'}`)
        console.log(`   Discount Amount: $${item.discount_amount || 0}`)
        console.log(`   Total Amount: $${item.total_amount || 0}`)
        console.log(`   Order: ${item.order_id}`)
        console.log(`   Date: ${item.order_date}`)
        if (item.applied_discounts) {
          console.log(`   Applied Discounts JSON: ${JSON.stringify(item.applied_discounts, null, 2)}`)
        }
        console.log('')
      })
    } else {
      console.log('   No line items found with loyalty discounts\n')
    }

    // 5. Get sample orders with loyalty discounts from raw_json
    console.log('📋 Sample orders with loyalty discounts in raw_json:\n')
    const sampleOrders = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.raw_json->'discounts' as discounts,
        o.created_at
      FROM orders o
      WHERE o.raw_json IS NOT NULL
        AND (
          (o.raw_json->'discounts')::text ILIKE '%loyalty%'
          OR (o.raw_json->'discounts')::text ILIKE '%points%'
          OR (o.raw_json->'discounts')::text ILIKE '%LOYALTY%'
        )
      ORDER BY o.created_at DESC
      LIMIT 5
    `

    if (sampleOrders && sampleOrders.length > 0) {
      sampleOrders.forEach((order, index) => {
        console.log(`${index + 1}. Order: ${order.order_id}`)
        console.log(`   Date: ${order.created_at}`)
        if (order.discounts) {
          console.log(`   Discounts: ${JSON.stringify(order.discounts, null, 2)}`)
          
          // Analyze discount structure
          if (Array.isArray(order.discounts)) {
            order.discounts.forEach((discount, idx) => {
              console.log(`\n   Discount ${idx + 1}:`)
              console.log(`     - UID: ${discount.uid || discount.discount_uid || 'N/A'}`)
              console.log(`     - Name: ${discount.name || discount.discount_name || 'N/A'}`)
              console.log(`     - Type: ${discount.type || 'N/A'}`)
              console.log(`     - Scope: ${discount.scope || 'N/A'}`)
              if (discount.loyalty_account_id) {
                console.log(`     - Loyalty Account ID: ${discount.loyalty_account_id}`)
              }
              if (discount.loyalty_points_used) {
                console.log(`     - Points Used: ${discount.loyalty_points_used}`)
              }
              if (discount.amount_money) {
                console.log(`     - Amount: $${(discount.amount_money.amount || 0) / 100}`)
              }
              if (discount.percentage) {
                console.log(`     - Percentage: ${discount.percentage}%`)
              }
            })
          }
        }
        console.log('')
      })
    } else {
      console.log('   No orders found with loyalty discounts in raw_json\n')
    }

    // 6. Total statistics
    console.log('\n📊 Summary Statistics:\n')
    
    const totalLineItems = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items
    `

    const loyaltyByDiscountName = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items
      WHERE discount_name IS NOT NULL
        AND (
          discount_name ILIKE '%loyalty%'
          OR discount_name ILIKE '%points%'
          OR discount_name ILIKE '%reward%'
        )
    `

    const loyaltyByAppliedDiscounts = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items
      WHERE applied_discounts IS NOT NULL
        AND (
          applied_discounts::text ILIKE '%loyalty%'
          OR applied_discounts::text ILIKE '%points%'
          OR applied_discounts::text ILIKE '%LOYALTY%'
        )
    `

    const totalDiscountAmount = await prisma.$queryRaw`
      SELECT 
        COALESCE(SUM(total_discount_money_amount), 0) / 100.0 as total
      FROM order_line_items
      WHERE (
        discount_name IS NOT NULL
        AND (
          discount_name ILIKE '%loyalty%'
          OR discount_name ILIKE '%points%'
          OR discount_name ILIKE '%reward%'
        )
      )
      OR (
        applied_discounts IS NOT NULL
        AND (
          applied_discounts::text ILIKE '%loyalty%'
          OR applied_discounts::text ILIKE '%points%'
          OR applied_discounts::text ILIKE '%LOYALTY%'
        )
      )
    `

    console.log(`   Total line items: ${Number(totalLineItems[0].count)}`)
    console.log(`   Line items with loyalty (by discount_name): ${Number(loyaltyByDiscountName[0].count)}`)
    console.log(`   Line items with loyalty (by applied_discounts): ${Number(loyaltyByAppliedDiscounts[0].count)}`)
    console.log(`   Orders with loyalty discounts: ${Number(ordersWithLoyalty[0].count)}`)
    console.log(`   Total loyalty discount amount: $${Number(totalDiscountAmount[0].total).toFixed(2)}`)

    // 7. Check for specific loyalty discount types/structures
    console.log('\n🔍 Analyzing discount structure for loyalty identification...\n')
    
    const allDiscounts = await prisma.$queryRaw`
      SELECT DISTINCT
        jsonb_array_elements(o.raw_json->'discounts') as discount
      FROM orders o
      WHERE o.raw_json->'discounts' IS NOT NULL
      LIMIT 50
    `

    const loyaltyDiscountFields = new Set()
    allDiscounts.forEach(d => {
      if (d.discount) {
        const discount = d.discount
        Object.keys(discount).forEach(key => {
          if (key.toLowerCase().includes('loyalty') || 
              key.toLowerCase().includes('point') ||
              key.toLowerCase().includes('reward')) {
            loyaltyDiscountFields.add(key)
          }
        })
      }
    })

    if (loyaltyDiscountFields.size > 0) {
      console.log('   Found loyalty-related fields in discount objects:')
      Array.from(loyaltyDiscountFields).forEach(field => {
        console.log(`     - ${field}`)
      })
    } else {
      console.log('   No specific loyalty fields found in discount objects')
      console.log('   (Loyalty discounts may be identified by name or type only)')
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

