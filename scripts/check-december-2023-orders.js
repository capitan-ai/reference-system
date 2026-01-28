#!/usr/bin/env node
/**
 * Check all orders from December 2023 via Square API
 * Compare with database to see what's missing
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

// December 2023 date range
const startDate = new Date('2023-12-01T00:00:00Z')
const endDate = new Date('2023-12-31T23:59:59Z')
const beginTime = startDate.toISOString()
const endTime = endDate.toISOString()

console.log('📅 Date Range: December 2023')
console.log(`   Start: ${startDate.toISOString()}`)
console.log(`   End:   ${endDate.toISOString()}`)
console.log('')

async function checkDecember2023Orders() {
  console.log('🔍 Checking December 2023 Orders from Square API\n')
  console.log('='.repeat(60))

  // Step 1: Get all locations from database
  console.log('\n📋 Step 1: Fetching locations from database...')
  const locations = await prisma.$queryRaw`
    SELECT square_location_id, organization_id, name
    FROM locations
    WHERE square_location_id IS NOT NULL
  `
  
  if (!locations || locations.length === 0) {
    console.error('❌ No locations found in database')
    return
  }

  console.log(`   ✅ Found ${locations.length} location(s)`)
  const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)

  // Step 2: Fetch orders from Square API for December 2023
  console.log('\n📡 Step 2: Fetching orders from Square API for December 2023...')
  
  const squareOrders = []
  let totalFetched = 0

  for (const locationId of locationIds) {
    console.log(`\n   📍 Checking location: ${locationId}...`)
    
    let cursor = null
    let locationCount = 0

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
            stateFilter: {
              states: ['OPEN', 'COMPLETED', 'CANCELED']
            }
          }
        },
        locationIds: [locationId],
        limit: 100
      }
      
      if (cursor) {
        searchRequest.cursor = cursor
      }

      try {
        const response = await ordersApi.searchOrders(searchRequest)
        const orders = response.result?.orders || []
        cursor = response.result?.cursor

        for (const order of orders) {
          squareOrders.push({
            orderId: order.id,
            state: order.state || 'UNKNOWN',
            locationId: order.locationId || order.location_id || locationId,
            customerId: order.customerId || order.customer_id || null,
            createdAt: order.createdAt || order.created_at || null,
            updatedAt: order.updatedAt || order.updated_at || null,
            version: order.version || null
          })
        }

        locationCount += orders.length
        totalFetched += orders.length
        console.log(`      ✅ Found ${orders.length} orders in this batch (Total for location: ${locationCount})`)

        if (cursor) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      } catch (apiError) {
        console.error(`      ❌ Error fetching orders for location ${locationId}:`, apiError.message)
        if (apiError.errors) {
          console.error('      Square API errors:', JSON.stringify(apiError.errors, null, 2))
        }
        break
      }
    } while (cursor)

    console.log(`   ✅ Total orders for location ${locationId}: ${locationCount}`)
    
    // Delay between locations
    if (locationIds.indexOf(locationId) < locationIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  console.log(`\n✅ Total orders fetched from Square API: ${squareOrders.length}`)

  // Step 3: Check which orders are in the database
  console.log('\n💾 Step 3: Checking which orders are in the database...')
  
  const squareOrderIds = squareOrders.map(o => o.orderId)
  const dbOrders = await prisma.$queryRaw`
    SELECT 
      o.order_id,
      o.state,
      o.created_at as db_created_at,
      COUNT(oli.id)::int as line_item_count
    FROM orders o
    LEFT JOIN order_line_items oli ON o.id = oli.order_id
    WHERE o.order_id = ANY(${squareOrderIds})
    GROUP BY o.order_id, o.state, o.created_at
  `

  const dbOrderIds = new Set(dbOrders.map(o => o.order_id))
  
  console.log(`   ✅ Found ${dbOrders.length} orders in database`)
  console.log(`   📊 Orders in Square but not in DB: ${squareOrders.length - dbOrders.length}`)

  // Step 4: Analyze by state
  console.log('\n📊 Step 4: Analyzing orders by state...')
  
  const byState = {}
  squareOrders.forEach(order => {
    const state = order.state || 'UNKNOWN'
    byState[state] = (byState[state] || 0) + 1
  })

  console.log('\n   Orders in Square API:')
  Object.entries(byState).forEach(([state, count]) => {
    console.log(`      ${state}: ${count}`)
  })

  const dbByState = {}
  dbOrders.forEach(order => {
    const state = order.state || 'NULL'
    dbByState[state] = (dbByState[state] || 0) + 1
  })

  console.log('\n   Orders in Database:')
  Object.entries(dbByState).forEach(([state, count]) => {
    console.log(`      ${state}: ${count}`)
  })

  // Step 5: Find missing orders
  console.log('\n🔍 Step 5: Finding missing orders...')
  
  const missingOrders = squareOrders.filter(order => !dbOrderIds.has(order.orderId))
  
  console.log(`   ❌ Missing orders: ${missingOrders.length}`)
  
  if (missingOrders.length > 0) {
    console.log('\n   Missing orders breakdown by state:')
    const missingByState = {}
    missingOrders.forEach(order => {
      const state = order.state || 'UNKNOWN'
      missingByState[state] = (missingByState[state] || 0) + 1
    })
    Object.entries(missingByState).forEach(([state, count]) => {
      console.log(`      ${state}: ${count}`)
    })

    console.log('\n   Sample missing orders (first 20):')
    missingOrders.slice(0, 20).forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.orderId}`)
      console.log(`      State: ${order.state}`)
      console.log(`      Created: ${order.createdAt || 'N/A'}`)
      console.log(`      Location: ${order.locationId}`)
      console.log(`      Customer: ${order.customerId || 'N/A'}`)
    })

    if (missingOrders.length > 20) {
      console.log(`\n   ... and ${missingOrders.length - 20} more missing orders`)
    }
  }

  // Step 6: Check cancelled orders specifically
  console.log('\n❌ Step 6: Checking cancelled orders...')
  
  const cancelledInSquare = squareOrders.filter(o => o.state === 'CANCELED')
  const cancelledInDb = dbOrders.filter(o => o.state === 'CANCELED')
  
  console.log(`   Cancelled orders in Square API: ${cancelledInSquare.length}`)
  console.log(`   Cancelled orders in Database: ${cancelledInDb.length}`)
  
  const missingCancelled = cancelledInSquare.filter(o => !dbOrderIds.has(o.orderId))
  console.log(`   Missing cancelled orders: ${missingCancelled.length}`)
  
  if (missingCancelled.length > 0) {
    console.log('\n   Missing cancelled orders:')
    missingCancelled.forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.orderId}`)
      console.log(`      Created: ${order.createdAt || 'N/A'}`)
      console.log(`      Location: ${order.locationId}`)
    })
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('\n📊 SUMMARY:')
  console.log(`   Total orders in Square API (Dec 2023): ${squareOrders.length}`)
  console.log(`   Total orders in Database: ${dbOrders.length}`)
  console.log(`   Missing orders: ${missingOrders.length}`)
  console.log(`   Cancelled orders in Square: ${cancelledInSquare.length}`)
  console.log(`   Cancelled orders in Database: ${cancelledInDb.length}`)
  console.log(`   Missing cancelled orders: ${missingCancelled.length}`)

  await prisma.$disconnect()
}

checkDecember2023Orders()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    console.error('   Stack:', error.stack)
    process.exit(1)
  })

