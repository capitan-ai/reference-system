#!/usr/bin/env node
/**
 * Comprehensive verification: Check if we have ALL orders from Square
 * Compares Square API with database for all years
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

async function verifyAllOrders() {
  console.log('🔍 Comprehensive Verification: All Orders from Square\n')
  console.log('='.repeat(60))

  try {
    // Get all locations
    const locations = await prisma.$queryRaw`
      SELECT square_location_id FROM locations WHERE square_location_id IS NOT NULL
    `
    
    const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)
    console.log(`\n📍 Found ${locationIds.length} locations\n`)

    // Check each year
    const years = [2023, 2024, 2025, 2026]
    const results = {}

    for (const year of years) {
      console.log(`\n📅 Checking ${year}...`)
      console.log('='.repeat(60))

      const startDate = new Date(`${year}-01-01T00:00:00Z`)
      const endDate = new Date(`${year}-12-31T23:59:59Z`)
      const beginTime = startDate.toISOString()
      const endTime = endDate.toISOString()

      const squareOrderIds = new Set()
      let totalFetched = 0

      // Fetch all orders from Square API
      console.log(`\n📡 Fetching all ${year} orders from Square API...`)
      for (const locationId of locationIds) {
        let cursor = null
        do {
          const searchRequest = {
            query: {
              filter: {
                dateTimeFilter: {
                  createdAt: {
                    startAt: beginTime,
                    endAt: endTime
                  }
                },
                stateFilter: { states: ['OPEN', 'COMPLETED', 'CANCELED'] }
              }
            },
            locationIds: [locationId],
            limit: 100
          }
          if (cursor) searchRequest.cursor = cursor

          try {
            const response = await ordersApi.searchOrders(searchRequest)
            const orders = response.result?.orders || []
            cursor = response.result?.cursor

            for (const order of orders) {
              squareOrderIds.add(order.id)
            }
            totalFetched += orders.length
          } catch (apiError) {
            console.error(`   ❌ Error fetching from location ${locationId}: ${apiError.message}`)
            break
          }
        } while (cursor)
      }

      console.log(`   ✅ Fetched ${totalFetched} orders from Square API`)
      console.log(`   ✅ Unique order IDs: ${squareOrderIds.size}`)

      // Get orders from database
      const dbOrders = await prisma.$queryRaw`
        SELECT DISTINCT o.order_id
        FROM orders o
        WHERE o.order_id = ANY(${Array.from(squareOrderIds)}::text[])
      `

      const dbOrderIdSet = new Set(dbOrders.map(o => o.order_id))
      const missingOrderIds = Array.from(squareOrderIds).filter(id => !dbOrderIdSet.has(id))

      // Check line items
      const dbOrdersWithLineItems = await prisma.$queryRaw`
        SELECT DISTINCT o.order_id
        FROM orders o
        INNER JOIN order_line_items oli ON o.id = oli.order_id
        WHERE oli.order_created_at >= ${startDate}
          AND oli.order_created_at < ${endDate}
          AND o.order_id = ANY(${Array.from(squareOrderIds)}::text[])
      `

      const dbOrdersWithLineItemsSet = new Set(dbOrdersWithLineItems.map(o => o.order_id))
      const ordersWithoutLineItems = Array.from(squareOrderIds).filter(id => 
        dbOrderIdSet.has(id) && !dbOrdersWithLineItemsSet.has(id)
      )

      // Store results
      results[year] = {
        squareTotal: squareOrderIds.size,
        inDatabase: dbOrderIdSet.size,
        missing: missingOrderIds.length,
        missingOrderIds: missingOrderIds,
        withLineItems: dbOrdersWithLineItemsSet.size,
        withoutLineItems: ordersWithoutLineItems.length,
        ordersWithoutLineItems: ordersWithoutLineItems
      }

      console.log(`\n📊 ${year} Comparison:`)
      console.log(`   Square API: ${squareOrderIds.size.toLocaleString()} orders`)
      console.log(`   In database: ${dbOrderIdSet.size.toLocaleString()} orders`)
      console.log(`   Missing: ${missingOrderIds.length.toLocaleString()} orders`)
      console.log(`   With line items: ${dbOrdersWithLineItemsSet.size.toLocaleString()} orders`)
      console.log(`   Without line items: ${ordersWithoutLineItems.length.toLocaleString()} orders`)

      if (missingOrderIds.length > 0) {
        console.log(`\n   ⚠️  Missing orders (first 10):`)
        missingOrderIds.slice(0, 10).forEach(id => {
          console.log(`     ${id}`)
        })
      }

      if (ordersWithoutLineItems.length > 0) {
        console.log(`\n   ⚠️  Orders without line items (first 10):`)
        ordersWithoutLineItems.slice(0, 10).forEach(id => {
          console.log(`     ${id}`)
        })
      }
    }

    // Overall summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 OVERALL SUMMARY:\n')

    let totalSquare = 0
    let totalInDb = 0
    let totalMissing = 0
    let totalWithoutLineItems = 0

    for (const year of years) {
      const r = results[year]
      totalSquare += r.squareTotal
      totalInDb += r.inDatabase
      totalMissing += r.missing
      totalWithoutLineItems += r.withoutLineItems

      console.log(`${year}:`)
      console.log(`   Square: ${r.squareTotal.toLocaleString()}, DB: ${r.inDatabase.toLocaleString()}, Missing: ${r.missing.toLocaleString()}, No Line Items: ${r.withoutLineItems.toLocaleString()}`)
    }

    console.log(`\n📈 Totals:`)
    console.log(`   Square API: ${totalSquare.toLocaleString()} orders`)
    console.log(`   In database: ${totalInDb.toLocaleString()} orders`)
    console.log(`   Missing: ${totalMissing.toLocaleString()} orders`)
    console.log(`   Without line items: ${totalWithoutLineItems.toLocaleString()} orders`)

    // Check for orders in DB that don't exist in Square (orphaned)
    console.log(`\n🔍 Checking for orphaned orders (in DB but not in Square)...\n`)

    const allSquareOrderIds = new Set()
    for (const year of years) {
      results[year].missingOrderIds.forEach(id => allSquareOrderIds.add(id))
      // Add all orders from Square for this year
      const yearResults = results[year]
      // We already have the squareOrderIds, but we need to check all orders in DB
    }

    // Get all orders from DB
    const allDbOrders = await prisma.$queryRaw`
      SELECT DISTINCT order_id, state, created_at
      FROM orders
      WHERE order_id IS NOT NULL
      ORDER BY created_at DESC
    `

    // Sample check: verify a few orders from DB exist in Square
    console.log(`   Checking sample orders from database...\n`)
    const sampleDbOrders = allDbOrders.slice(0, 20)
    let foundInSquare = 0
    let notFoundInSquare = 0

    for (const dbOrder of sampleDbOrders) {
      try {
        const orderResponse = await ordersApi.retrieveOrder(dbOrder.order_id)
        if (orderResponse.result?.order) {
          foundInSquare++
        } else {
          notFoundInSquare++
        }
      } catch (error) {
        if (error.statusCode === 404) {
          notFoundInSquare++
        } else {
          // Rate limit or other error, skip
        }
      }
    }

    console.log(`   Sample check (${sampleDbOrders.length} orders):`)
    console.log(`     Found in Square: ${foundInSquare}`)
    console.log(`     Not found: ${notFoundInSquare}`)

    // Final assessment
    console.log('\n' + '='.repeat(60))
    console.log('\n✅ VERIFICATION COMPLETE\n')

    if (totalMissing === 0 && totalWithoutLineItems === 0) {
      console.log('🎉 PERFECT! All orders from Square are in the database with line items!')
    } else {
      console.log('⚠️  Issues found:')
      if (totalMissing > 0) {
        console.log(`   - ${totalMissing.toLocaleString()} orders missing from database`)
      }
      if (totalWithoutLineItems > 0) {
        console.log(`   - ${totalWithoutLineItems.toLocaleString()} orders missing line items`)
      }
    }

    // Generate report
    console.log(`\n📄 Detailed Report:`)
    for (const year of years) {
      const r = results[year]
      if (r.missing > 0 || r.withoutLineItems > 0) {
        console.log(`\n   ${year}:`)
        if (r.missing > 0) {
          console.log(`     Missing orders: ${r.missing}`)
        }
        if (r.withoutLineItems > 0) {
          console.log(`     Orders without line items: ${r.withoutLineItems}`)
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

verifyAllOrders()
  .then(() => {
    console.log('\n✅ Verification complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Verification failed:', error)
    process.exit(1)
  })



