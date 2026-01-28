#!/usr/bin/env node
/**
 * Fix NULL state orders by fetching state from Square API
 * Also check actual order creation dates vs DB created_at
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

async function fixNullStateFromSquare() {
  console.log('🔧 Fixing NULL State Orders from Square API\n')
  console.log('='.repeat(60))

  try {
    // Get all NULL state orders
    const nullStateOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        organization_id,
        created_at as db_created_at,
        updated_at as db_updated_at
      FROM orders
      WHERE state IS NULL
      ORDER BY created_at DESC
    `

    console.log(`\n📊 Found ${nullStateOrders.length} orders with NULL state\n`)

    if (nullStateOrders.length === 0) {
      console.log('✅ No orders to fix!')
      return
    }

    let updated = 0
    let notFound = 0
    let errors = 0
    const dateAnalysis = {
      sameDate: 0,
      differentDate: 0,
      dateDifferences: []
    }

    // Process in parallel batches
    const BATCH_SIZE = 20
    for (let i = 0; i < nullStateOrders.length; i += BATCH_SIZE) {
      const batch = nullStateOrders.slice(i, i + BATCH_SIZE)
      
      const batchResults = await Promise.all(
        batch.map(async (order) => {
          try {
            const response = await ordersApi.retrieveOrder(order.order_id)
            const squareOrder = response.result?.order

            if (squareOrder) {
              const squareState = squareOrder.state || null
              const squareCreatedAt = squareOrder.createdAt || squareOrder.created_at
              const squareCreatedDate = squareCreatedAt ? new Date(squareCreatedAt) : null
              const dbCreatedDate = new Date(order.db_created_at)

              // Compare dates
              let dateMatch = false
              if (squareCreatedDate) {
                const dateDiff = Math.abs(squareCreatedDate.getTime() - dbCreatedDate.getTime())
                const daysDiff = dateDiff / (1000 * 60 * 60 * 24)
                
                if (daysDiff < 1) {
                  dateMatch = true
                  dateAnalysis.sameDate++
                } else {
                  dateAnalysis.differentDate++
                  dateAnalysis.dateDifferences.push({
                    orderId: order.order_id,
                    squareDate: squareCreatedDate,
                    dbDate: dbCreatedDate,
                    daysDiff: Math.round(daysDiff)
                  })
                }
              }

              // Update order state
              await prisma.$executeRaw`
                UPDATE orders
                SET state = ${squareState},
                    updated_at = NOW()
                WHERE order_id = ${order.order_id}
                  AND organization_id = ${order.organization_id}::uuid
                  AND state IS NULL
              `

              return {
                success: true,
                orderId: order.order_id,
                state: squareState,
                squareCreatedAt: squareCreatedDate,
                dbCreatedAt: dbCreatedDate,
                dateMatch
              }
            } else {
              return {
                success: false,
                orderId: order.order_id,
                reason: 'not_found'
              }
            }
          } catch (apiError) {
            if (apiError.statusCode === 404) {
              return {
                success: false,
                orderId: order.order_id,
                reason: 'not_found'
              }
            } else {
              return {
                success: false,
                orderId: order.order_id,
                reason: 'error',
                error: apiError.message
              }
            }
          }
        })
      )

      for (const result of batchResults) {
        if (result.success) {
          updated++
        } else if (result.reason === 'not_found') {
          notFound++
        } else {
          errors++
        }
      }

      if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= nullStateOrders.length) {
        console.log(`   Progress: ${Math.min(i + BATCH_SIZE, nullStateOrders.length)}/${nullStateOrders.length} processed (${updated} updated, ${notFound} not found, ${errors} errors)`)
      }

      // Small delay between batches
      if (i + BATCH_SIZE < nullStateOrders.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Orders processed: ${nullStateOrders.length}`)
    console.log(`   ✅ Updated from Square: ${updated}`)
    console.log(`   ❌ Not found in Square: ${notFound}`)
    console.log(`   ⚠️  Errors: ${errors}`)

    console.log('\n📅 DATE ANALYSIS:\n')
    console.log(`   Orders with same date (DB created_at ≈ Square createdAt): ${dateAnalysis.sameDate}`)
    console.log(`   Orders with different dates: ${dateAnalysis.differentDate}`)

    if (dateAnalysis.dateDifferences.length > 0) {
      console.log('\n⚠️  Orders with Date Mismatches (first 10):')
      dateAnalysis.dateDifferences.slice(0, 10).forEach((diff, idx) => {
        console.log(`\n   ${idx + 1}. Order ID: ${diff.orderId}`)
        console.log(`      Square createdAt: ${diff.squareDate}`)
        console.log(`      DB created_at: ${diff.dbDate}`)
        console.log(`      Difference: ${diff.daysDiff} days`)
      })
      if (dateAnalysis.dateDifferences.length > 10) {
        console.log(`\n   ... and ${dateAnalysis.dateDifferences.length - 10} more`)
      }
    }

    // Verify the fix
    const remainingNull = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM orders
      WHERE state IS NULL
    `

    console.log(`\n   Remaining NULL state orders: ${remainingNull[0].count}`)

    if (remainingNull[0].count === 0) {
      console.log('\n✅ All fixable orders have been updated!')
    } else {
      console.log(`\n⚠️  ${remainingNull[0].count} orders still have NULL state (may not exist in Square)`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

fixNullStateFromSquare()
  .then(() => {
    console.log('\n✅ Fix complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error)
    process.exit(1)
  })



