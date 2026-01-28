#!/usr/bin/env node
/**
 * Fetch remaining missing raw_json from Square API
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

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

async function fixRemainingRawJson() {
  console.log('🔧 Fetching Remaining Missing raw_json from Square API\n')
  console.log('='.repeat(60))

  try {
    // Get all items with missing raw_json, grouped by order to minimize API calls
    const missingRawJson = await prisma.$queryRaw`
      SELECT 
        oli.id,
        oli.uid,
        oli.name,
        oli.order_id,
        o.order_id as square_order_id,
        oli.order_created_at
      FROM order_line_items oli
      INNER JOIN orders o ON oli.order_id = o.id
      WHERE oli.raw_json IS NULL
        AND o.order_id IS NOT NULL
      ORDER BY oli.order_created_at DESC
    `

    console.log(`\n📊 Found ${missingRawJson.length} items with missing raw_json\n`)

    if (missingRawJson.length === 0) {
      console.log('✅ No items with missing raw_json!')
      return
    }

    // Group by order_id to fetch each order only once
    const ordersToFetch = new Map()
    missingRawJson.forEach(item => {
      if (!ordersToFetch.has(item.square_order_id)) {
        ordersToFetch.set(item.square_order_id, [])
      }
      ordersToFetch.get(item.square_order_id).push(item)
    })

    console.log(`📦 Grouped into ${ordersToFetch.size} unique orders to fetch\n`)
    console.log(`🔄 Fetching from Square API...\n`)

    let fixedRawJson = 0
    let notFound = 0
    let errors = 0
    let processed = 0

    const orderIds = Array.from(ordersToFetch.keys())

    for (let i = 0; i < orderIds.length; i++) {
      const squareOrderId = orderIds[i]
      const items = ordersToFetch.get(squareOrderId)

      try {
        const orderResponse = await ordersApi.retrieveOrder(squareOrderId)
        const squareOrder = orderResponse.result?.order
        
        if (!squareOrder) {
          notFound += items.length
          processed++
          continue
        }

        const lineItems = squareOrder.lineItems || squareOrder.line_items || []
        const lineItemsByUid = new Map()
        lineItems.forEach(li => {
          if (li.uid) {
            lineItemsByUid.set(li.uid, li)
          }
        })

        // Update all items from this order
        for (const item of items) {
          const matchingItem = lineItemsByUid.get(item.uid)

          if (matchingItem) {
            const rawJson = convertBigIntToString(matchingItem)
            
            await prisma.$executeRaw`
              UPDATE order_line_items
              SET raw_json = ${JSON.stringify(rawJson)}::jsonb
              WHERE id::text = ${item.id}
            `
            
            fixedRawJson++
          } else {
            notFound++
          }
        }

        processed++

        if (processed % 50 === 0 || processed === orderIds.length) {
          console.log(`   Progress: ${processed}/${orderIds.length} orders (${fixedRawJson} items fixed, ${notFound} not found, ${errors} errors)`)
        }

        // Delay to avoid rate limiting
        if (i < orderIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }

      } catch (apiError) {
        errors += items.length
        if (errors <= 10) {
          console.log(`   ⚠️  Error fetching order ${squareOrderId}: ${apiError.message}`)
        }
        processed++
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 FIX SUMMARY:\n')
    console.log(`   Total items with missing raw_json: ${missingRawJson.length}`)
    console.log(`   ✅ Fixed: ${fixedRawJson}`)
    console.log(`   ❌ Not found in Square: ${notFound}`)
    console.log(`   ❌ Errors: ${errors}`)

    // Final check
    const remaining = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count
      FROM order_line_items
      WHERE raw_json IS NULL
    `

    console.log(`\n📊 Remaining NULL raw_json: ${remaining[0].count}`)

    if (remaining[0].count > 0) {
      console.log(`\n💡 These remaining items may be:`)
      console.log(`   - From deleted/cancelled orders in Square`)
      console.log(`   - From very old orders no longer in Square's system`)
      console.log(`   - Test orders that were cleaned up`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

fixRemainingRawJson()
  .then(() => {
    console.log('\n✅ Fix complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error)
    process.exit(1)
  })



