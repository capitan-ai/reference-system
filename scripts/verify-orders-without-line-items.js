#!/usr/bin/env node
/**
 * Verify if orders without line items actually have line items in Square
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

async function verifyOrdersWithoutLineItems() {
  console.log('🔍 Verifying Orders Without Line Items\n')
  console.log('='.repeat(60))

  try {
    // Get all orders from Square for all years
    const years = [2023, 2024, 2025, 2026]
    const allSquareOrderIds = new Set()

    const locations = await prisma.$queryRaw`
      SELECT square_location_id FROM locations WHERE square_location_id IS NOT NULL
    `
    
    const locationIds = locations.map(loc => loc.square_location_id).filter(Boolean)

    console.log('\n📡 Fetching all orders from Square API...\n')
    for (const year of years) {
      const startDate = new Date(`${year}-01-01T00:00:00Z`)
      const endDate = new Date(`${year}-12-31T23:59:59Z`)
      const beginTime = startDate.toISOString()
      const endTime = endDate.toISOString()

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
              allSquareOrderIds.add(order.id)
            }
          } catch (apiError) {
            break
          }
        } while (cursor)
      }
    }

    console.log(`✅ Found ${allSquareOrderIds.size} total orders from Square API\n`)

    // Find orders in DB that don't have line items
    const squareOrderIdsArray = Array.from(allSquareOrderIds)
    
    const ordersWithoutLineItems = await prisma.$queryRaw`
      SELECT DISTINCT o.order_id, o.state, o.created_at
      FROM orders o
      WHERE o.order_id = ANY(${squareOrderIdsArray}::text[])
        AND o.id NOT IN (
          SELECT DISTINCT order_id 
          FROM order_line_items
        )
      ORDER BY o.order_id
      LIMIT 100
    `

    console.log(`📊 Found ${ordersWithoutLineItems.length} orders without line items (sampling first 100)\n`)

    if (ordersWithoutLineItems.length === 0) {
      console.log('✅ All orders have line items!')
      return
    }

    console.log(`🔄 Checking if these orders have line items in Square...\n`)

    let hasLineItems = 0
    let noLineItems = 0
    let errors = 0
    let processed = 0

    for (const order of ordersWithoutLineItems) {
      try {
        const orderResponse = await ordersApi.retrieveOrder(order.order_id)
        const squareOrder = orderResponse.result?.order
        
        if (!squareOrder) {
          errors++
          continue
        }

        const lineItems = squareOrder.lineItems || squareOrder.line_items || []
        
        if (lineItems.length > 0) {
          hasLineItems++
          if (hasLineItems <= 10) {
            console.log(`   ✅ ${order.order_id}: Has ${lineItems.length} line items in Square (state: ${order.state})`)
          }
        } else {
          noLineItems++
          if (noLineItems <= 10) {
            console.log(`   ⚠️  ${order.order_id}: No line items in Square (state: ${order.state})`)
          }
        }

        processed++

        if (processed % 50 === 0) {
          console.log(`   Progress: ${processed}/${ordersWithoutLineItems.length} (${hasLineItems} with line items, ${noLineItems} without, ${errors} errors)`)
        }

        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (apiError) {
        errors++
        if (errors <= 5) {
          console.log(`   ❌ Error fetching ${order.order_id}: ${apiError.message}`)
        }
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 VERIFICATION SUMMARY:\n')
    console.log(`   Orders checked: ${processed}`)
    console.log(`   ✅ Have line items in Square: ${hasLineItems}`)
    console.log(`   ⚠️  No line items in Square: ${noLineItems}`)
    console.log(`   ❌ Errors: ${errors}`)

    if (hasLineItems > 0) {
      console.log(`\n💡 ${hasLineItems} orders have line items in Square but are missing from database.`)
      console.log(`   These should be backfilled.`)
    }

    if (noLineItems > 0) {
      console.log(`\n💡 ${noLineItems} orders legitimately have no line items.`)
      console.log(`   These are likely test orders, custom amounts, or cancelled before items were added.`)
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

verifyOrdersWithoutLineItems()
  .then(() => {
    console.log('\n✅ Verification complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Verification failed:', error)
    process.exit(1)
  })



