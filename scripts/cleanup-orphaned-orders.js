#!/usr/bin/env node
/**
 * Clean up orphaned orders that don't exist in Square
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

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

async function cleanupOrphanedOrders() {
  console.log('🧹 Cleaning Up Orphaned Orders\n')
  console.log('='.repeat(60))

  // Check if dry-run mode
  const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryrun')
  if (dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No orders will be deleted\n')
  }

  try {
    // Get all NULL state orders
    const nullStateOrders = await prisma.$queryRaw`
      SELECT 
        id,
        order_id,
        organization_id,
        created_at,
        updated_at
      FROM orders
      WHERE state IS NULL
      ORDER BY created_at DESC
    `

    console.log(`\n📊 Found ${nullStateOrders.length} orders with NULL state\n`)

    if (nullStateOrders.length === 0) {
      console.log('✅ No orders to check!')
      return
    }

    console.log('🔍 Verifying which orders exist in Square...\n')

    const orphanedOrders = []
    let verified = 0

    // Check in batches
    const BATCH_SIZE = 20
    for (let i = 0; i < nullStateOrders.length; i += BATCH_SIZE) {
      const batch = nullStateOrders.slice(i, i + BATCH_SIZE)
      
      const batchResults = await Promise.all(
        batch.map(async (order) => {
          try {
            const response = await ordersApi.retrieveOrder(order.order_id)
            const squareOrder = response.result?.order

            if (squareOrder) {
              // Order exists in Square - should have state, this is unexpected
              return {
                orderId: order.order_id,
                exists: true,
                state: squareOrder.state || 'N/A'
              }
            } else {
              return {
                orderId: order.order_id,
                exists: false
              }
            }
          } catch (apiError) {
            if (apiError.statusCode === 404) {
              // Order doesn't exist in Square - orphaned
              return {
                orderId: order.order_id,
                exists: false
              }
            } else {
              // Error checking - skip for now
              return {
                orderId: order.order_id,
                exists: null,
                error: apiError.message
              }
            }
          }
        })
      )

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j]
        const order = batch[j]
        verified++

        if (result.exists === false) {
          orphanedOrders.push({
            id: order.id,
            orderId: order.order_id,
            organizationId: order.organization_id,
            createdAt: order.created_at
          })
        } else if (result.exists === true) {
          console.log(`   ⚠️  Order ${order.order_id} exists in Square but has NULL state (state: ${result.state})`)
        }

        if (verified % 200 === 0 || verified === nullStateOrders.length) {
          console.log(`   Progress: ${verified}/${nullStateOrders.length} verified (${orphanedOrders.length} orphaned found)`)
        }
      }

      // Small delay between batches
      if (i + BATCH_SIZE < nullStateOrders.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 VERIFICATION RESULTS:\n')
    console.log(`   Total NULL state orders: ${nullStateOrders.length}`)
    console.log(`   ✅ Verified: ${verified}`)
    console.log(`   ❌ Orphaned (not in Square): ${orphanedOrders.length}`)

    if (orphanedOrders.length === 0) {
      console.log('\n✅ No orphaned orders found!')
      return
    }

    // Show sample orphaned orders
    console.log('\n📋 Sample Orphaned Orders (first 10):')
    orphanedOrders.slice(0, 10).forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.orderId}`)
      console.log(`      DB ID: ${order.id}`)
      console.log(`      Created: ${order.createdAt}`)
    })

    if (orphanedOrders.length > 10) {
      console.log(`\n   ... and ${orphanedOrders.length - 10} more`)
    }

    // Check if orphaned orders have line items
    const orphanedIds = orphanedOrders.map(o => o.id)
    const withLineItems = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT o.id)::int as count
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE o.id = ANY(${orphanedIds}::uuid[])
    `

    console.log(`\n   Orphaned orders with line items: ${withLineItems[0].count}`)

    if (dryRun) {
      console.log('\n' + '='.repeat(60))
      console.log('\n⚠️  DRY RUN - No orders were deleted')
      console.log(`\n   Would delete ${orphanedOrders.length} orphaned orders`)
      console.log(`   Run without --dry-run to actually delete them`)
      return
    }

    // Delete orphaned orders
    console.log('\n' + '='.repeat(60))
    console.log('\n🗑️  Deleting orphaned orders...\n')

    let deleted = 0
    let failed = 0

    // Delete in batches
    for (let i = 0; i < orphanedOrders.length; i += BATCH_SIZE) {
      const batch = orphanedOrders.slice(i, i + BATCH_SIZE)
      
      for (const order of batch) {
        try {
          // Delete order (line items will be cascade deleted)
          await prisma.$executeRaw`
            DELETE FROM orders
            WHERE id = ${order.id}::uuid
              AND order_id = ${order.orderId}
              AND organization_id = ${order.organizationId}::uuid
              AND state IS NULL
          `
          deleted++
        } catch (error) {
          console.error(`   ❌ Error deleting order ${order.orderId}: ${error.message}`)
          failed++
        }
      }

      if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= orphanedOrders.length) {
        console.log(`   Progress: ${Math.min(i + BATCH_SIZE, orphanedOrders.length)}/${orphanedOrders.length} processed (${deleted} deleted, ${failed} failed)`)
      }

      if (i + BATCH_SIZE < orphanedOrders.length) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 CLEANUP SUMMARY:\n')
    console.log(`   Orphaned orders found: ${orphanedOrders.length}`)
    console.log(`   ✅ Deleted: ${deleted}`)
    console.log(`   ❌ Failed: ${failed}`)

    // Verify cleanup
    const remainingNull = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders
      WHERE state IS NULL
    `

    console.log(`\n   Remaining NULL state orders: ${remainingNull[0].count}`)

    if (remainingNull[0].count === 0) {
      console.log('\n✅ All orphaned orders cleaned up!')
    } else {
      console.log(`\n⚠️  ${remainingNull[0].count} orders still have NULL state`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

cleanupOrphanedOrders()
  .then(() => {
    console.log('\n✅ Cleanup complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Cleanup failed:', error)
    process.exit(1)
  })



