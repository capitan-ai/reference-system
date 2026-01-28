#!/usr/bin/env node
/**
 * Check if NULL state orders exist in Square API
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

async function checkNullOrdersInSquare() {
  console.log('🔍 Checking if NULL State Orders Exist in Square\n')
  console.log('='.repeat(60))

  try {
    // Get sample NULL state orders
    const nullStateOrders = await prisma.$queryRaw`
      SELECT 
        order_id,
        organization_id,
        created_at
      FROM orders
      WHERE state IS NULL
      ORDER BY created_at DESC
      LIMIT 20
    `

    console.log(`\n📊 Checking ${nullStateOrders.length} sample NULL state orders in Square API...\n`)

    let foundInSquare = 0
    let notFoundInSquare = 0
    let errors = 0

    for (const order of nullStateOrders) {
      try {
        const response = await ordersApi.retrieveOrder(order.order_id)
        const squareOrder = response.result?.order

        if (squareOrder) {
          foundInSquare++
          console.log(`   ✅ Order ${order.order_id}: Found in Square (state: ${squareOrder.state || 'N/A'})`)
        } else {
          notFoundInSquare++
          console.log(`   ❌ Order ${order.order_id}: Not found in Square`)
        }
      } catch (apiError) {
        errors++
        if (apiError.statusCode === 404) {
          notFoundInSquare++
          console.log(`   ❌ Order ${order.order_id}: Not found in Square (404)`)
        } else {
          console.log(`   ⚠️  Order ${order.order_id}: Error - ${apiError.message}`)
        }
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`   Checked: ${nullStateOrders.length} orders`)
    console.log(`   ✅ Found in Square: ${foundInSquare}`)
    console.log(`   ❌ Not found in Square: ${notFoundInSquare}`)
    console.log(`   ⚠️  Errors: ${errors}`)

    if (notFoundInSquare > 0) {
      console.log('\n⚠️  Some NULL state orders don\'t exist in Square!')
      console.log('   These might be orphaned records that should be cleaned up.')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkNullOrdersInSquare()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



