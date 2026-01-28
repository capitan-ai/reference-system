#!/usr/bin/env node
/**
 * Test multiple orders to see if any have technician info in Square data
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

async function testMultipleOrders() {
  console.log('🔍 Testing Multiple Orders for Technician Info\n')
  console.log('='.repeat(60))

  try {
    // Get recent orders from database that have technician_id
    const ordersWithTechnician = await prisma.$queryRaw`
      SELECT DISTINCT o.order_id, o.state, o.created_at
      FROM orders o
      INNER JOIN order_line_items oli ON o.id = oli.order_id
      WHERE oli.technician_id IS NOT NULL
        AND oli.order_created_at >= NOW() - INTERVAL '30 days'
      ORDER BY o.created_at DESC
      LIMIT 10
    `

    console.log(`📊 Found ${ordersWithTechnician.length} recent orders with technician_id in database\n`)

    if (ordersWithTechnician.length === 0) {
      console.log('⚠️  No orders with technician_id found')
      return
    }

    let foundInSquare = 0
    let notFoundInSquare = 0

    for (const order of ordersWithTechnician) {
      try {
        console.log(`\n📦 Testing Order: ${order.order_id}`)
        console.log(`   State: ${order.state}`)
        
        const orderResponse = await ordersApi.retrieveOrder(order.order_id)
        const squareOrder = orderResponse.result?.order
        
        if (!squareOrder) {
          console.log(`   ⚠️  Order not found in Square`)
          notFoundInSquare++
          continue
        }

        const lineItems = squareOrder.lineItems || squareOrder.line_items || []
        let hasTechnicianInfo = false

        for (const lineItem of lineItems) {
          const appliedServiceCharges = lineItem.appliedServiceCharges || lineItem.applied_service_charges || []
          
          for (const charge of appliedServiceCharges) {
            if (charge.teamMemberId || charge.team_member_id) {
              hasTechnicianInfo = true
              console.log(`   ✅ FOUND: Line item "${lineItem.name}" has teamMemberId: ${charge.teamMemberId || charge.team_member_id}`)
              break
            }
          }
          
          if (hasTechnicianInfo) break
        }

        if (hasTechnicianInfo) {
          foundInSquare++
        } else {
          console.log(`   ⚠️  No technician info in Square order data`)
          notFoundInSquare++
        }

        // Small delay
        await new Promise(resolve => setTimeout(resolve, 200))

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`)
        notFoundInSquare++
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`Total Orders Tested: ${ordersWithTechnician.length}`)
    console.log(`✅ Orders with Technician Info in Square: ${foundInSquare}`)
    console.log(`⚠️  Orders without Technician Info in Square: ${notFoundInSquare}`)
    
    if (foundInSquare > 0) {
      console.log(`\n✅ SUCCESS: Some orders DO have technician info in Square data!`)
      console.log(`   We can extract technician_id from Square for ${foundInSquare} out of ${ordersWithTechnician.length} orders.`)
    } else {
      console.log(`\n⚠️  WARNING: NO orders have technician info in Square order data.`)
      console.log(`   Technician info must come from bookings table.`)
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testMultipleOrders()
  .then(() => {
    console.log('\n✅ Test complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })

