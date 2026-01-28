/**
 * Check discount structures to find loyalty-related discounts
 * Look for rewardIds and other loyalty indicators
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('🔍 Analyzing discount structures for loyalty indicators...\n')

  try {
    // Get all unique discount structures
    console.log('📊 Extracting discount structures from orders...\n')
    const discountStructures = await prisma.$queryRaw`
      SELECT DISTINCT
        jsonb_array_elements(o.raw_json->'discounts') as discount
      FROM orders o
      WHERE o.raw_json->'discounts' IS NOT NULL
        AND jsonb_array_length(o.raw_json->'discounts') > 0
      LIMIT 100
    `

    console.log(`Found ${discountStructures.length} discount objects to analyze\n`)

    // Group by discount type and analyze structure
    const discountTypes = new Map()
    const rewardDiscounts = []
    const loyaltyDiscounts = []

    discountStructures.forEach(d => {
      if (d.discount) {
        const discount = d.discount
        const type = discount.type || discount.discount_type || 'UNKNOWN'
        const name = discount.name || discount.discount_name || 'N/A'
        
        // Check for rewardIds (might indicate loyalty/rewards)
        if (discount.rewardIds || discount.reward_ids) {
          rewardDiscounts.push({
            type,
            name,
            rewardIds: discount.rewardIds || discount.reward_ids,
            fullDiscount: discount
          })
        }

        // Check for any loyalty indicators
        const discountStr = JSON.stringify(discount).toLowerCase()
        if (discountStr.includes('loyalty') || 
            discountStr.includes('point') ||
            (discount.rewardIds || discount.reward_ids)) {
          loyaltyDiscounts.push({
            type,
            name,
            fullDiscount: discount
          })
        }

        // Track discount types
        if (!discountTypes.has(type)) {
          discountTypes.set(type, {
            count: 0,
            names: new Set(),
            sample: discount
          })
        }
        const typeInfo = discountTypes.get(type)
        typeInfo.count++
        if (name !== 'N/A') {
          typeInfo.names.add(name)
        }
      }
    })

    // Show discount types
    console.log('📋 Discount Types Found:\n')
    Array.from(discountTypes.entries()).forEach(([type, info]) => {
      console.log(`   ${type}:`)
      console.log(`     - Count: ${info.count}`)
      console.log(`     - Names: ${Array.from(info.names).slice(0, 5).join(', ')}${info.names.size > 5 ? '...' : ''}`)
      console.log(`     - Sample structure keys: ${Object.keys(info.sample).join(', ')}`)
      console.log('')
    })

    // Show discounts with rewardIds
    if (rewardDiscounts.length > 0) {
      console.log(`\n🎁 Discounts with rewardIds (${rewardDiscounts.length} found):\n`)
      rewardDiscounts.slice(0, 10).forEach((discount, idx) => {
        console.log(`${idx + 1}. Type: ${discount.type}, Name: ${discount.name}`)
        console.log(`   Reward IDs: ${JSON.stringify(discount.rewardIds)}`)
        console.log(`   Full structure: ${JSON.stringify(discount.fullDiscount, null, 2)}`)
        console.log('')
      })
    } else {
      console.log('\n⚠️ No discounts found with rewardIds\n')
    }

    // Show potential loyalty discounts
    if (loyaltyDiscounts.length > 0) {
      console.log(`\n🎯 Potential Loyalty Discounts (${loyaltyDiscounts.length} found):\n`)
      loyaltyDiscounts.slice(0, 10).forEach((discount, idx) => {
        console.log(`${idx + 1}. Type: ${discount.type}, Name: ${discount.name}`)
        console.log(`   Full structure: ${JSON.stringify(discount.fullDiscount, null, 2)}`)
        console.log('')
      })
    } else {
      console.log('\n⚠️ No obvious loyalty discounts found\n')
    }

    // Check line items for discounts with rewardIds
    console.log('\n📊 Checking line items for discounts with rewardIds...\n')
    const lineItemsWithRewards = await prisma.$queryRaw`
      SELECT 
        oli.uid,
        oli.name,
        oli.discount_name,
        oli.applied_discounts,
        oli.total_discount_money_amount / 100.0 as discount_amount,
        o.order_id,
        o.raw_json->'discounts' as order_discounts
      FROM order_line_items oli
      JOIN orders o ON oli.order_id = o.id
      WHERE o.raw_json->'discounts' IS NOT NULL
        AND (o.raw_json->'discounts')::text LIKE '%rewardIds%'
      LIMIT 10
    `

    if (lineItemsWithRewards && lineItemsWithRewards.length > 0) {
      console.log(`Found ${lineItemsWithRewards.length} line items in orders with rewardIds:\n`)
      lineItemsWithRewards.forEach((item, idx) => {
        console.log(`${idx + 1}. Line Item: ${item.uid}`)
        console.log(`   Service: ${item.name}`)
        console.log(`   Discount Name: ${item.discount_name || 'N/A'}`)
        console.log(`   Discount Amount: $${item.discount_amount || 0}`)
        console.log(`   Order: ${item.order_id}`)
        if (item.order_discounts) {
          console.log(`   Order Discounts: ${JSON.stringify(item.order_discounts, null, 2)}`)
        }
        console.log('')
      })
    } else {
      console.log('   No line items found in orders with rewardIds\n')
    }

    // Summary
    console.log('\n📊 Summary:\n')
    console.log(`   Total discount types: ${discountTypes.size}`)
    console.log(`   Discounts with rewardIds: ${rewardDiscounts.length}`)
    console.log(`   Potential loyalty discounts: ${loyaltyDiscounts.length}`)
    console.log(`   Line items in orders with rewardIds: ${lineItemsWithRewards?.length || 0}`)

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



