#!/usr/bin/env node
/**
 * Test recent orders to see their structure and if any have service charges
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

function convertBigInt(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return obj.toString()
  if (Array.isArray(obj)) return obj.map(convertBigInt)
  if (typeof obj === 'object') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertBigInt(value)
    }
    return result
  }
  return obj
}

async function testRecentOrders() {
  console.log('🔍 Testing Recent Orders Structure\n')
  console.log('='.repeat(60))

  try {
    // Get recent orders from database
    const recentOrders = await prisma.$queryRaw`
      SELECT DISTINCT o.order_id, o.state, o.created_at
      FROM orders o
      WHERE o.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY o.created_at DESC
      LIMIT 5
    `

    console.log(`📊 Testing ${recentOrders.length} recent orders\n`)

    if (recentOrders.length === 0) {
      console.log('⚠️  No recent orders found')
      return
    }

    let ordersWithServiceCharges = 0
    let ordersWithTeamMemberIds = 0

    for (const order of recentOrders) {
      try {
        console.log(`\n📦 Order: ${order.order_id}`)
        console.log(`   State: ${order.state}`)
        
        const orderResponse = await ordersApi.retrieveOrder(order.order_id)
        const squareOrder = orderResponse.result?.order
        
        if (!squareOrder) {
          console.log(`   ⚠️  Not found in Square`)
          continue
        }

        const lineItems = squareOrder.lineItems || squareOrder.line_items || []
        console.log(`   Line Items: ${lineItems.length}`)

        let hasServiceCharges = false
        let hasTeamMemberId = false

        for (const lineItem of lineItems) {
          const appliedServiceCharges = lineItem.appliedServiceCharges || lineItem.applied_service_charges || []
          
          if (appliedServiceCharges.length > 0) {
            hasServiceCharges = true
            console.log(`   ✅ Line Item "${lineItem.name}" has ${appliedServiceCharges.length} service charge(s)`)
            
            for (const charge of appliedServiceCharges) {
              console.log(`      Charge: ${charge.name || charge.uid || 'unnamed'}`)
              console.log(`      Team Member ID: ${charge.teamMemberId || charge.team_member_id || 'N/A'}`)
              
              if (charge.teamMemberId || charge.team_member_id) {
                hasTeamMemberId = true
                console.log(`      ✅ HAS TEAM MEMBER ID!`)
              }
            }
          }
        }

        // Check order-level service charges
        const orderServiceCharges = squareOrder.serviceCharges || squareOrder.service_charges || []
        if (orderServiceCharges.length > 0) {
          console.log(`   ✅ Order has ${orderServiceCharges.length} order-level service charge(s)`)
          hasServiceCharges = true
          
          for (const charge of orderServiceCharges) {
            if (charge.teamMemberId || charge.team_member_id) {
              hasTeamMemberId = true
              console.log(`      ✅ Order-level charge has Team Member ID: ${charge.teamMemberId || charge.team_member_id}`)
            }
          }
        }

        if (hasServiceCharges) ordersWithServiceCharges++
        if (hasTeamMemberId) ordersWithTeamMemberIds++

        // Show full order structure (first order only)
        if (order === recentOrders[0]) {
          console.log(`\n   📄 Full Order Structure (first order):`)
          const orderJson = JSON.stringify(convertBigInt(squareOrder), null, 2)
          console.log(orderJson.substring(0, 2000) + (orderJson.length > 2000 ? '...' : ''))
        }

        await new Promise(resolve => setTimeout(resolve, 200))

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`)
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    console.log(`Orders Tested: ${recentOrders.length}`)
    console.log(`Orders with Service Charges: ${ordersWithServiceCharges}`)
    console.log(`Orders with Team Member IDs: ${ordersWithTeamMemberIds}`)
    
    if (ordersWithTeamMemberIds > 0) {
      console.log(`\n✅ SUCCESS: Found ${ordersWithTeamMemberIds} order(s) with Team Member IDs in Square data!`)
    } else {
      console.log(`\n⚠️  WARNING: No orders have Team Member IDs in Square order data.`)
      console.log(`   Technician info is NOT available in Square order/line item data.`)
      console.log(`   Must use bookings table as the source.`)
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testRecentOrders()
  .then(() => {
    console.log('\n✅ Test complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })



