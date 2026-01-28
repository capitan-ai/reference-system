#!/usr/bin/env node
/**
 * Check count of all orders from 2023 via Square API
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

// 2023 date range
const startDate = new Date('2023-01-01T00:00:00Z')
const endDate = new Date('2023-12-31T23:59:59Z')
const beginTime = startDate.toISOString()
const endTime = endDate.toISOString()

async function check2023OrdersCount() {
  console.log('🔍 Checking 2023 Orders Count\n')
  console.log('='.repeat(60))

  const locations = await prisma.$queryRaw`
    SELECT square_location_id FROM locations WHERE square_location_id IS NOT NULL
  `
  
  const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)
  let totalSquareOrders = 0
  const ordersByState = { COMPLETED: 0, CANCELED: 0, OPEN: 0, OTHER: 0 }

  for (const locationId of locationIds) {
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
          const state = order.state || 'OTHER'
          if (ordersByState[state] !== undefined) {
            ordersByState[state]++
          } else {
            ordersByState.OTHER++
          }
        }

        locationCount += orders.length
        totalSquareOrders += orders.length

        if (cursor) await new Promise(resolve => setTimeout(resolve, 200))
      } catch (apiError) {
        console.error(`❌ Error:`, apiError.message)
        break
      }
    } while (cursor)

    console.log(`📍 Location ${locationId}: ${locationCount} orders`)
  }

  const dbOrders = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT o.id)::int as total
    FROM orders o
    INNER JOIN order_line_items oli ON o.id = oli.order_id
    WHERE oli.order_created_at >= '2023-01-01' AND oli.order_created_at < '2024-01-01'
  `

  console.log('\n📊 2023 ORDERS COUNT:')
  console.log(`   Square API: ${totalSquareOrders.toLocaleString()}`)
  console.log(`   COMPLETED: ${ordersByState.COMPLETED.toLocaleString()}`)
  console.log(`   CANCELED: ${ordersByState.CANCELED.toLocaleString()}`)
  console.log(`   OPEN: ${ordersByState.OPEN.toLocaleString()}`)
  console.log(`   Database: ${dbOrders[0].total.toLocaleString()}`)
  console.log(`   Missing: ${totalSquareOrders - dbOrders[0].total}`)

  await prisma.$disconnect()
}

check2023OrdersCount()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })



