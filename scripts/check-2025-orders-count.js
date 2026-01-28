#!/usr/bin/env node
/**
 * Check count of all orders from 2025 via Square API
 * Compare with database
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
} catch (error) {
  console.error('Failed to initialize Square SDK:', error.message)
  process.exit(1)
}

// 2025 date range
const startDate = new Date('2025-01-01T00:00:00Z')
const endDate = new Date('2025-12-31T23:59:59Z')
const beginTime = startDate.toISOString()
const endTime = endDate.toISOString()

console.log('📅 Date Range: 2025')
console.log(`   Start: ${startDate.toISOString()}`)
console.log(`   End:   ${endDate.toISOString()}`)
console.log('')

async function check2025OrdersCount() {
  console.log('🔍 Checking 2025 Orders Count\n')
  console.log('='.repeat(60))

  // Get all locations
  const locations = await prisma.$queryRaw`
    SELECT square_location_id, organization_id, name
    FROM locations
    WHERE square_location_id IS NOT NULL
  `
  
  if (!locations || locations.length === 0) {
    console.error('❌ No locations found in database')
    return
  }

  console.log(`\n📋 Found ${locations.length} location(s)\n`)

  const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)
  let totalSquareOrders = 0
  const ordersByState = {
    COMPLETED: 0,
    CANCELED: 0,
    OPEN: 0,
    OTHER: 0
  }

  // Fetch orders from Square API
  for (const locationId of locationIds) {
    console.log(`📍 Checking location: ${locationId}...`)
    
    let cursor = null
    let locationCount = 0
    let batchCount = 0

    do {
      batchCount++
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
          const state = order.state || 'OTHER'
          if (ordersByState[state] !== undefined) {
            ordersByState[state]++
          } else {
            ordersByState.OTHER++
          }
        }

        locationCount += orders.length
        totalSquareOrders += orders.length
        
        if (batchCount % 50 === 0 || !cursor) {
          console.log(`   Batch ${batchCount}: ${orders.length} orders (Total for location: ${locationCount})`)
        }

        if (cursor) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      } catch (apiError) {
        console.error(`   ❌ Error fetching orders:`, apiError.message)
        if (apiError.errors) {
          console.error('   Square API errors:', JSON.stringify(apiError.errors, null, 2))
        }
        break
      }
    } while (cursor)

    console.log(`   ✅ Total orders for location ${locationId}: ${locationCount}\n`)
    
    if (locationIds.indexOf(locationId) < locationIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  // Check database
  console.log('💾 Checking database...\n')
  
  const dbOrders = await prisma.$queryRaw`
    SELECT 
      COUNT(DISTINCT o.id)::int as total,
      COUNT(DISTINCT o.id) FILTER (WHERE o.state = 'COMPLETED')::int as completed,
      COUNT(DISTINCT o.id) FILTER (WHERE o.state = 'CANCELED')::int as canceled,
      COUNT(DISTINCT o.id) FILTER (WHERE o.state = 'OPEN')::int as open,
      COUNT(DISTINCT o.id) FILTER (WHERE o.state IS NULL)::int as null_state
    FROM orders o
    INNER JOIN order_line_items oli ON o.id = oli.order_id
    WHERE oli.order_created_at >= '2025-01-01'
      AND oli.order_created_at < '2026-01-01'
  `

  const dbCount = dbOrders[0] || { total: 0, completed: 0, canceled: 0, open: 0, null_state: 0 }

  // Also check orders without line items (using orders.created_at as fallback)
  const dbOrdersNoLineItems = await prisma.$queryRaw`
    SELECT 
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE state = 'COMPLETED')::int as completed,
      COUNT(*) FILTER (WHERE state = 'CANCELED')::int as canceled,
      COUNT(*) FILTER (WHERE state = 'OPEN')::int as open,
      COUNT(*) FILTER (WHERE state IS NULL)::int as null_state
    FROM orders o
    LEFT JOIN order_line_items oli ON o.id = oli.order_id
    WHERE oli.id IS NULL
      AND o.created_at >= '2025-01-01'
      AND o.created_at < '2026-01-01'
  `

  const dbNoLineItems = dbOrdersNoLineItems[0] || { total: 0, completed: 0, canceled: 0, open: 0, null_state: 0 }

  // Summary
  console.log('='.repeat(60))
  console.log('\n📊 2025 ORDERS COUNT SUMMARY\n')

  console.log('📡 Square API:')
  console.log(`   Total orders: ${totalSquareOrders.toLocaleString()}`)
  console.log(`   COMPLETED: ${ordersByState.COMPLETED.toLocaleString()}`)
  console.log(`   CANCELED: ${ordersByState.CANCELED.toLocaleString()}`)
  console.log(`   OPEN: ${ordersByState.OPEN.toLocaleString()}`)
  console.log(`   OTHER: ${ordersByState.OTHER.toLocaleString()}`)

  console.log('\n💾 Database (with line items - using order_created_at):')
  console.log(`   Total orders: ${dbCount.total.toLocaleString()}`)
  console.log(`   COMPLETED: ${dbCount.completed.toLocaleString()}`)
  console.log(`   CANCELED: ${dbCount.canceled.toLocaleString()}`)
  console.log(`   OPEN: ${dbCount.open.toLocaleString()}`)
  console.log(`   NULL state: ${dbCount.null_state.toLocaleString()}`)

  console.log('\n💾 Database (without line items - using orders.created_at):')
  console.log(`   Total orders: ${dbNoLineItems.total.toLocaleString()}`)
  console.log(`   COMPLETED: ${dbNoLineItems.completed.toLocaleString()}`)
  console.log(`   CANCELED: ${dbNoLineItems.canceled.toLocaleString()}`)
  console.log(`   OPEN: ${dbNoLineItems.open.toLocaleString()}`)
  console.log(`   NULL state: ${dbNoLineItems.null_state.toLocaleString()}`)

  const totalDbOrders = dbCount.total + dbNoLineItems.total
  const missingOrders = totalSquareOrders - totalDbOrders

  console.log('\n' + '='.repeat(60))
  console.log('\n📈 COMPARISON:\n')
  console.log(`   Square API total: ${totalSquareOrders.toLocaleString()}`)
  console.log(`   Database total: ${totalDbOrders.toLocaleString()}`)
  console.log(`   Missing orders: ${missingOrders.toLocaleString()}`)
  console.log(`   Coverage: ${totalSquareOrders > 0 ? ((totalDbOrders / totalSquareOrders) * 100).toFixed(2) : 0}%`)

  // Cancelled orders comparison
  const totalCancelledSquare = ordersByState.CANCELED
  const totalCancelledDb = dbCount.canceled + dbNoLineItems.canceled
  const missingCancelled = totalCancelledSquare - totalCancelledDb

  console.log('\n❌ CANCELLED ORDERS:')
  console.log(`   Square API: ${totalCancelledSquare.toLocaleString()}`)
  console.log(`   Database: ${totalCancelledDb.toLocaleString()}`)
  console.log(`   Missing: ${missingCancelled.toLocaleString()}`)

  await prisma.$disconnect()
}

check2025OrdersCount()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    console.error('   Stack:', error.stack)
    process.exit(1)
  })



