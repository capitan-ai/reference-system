#!/usr/bin/env node
/**
 * Fix orders with NULL state by updating from order_line_items.order_state
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function fixNullStateOrders() {
  console.log('🔧 Fixing Orders with NULL State\n')
  console.log('='.repeat(60))

  try {
    // Find orders with NULL state that have line items with order_state
    const nullStateOrders = await prisma.$queryRaw`
      SELECT DISTINCT
        o.id,
        o.order_id,
        o.organization_id,
        oli.order_state
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.state IS NULL
        AND oli.order_state IS NOT NULL
      LIMIT 10000
    `

    console.log(`\n📊 Found ${nullStateOrders.length} orders with NULL state that can be fixed\n`)

    if (nullStateOrders.length === 0) {
      console.log('✅ No orders to fix!')
      return
    }

    let updated = 0
    let failed = 0

    // Update orders in batches
    const BATCH_SIZE = 100
    for (let i = 0; i < nullStateOrders.length; i += BATCH_SIZE) {
      const batch = nullStateOrders.slice(i, i + BATCH_SIZE)
      
      for (const order of batch) {
        try {
          await prisma.$executeRaw`
            UPDATE orders
            SET state = ${order.order_state},
                updated_at = NOW()
            WHERE id = ${order.id}::uuid
              AND state IS NULL
          `
          updated++
        } catch (error) {
          console.error(`   ❌ Error updating order ${order.order_id}: ${error.message}`)
          failed++
        }
      }

      if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= nullStateOrders.length) {
        console.log(`   Progress: ${Math.min(i + BATCH_SIZE, nullStateOrders.length)}/${nullStateOrders.length} processed (${updated} updated, ${failed} failed)`)
      }

      // Small delay between batches
      if (i + BATCH_SIZE < nullStateOrders.length) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Orders processed: ${nullStateOrders.length}`)
    console.log(`   ✅ Updated: ${updated}`)
    console.log(`   ❌ Failed: ${failed}`)

    // Verify the fix
    const remainingNull = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.state IS NULL
        AND oli.order_state IS NOT NULL
    `

    console.log(`\n   Remaining NULL state orders (with line items): ${remainingNull[0].count}`)

    if (remainingNull[0].count === 0) {
      console.log('\n✅ All fixable orders have been updated!')
    } else {
      console.log(`\n⚠️  ${remainingNull[0].count} orders still have NULL state (may need manual review)`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

fixNullStateOrders()
  .then(() => {
    console.log('\n✅ Fix complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error)
    process.exit(1)
  })



