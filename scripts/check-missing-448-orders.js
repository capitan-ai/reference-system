#!/usr/bin/env node
/**
 * Check the 448 missing orders - do they exist in DB or are they missing entirely?
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

async function checkMissingOrders() {
  console.log('🔍 Checking the 448 Missing Orders\n')
  console.log('='.repeat(60))

  try {
    // Get all 2025 orders from Square
    const startDate = new Date('2025-01-01T00:00:00Z')
    const endDate = new Date('2025-12-31T23:59:59Z')
    const beginTime = startDate.toISOString()
    const endTime = endDate.toISOString()

    const locations = await prisma.$queryRaw`
      SELECT square_location_id FROM locations WHERE square_location_id IS NOT NULL
    `
    
    const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)
    const square2025OrderIds = new Set()

    console.log('📡 Fetching all 2025 orders from Square API...\n')
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
            square2025OrderIds.add(order.id)
          }
        } catch (apiError) {
          console.error(`❌ Error fetching from location ${locationId}: ${apiError.message}`)
          break
        }
      } while (cursor)
    }

    console.log(`✅ Found ${square2025OrderIds.size} orders from Square API (2025)\n`)

    // Get orders with line items from DB
    const dbOrdersWithLineItems = await prisma.$queryRaw`
      SELECT DISTINCT o.order_id
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.order_created_at >= '2025-01-01'
        AND oli.order_created_at < '2026-01-01'
    `

    const dbOrderIdSet = new Set(dbOrdersWithLineItems.map(o => o.order_id))
    const missingOrderIds = Array.from(square2025OrderIds).filter(id => !dbOrderIdSet.has(id))

    console.log(`📊 Comparison:`)
    console.log(`   Square API: ${square2025OrderIds.size} orders`)
    console.log(`   Database (with line items): ${dbOrderIdSet.size} orders`)
    console.log(`   Missing: ${missingOrderIds.length} orders\n`)

    // Check if missing orders exist in DB at all
    const missingOrderIdsArray = missingOrderIds
    const existingInDb = await prisma.$queryRaw`
      SELECT DISTINCT order_id, state, created_at
      FROM orders
      WHERE order_id = ANY(${missingOrderIdsArray}::text[])
    `

    const existingOrderIds = new Set(existingInDb.map(o => o.order_id))
    const notInDbAtAll = missingOrderIds.filter(id => !existingOrderIds.has(id))

    console.log(`📊 Missing Orders Analysis:`)
    console.log(`   Total missing: ${missingOrderIds.length}`)
    console.log(`   ✅ Exist in DB (but no line items): ${existingInDb.length}`)
    console.log(`   ❌ Not in DB at all: ${notInDbAtAll.length}\n`)

    // Check line items for orders that exist in DB
    if (existingInDb.length > 0) {
      const existingOrderIdsArray = Array.from(existingOrderIds)
      const ordersWithAnyLineItems = await prisma.$queryRaw`
        SELECT DISTINCT o.order_id, COUNT(oli.id)::int as line_item_count
        FROM orders o
        LEFT JOIN order_line_items oli ON o.id = oli.order_id
        WHERE o.order_id = ANY(${existingOrderIdsArray}::text[])
        GROUP BY o.order_id
        HAVING COUNT(oli.id) = 0
      `

      console.log(`📦 Orders in DB but no line items:`)
      console.log(`   Total: ${ordersWithAnyLineItems.length}`)
      console.log(`\n   Sample (first 10):`)
      ordersWithAnyLineItems.slice(0, 10).forEach(o => {
        console.log(`     ${o.order_id}`)
      })
    }

    // Check a sample of orders not in DB
    if (notInDbAtAll.length > 0) {
      console.log(`\n❌ Orders NOT in database at all:`)
      console.log(`   Total: ${notInDbAtAll.length}`)
      console.log(`\n   Sample (first 10):`)
      notInDbAtAll.slice(0, 10).forEach(id => {
        console.log(`     ${id}`)
      })

      // Fetch details for a few to understand why
      console.log(`\n🔍 Fetching details for sample orders not in DB...\n`)
      const sampleNotInDb = notInDbAtAll.slice(0, 20)
      let hasLineItems = 0
      let noLineItems = 0
      let errors = 0

      for (const orderId of sampleNotInDb) {
        try {
          const orderResponse = await ordersApi.retrieveOrder(orderId)
          const order = orderResponse.result?.order
          if (order) {
            const lineItems = order.lineItems || order.line_items || []
            if (lineItems.length > 0) {
              hasLineItems++
            } else {
              noLineItems++
            }
          }
        } catch (error) {
          errors++
        }
      }

      console.log(`   Sample analysis (${sampleNotInDb.length} orders):`)
      console.log(`     With line items: ${hasLineItems}`)
      console.log(`     Without line items: ${noLineItems}`)
      console.log(`     Errors: ${errors}`)
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Total 2025 orders in Square: ${square2025OrderIds.size}`)
    console.log(`   Orders with line items in DB: ${dbOrderIdSet.size}`)
    console.log(`   Missing: ${missingOrderIds.length} orders`)
    console.log(`\n   Breakdown:`)
    console.log(`     - Exist in DB but no line items: ${existingInDb.length}`)
    console.log(`     - Not in DB at all: ${notInDbAtAll.length}`)

    if (existingInDb.length > 0) {
      console.log(`\n💡 ${existingInDb.length} orders exist in DB but are missing line items.`)
      console.log(`   These should be backfilled.`)
    }

    if (notInDbAtAll.length > 0) {
      console.log(`\n💡 ${notInDbAtAll.length} orders are not in the database at all.`)
      console.log(`   These need to be inserted as orders first, then line items.`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkMissingOrders()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



