#!/usr/bin/env node
/**
 * Check line items for orders missing from database by fetching from Square API
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

async function checkOrders() {
  console.log('🔍 Checking Line Items for Missing Orders\n')
  console.log('='.repeat(60))

  try {
    // First, get all 2025 orders from Square API to compare
    console.log('📡 Fetching all 2025 orders from Square API to identify missing ones...\n')
    
    const startDate = new Date('2025-01-01T00:00:00Z')
    const endDate = new Date('2025-12-31T23:59:59Z')
    const beginTime = startDate.toISOString()
    const endTime = endDate.toISOString()

    const locations = await prisma.$queryRaw`
      SELECT square_location_id FROM locations WHERE square_location_id IS NOT NULL
    `
    
    const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)
    const square2025OrderIds = new Set()
    let totalFetched = 0

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
          totalFetched += orders.length
        } catch (apiError) {
          console.error(`❌ Error fetching from location ${locationId}: ${apiError.message}`)
          break
        }
      } while (cursor)
    }

    console.log(`✅ Found ${totalFetched} orders from Square API (2025)`)
    console.log(`   Unique order IDs: ${square2025OrderIds.size}\n`)

    // Now find which of these 2025 orders don't have line items in DB
    const squareOrderIdsArray = Array.from(square2025OrderIds)
    
    const missingLineItems = await prisma.$queryRaw`
      SELECT DISTINCT o.order_id, o.state, o.created_at
      FROM orders o
      WHERE o.order_id = ANY(${squareOrderIdsArray}::text[])
        AND o.id NOT IN (
          SELECT DISTINCT order_id 
          FROM order_line_items 
          WHERE order_created_at >= '2025-01-01' 
            AND order_created_at < '2026-01-01'
        )
      ORDER BY o.order_id
    `

    console.log(`\n📊 Found ${missingLineItems.length} orders without 2025 line items\n`)

    if (missingLineItems.length === 0) {
      console.log('✅ All orders have line items!')
      return
    }

    // Fetch from Square and check
    const results = {
      hasLineItems: [],
      noLineItems: [],
      errors: [],
      cancelled: [],
      completed: [],
      open: []
    }

    const BATCH_SIZE = 50
    let processed = 0

    console.log(`🔄 Fetching order details from Square API...\n`)

    for (let i = 0; i < missingLineItems.length; i += BATCH_SIZE) {
      const batch = missingLineItems.slice(i, i + BATCH_SIZE)
      
      const batchResults = await Promise.all(
        batch.map(async (order) => {
          try {
            const orderResponse = await ordersApi.retrieveOrder(order.order_id)
            const squareOrder = orderResponse.result?.order
            
            if (!squareOrder) {
              return { order_id: order.order_id, found: false }
            }

            const lineItems = squareOrder.lineItems || squareOrder.line_items || []
            const orderState = squareOrder.state || order.state
            const createdAt = squareOrder.createdAt || squareOrder.created_at
            const orderDate = createdAt ? new Date(createdAt) : null
            const is2025 = orderDate && orderDate >= new Date('2025-01-01') && orderDate < new Date('2026-01-01')

            return {
              order_id: order.order_id,
              found: true,
              hasLineItems: lineItems.length > 0,
              lineItemCount: lineItems.length,
              state: orderState,
              createdAt: createdAt,
              is2025: is2025,
              lineItems: lineItems.map(item => ({
                uid: item.uid,
                name: item.name,
                quantity: item.quantity,
                itemType: item.itemType || item.item_type
              }))
            }
          } catch (error) {
            return {
              order_id: order.order_id,
              found: false,
              error: error.message
            }
          }
        })
      )

      for (const result of batchResults) {
        processed++
        
        if (!result.found) {
          results.errors.push(result)
        } else if (result.hasLineItems) {
          results.hasLineItems.push(result)
          if (result.state === 'CANCELED') results.cancelled.push(result)
          else if (result.state === 'COMPLETED') results.completed.push(result)
          else if (result.state === 'OPEN') results.open.push(result)
        } else {
          results.noLineItems.push(result)
        }
      }

      if (processed % 100 === 0 || processed === missingLineItems.length) {
        console.log(`   Progress: ${processed}/${missingLineItems.length} (${results.hasLineItems.length} with line items, ${results.noLineItems.length} without, ${results.errors.length} errors)`)
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Total orders checked: ${missingLineItems.length}`)
    console.log(`   ✅ Orders with line items in Square: ${results.hasLineItems.length}`)
    console.log(`   ⚠️  Orders without line items in Square: ${results.noLineItems.length}`)
    console.log(`   ❌ Errors fetching from Square: ${results.errors.length}`)

    console.log(`\n📊 By State (orders with line items):`)
    console.log(`   COMPLETED: ${results.completed.length}`)
    console.log(`   CANCELED: ${results.cancelled.length}`)
    console.log(`   OPEN: ${results.open.length}`)

    // Show sample orders with line items
    if (results.hasLineItems.length > 0) {
      console.log(`\n📦 Sample orders WITH line items (first 10):`)
      results.hasLineItems.slice(0, 10).forEach(order => {
        console.log(`   ${order.order_id}: ${order.lineItemCount} items, state=${order.state}, created=${order.createdAt}`)
        if (order.lineItems && order.lineItems.length > 0) {
          order.lineItems.slice(0, 2).forEach(item => {
            console.log(`      - ${item.name || 'N/A'} (${item.quantity || 'N/A'}x, type: ${item.itemType || 'N/A'})`)
          })
        }
      })
    }

    // Show sample orders without line items
    if (results.noLineItems.length > 0) {
      console.log(`\n⚠️  Sample orders WITHOUT line items (first 10):`)
      results.noLineItems.slice(0, 10).forEach(order => {
        console.log(`   ${order.order_id}: state=${order.state}, created=${order.createdAt}`)
      })
    }

    // Show errors
    if (results.errors.length > 0) {
      console.log(`\n❌ Errors (first 10):`)
      results.errors.slice(0, 10).forEach(error => {
        console.log(`   ${error.order_id}: ${error.error || 'Not found'}`)
      })
    }

    // Check if orders are actually from 2025
    const ordersFrom2025 = results.hasLineItems.filter(o => o.is2025)
    const ordersNotFrom2025 = results.hasLineItems.filter(o => !o.is2025)

    console.log(`\n📅 Date Analysis (orders with line items):`)
    console.log(`   Orders from 2025: ${ordersFrom2025.length}`)
    console.log(`   Orders NOT from 2025: ${ordersNotFrom2025.length}`)

    if (ordersNotFrom2025.length > 0) {
      console.log(`\n⚠️  Orders with line items but NOT from 2025 (first 10):`)
      ordersNotFrom2025.slice(0, 10).forEach(order => {
        console.log(`   ${order.order_id}: created=${order.createdAt}, state=${order.state}`)
      })
    }

    // Recommendations
    console.log('\n' + '='.repeat(60))
    console.log('\n💡 RECOMMENDATIONS:\n')
    
    if (results.hasLineItems.length > 0) {
      console.log(`   ${results.hasLineItems.length} orders have line items in Square but are missing from database.`)
      console.log(`   These should be backfilled.`)
    }
    
    if (results.noLineItems.length > 0) {
      console.log(`   ${results.noLineItems.length} orders legitimately have no line items.`)
      console.log(`   These are likely test orders, custom amounts, or cancelled before items were added.`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkOrders()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })

