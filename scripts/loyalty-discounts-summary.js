/**
 * Comprehensive summary of loyalty discounts (discounts with rewardIds)
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('🔍 Comprehensive Loyalty Discounts Analysis\n')
  console.log('='.repeat(60))

  try {
    // 1. Count orders with rewardIds
    const ordersWithRewards = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT o.id) as count
      FROM orders o
      WHERE o.raw_json->'discounts' IS NOT NULL
        AND (o.raw_json->'discounts')::text LIKE '%rewardIds%'
    `

    // 2. Count line items in those orders
    const lineItemsWithRewards = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items oli
      JOIN orders o ON oli.order_id = o.id
      WHERE o.raw_json->'discounts' IS NOT NULL
        AND (o.raw_json->'discounts')::text LIKE '%rewardIds%'
    `

    // 3. Get unique discount names with rewardIds
    const uniqueRewardDiscounts = await prisma.$queryRaw`
      SELECT DISTINCT
        jsonb_array_elements(o.raw_json->'discounts')->>'name' as discount_name,
        jsonb_array_elements(o.raw_json->'discounts')->>'type' as discount_type,
        jsonb_array_elements(o.raw_json->'discounts')->>'percentage' as percentage,
        jsonb_array_elements(o.raw_json->'discounts')->'rewardIds' as reward_ids,
        COUNT(DISTINCT o.id) as order_count
      FROM orders o
      WHERE o.raw_json->'discounts' IS NOT NULL
        AND (o.raw_json->'discounts')::text LIKE '%rewardIds%'
      GROUP BY discount_name, discount_type, percentage, reward_ids
      ORDER BY order_count DESC
    `

    // 4. Total discount amount
    const totalDiscountAmount = await prisma.$queryRaw`
      SELECT 
        COALESCE(SUM(oli.total_discount_money_amount), 0) / 100.0 as total
      FROM order_line_items oli
      JOIN orders o ON oli.order_id = o.id
      WHERE o.raw_json->'discounts' IS NOT NULL
        AND (o.raw_json->'discounts')::text LIKE '%rewardIds%'
    `

    // 5. Get detailed sample
    const detailedSample = await prisma.$queryRaw`
      SELECT 
        oli.uid as line_item_uid,
        oli.name as service_name,
        oli.discount_name,
        oli.total_discount_money_amount / 100.0 as discount_amount,
        oli.total_money_amount / 100.0 as line_item_total,
        o.order_id,
        o.customer_id,
        o.created_at as order_date,
        o.raw_json->'discounts' as order_discounts
      FROM order_line_items oli
      JOIN orders o ON oli.order_id = o.id
      WHERE o.raw_json->'discounts' IS NOT NULL
        AND (o.raw_json->'discounts')::text LIKE '%rewardIds%'
      ORDER BY o.created_at DESC
      LIMIT 20
    `

    console.log('\n📊 SUMMARY STATISTICS:\n')
    console.log(`   Orders with loyalty discounts (rewardIds): ${Number(ordersWithRewards[0].count)}`)
    console.log(`   Line items with loyalty discounts: ${Number(lineItemsWithRewards[0].count)}`)
    console.log(`   Total loyalty discount amount: $${Number(totalDiscountAmount[0].total).toFixed(2)}`)

    console.log('\n🎁 LOYALTY DISCOUNT TYPES:\n')
    uniqueRewardDiscounts.forEach((discount, idx) => {
      console.log(`${idx + 1}. ${discount.discount_name}`)
      console.log(`   Type: ${discount.discount_type}`)
      if (discount.percentage) {
        console.log(`   Percentage: ${discount.percentage}%`)
      }
      console.log(`   Reward IDs: ${discount.reward_ids}`)
      console.log(`   Used in ${Number(discount.order_count)} orders`)
      console.log('')
    })

    console.log('\n📋 SAMPLE LINE ITEMS WITH LOYALTY DISCOUNTS:\n')
    detailedSample.forEach((item, idx) => {
      console.log(`${idx + 1}. Service: ${item.service_name}`)
      console.log(`   Line Item UID: ${item.line_item_uid}`)
      console.log(`   Discount Name (stored): ${item.discount_name || 'NULL ⚠️'}`)
      console.log(`   Discount Amount: $${item.discount_amount || 0}`)
      console.log(`   Line Item Total: $${item.line_item_total || 0}`)
      console.log(`   Order: ${item.order_id}`)
      console.log(`   Customer: ${item.customer_id || 'N/A'}`)
      console.log(`   Date: ${item.order_date}`)
      
      if (item.order_discounts && Array.isArray(item.order_discounts)) {
        const rewardDiscount = item.order_discounts.find(d => d.rewardIds || d.reward_ids)
        if (rewardDiscount) {
          console.log(`   Loyalty Discount Details:`)
          console.log(`     - Name: ${rewardDiscount.name}`)
          console.log(`     - Type: ${rewardDiscount.type}`)
          console.log(`     - Reward IDs: ${JSON.stringify(rewardDiscount.rewardIds || rewardDiscount.reward_ids)}`)
          if (rewardDiscount.percentage) {
            console.log(`     - Percentage: ${rewardDiscount.percentage}%`)
          }
          if (rewardDiscount.appliedMoney) {
            console.log(`     - Applied Amount: $${(rewardDiscount.appliedMoney.amount || 0) / 100}`)
          }
        }
      }
      console.log('')
    })

    // 6. Check if discount_name is populated
    const missingDiscountNames = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM order_line_items oli
      JOIN orders o ON oli.order_id = o.id
      WHERE o.raw_json->'discounts' IS NOT NULL
        AND (o.raw_json->'discounts')::text LIKE '%rewardIds%'
        AND oli.discount_name IS NULL
    `

    console.log('\n⚠️ DATA QUALITY ISSUES:\n')
    console.log(`   Line items with loyalty discounts but NULL discount_name: ${Number(missingDiscountNames[0].count)}`)
    console.log(`   This means the discount name extraction didn't work for these items.`)
    console.log(`   The discount names should be: "VIP Beauty (7 Visits) – 25% Off" or "Beauty Lover (5 Visits) – 20% Off"`)

    console.log('\n' + '='.repeat(60))
    console.log('\n✅ Analysis completed\n')

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
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n❌ Analysis failed:', error)
      process.exit(1)
    })
}

module.exports = { main }



