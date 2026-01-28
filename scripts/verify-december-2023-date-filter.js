#!/usr/bin/env node
/**
 * Verify that the date filter is working correctly for December 2023 orders
 * Check actual creation dates of returned orders
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

async function verifyDateFilter() {
  console.log('🔍 Verifying Date Filter for December 2023 Orders\n')
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
  const allOrders = []
  const dateAnalysis = {
    inRange: [],
    outOfRange: [],
    byMonth: {},
    byYear: {}
  }

  const MAX_ORDERS_TO_CHECK = 1000
  console.log(`⚠️  Limiting check to first ${MAX_ORDERS_TO_CHECK} orders for quick verification\n`)

  // Fetch orders from Square API
  for (const locationId of locationIds) {
    if (allOrders.length >= MAX_ORDERS_TO_CHECK) {
      console.log(`\n   ⏸️  Reached limit of ${MAX_ORDERS_TO_CHECK} orders, stopping...`)
      break
    }
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
          if (allOrders.length >= MAX_ORDERS_TO_CHECK) {
            break
          }

          const createdAt = order.createdAt || order.created_at
          const orderDate = createdAt ? new Date(createdAt) : null
          
          allOrders.push({
            orderId: order.id,
            state: order.state || 'UNKNOWN',
            createdAt: orderDate,
            createdAtStr: createdAt,
            locationId: order.locationId || order.location_id || locationId
          })

          if (orderDate) {
            const year = orderDate.getFullYear()
            const month = orderDate.getMonth() + 1
            const monthKey = `${year}-${String(month).padStart(2, '0')}`
            
            // Check if date is in December 2023
            if (orderDate >= startDate && orderDate <= endDate) {
              dateAnalysis.inRange.push({
                orderId: order.id,
                createdAt: orderDate,
                state: order.state
              })
            } else {
              dateAnalysis.outOfRange.push({
                orderId: order.id,
                createdAt: orderDate,
                state: order.state,
                monthKey
              })
            }

            // Count by month
            if (!dateAnalysis.byMonth[monthKey]) {
              dateAnalysis.byMonth[monthKey] = 0
            }
            dateAnalysis.byMonth[monthKey]++

            // Count by year
            if (!dateAnalysis.byYear[year]) {
              dateAnalysis.byYear[year] = 0
            }
            dateAnalysis.byYear[year]++
          } else {
            dateAnalysis.outOfRange.push({
              orderId: order.id,
              createdAt: null,
              state: order.state,
              monthKey: 'NO_DATE'
            })
          }
        }

        locationCount += orders.length
        if (batchCount % 10 === 0 || !cursor || allOrders.length >= MAX_ORDERS_TO_CHECK) {
          console.log(`   Batch ${batchCount}: ${orders.length} orders (Total: ${locationCount}, Checked: ${allOrders.length})`)
        }

        if (cursor && allOrders.length < MAX_ORDERS_TO_CHECK) {
          await new Promise(resolve => setTimeout(resolve, 200))
        } else {
          cursor = null // Stop pagination if we've reached the limit
        }
      } catch (apiError) {
        console.error(`   ❌ Error fetching orders:`, apiError.message)
        if (apiError.errors) {
          console.error('   Square API errors:', JSON.stringify(apiError.errors, null, 2))
        }
        break
      }
    } while (cursor)

    console.log(`   ✅ Total orders for location ${locationId}: ${locationCount} (Checked: ${allOrders.length})\n`)
    
    if (allOrders.length >= MAX_ORDERS_TO_CHECK) {
      console.log(`\n⏸️  Reached limit of ${MAX_ORDERS_TO_CHECK} orders, stopping location processing...\n`)
      break
    }
    
    if (locationIds.indexOf(locationId) < locationIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  console.log('='.repeat(60))
  console.log('\n📊 DATE FILTER VERIFICATION RESULTS\n')

  console.log(`Total orders returned: ${allOrders.length}`)
  console.log(`Orders in December 2023 range: ${dateAnalysis.inRange.length}`)
  console.log(`Orders OUTSIDE December 2023 range: ${dateAnalysis.outOfRange.length}`)

  if (dateAnalysis.outOfRange.length > 0) {
    console.log('\n⚠️  WARNING: Date filter may not be working correctly!')
    console.log(`   Found ${dateAnalysis.outOfRange.length} orders outside the requested date range\n`)
    
    console.log('📅 Orders by month:')
    const sortedMonths = Object.keys(dateAnalysis.byMonth).sort()
    sortedMonths.forEach(month => {
      console.log(`   ${month}: ${dateAnalysis.byMonth[month]} orders`)
    })

    console.log('\n📅 Orders by year:')
    const sortedYears = Object.keys(dateAnalysis.byYear).sort()
    sortedYears.forEach(year => {
      console.log(`   ${year}: ${dateAnalysis.byYear[year]} orders`)
    })

    console.log('\n🔍 Sample orders OUTSIDE December 2023 (first 20):')
    dateAnalysis.outOfRange.slice(0, 20).forEach((order, idx) => {
      console.log(`\n   ${idx + 1}. Order ID: ${order.orderId}`)
      console.log(`      Created: ${order.createdAt ? order.createdAt.toISOString() : 'NO_DATE'}`)
      console.log(`      State: ${order.state}`)
      console.log(`      Month: ${order.monthKey}`)
    })

    if (dateAnalysis.outOfRange.length > 20) {
      console.log(`\n   ... and ${dateAnalysis.outOfRange.length - 20} more out-of-range orders`)
    }
  } else {
    console.log('\n✅ Date filter is working correctly! All orders are from December 2023.')
  }

  // Analyze cancelled orders specifically
  console.log('\n' + '='.repeat(60))
  console.log('\n❌ CANCELLED ORDERS ANALYSIS\n')

  const cancelledInRange = dateAnalysis.inRange.filter(o => o.state === 'CANCELED')
  const cancelledOutOfRange = dateAnalysis.outOfRange.filter(o => o.state === 'CANCELED')

  console.log(`Cancelled orders in December 2023: ${cancelledInRange.length}`)
  console.log(`Cancelled orders outside December 2023: ${cancelledOutOfRange.length}`)

  if (cancelledOutOfRange.length > 0) {
    console.log('\n⚠️  Cancelled orders outside date range:')
    const cancelledByMonth = {}
    cancelledOutOfRange.forEach(order => {
      const month = order.monthKey
      cancelledByMonth[month] = (cancelledByMonth[month] || 0) + 1
    })
    
    Object.entries(cancelledByMonth).sort().forEach(([month, count]) => {
      console.log(`   ${month}: ${count} cancelled orders`)
    })
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('\n📊 SUMMARY:\n')
  console.log(`   Total orders returned: ${allOrders.length}`)
  console.log(`   Orders in December 2023: ${dateAnalysis.inRange.length}`)
  console.log(`   Orders outside December 2023: ${dateAnalysis.outOfRange.length}`)
  console.log(`   Cancelled orders in December 2023: ${cancelledInRange.length}`)
  console.log(`   Cancelled orders outside December 2023: ${cancelledOutOfRange.length}`)
  
  if (dateAnalysis.outOfRange.length > 0) {
    console.log('\n   ⚠️  RECOMMENDATION: Filter results by actual creation date before processing!')
  }

  await prisma.$disconnect()
}

verifyDateFilter()
  .then(() => {
    console.log('\n✅ Verification complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Verification failed:', error)
    console.error('   Stack:', error.stack)
    process.exit(1)
  })

