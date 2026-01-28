#!/usr/bin/env node
/**
 * Test script to fetch a specific order from Square and analyze technician information
 */

require('dotenv').config()

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

async function testOrderTechnicianExtraction() {
  const orderId = 'RQNfktNCBiZUvJ7ACllbMTMrJiSZY'
  
  console.log('🔍 Testing Order Technician Extraction\n')
  console.log('='.repeat(60))
  console.log(`Order ID: ${orderId}\n`)

  try {
    // Fetch order from Square API
    console.log('📡 Fetching order from Square API...\n')
    const orderResponse = await ordersApi.retrieveOrder(orderId)
    const order = orderResponse.result?.order
    
    if (!order) {
      console.error('❌ Order not found in Square API')
      return
    }

    console.log('✅ Order fetched successfully\n')
    console.log('='.repeat(60))
    console.log('\n📦 ORDER STRUCTURE:\n')
    console.log(`Order ID: ${order.id}`)
    console.log(`State: ${order.state}`)
    console.log(`Location ID: ${order.locationId || order.location_id}`)
    console.log(`Customer ID: ${order.customerId || order.customer_id || 'N/A'}`)
    console.log(`Version: ${order.version}`)
    console.log(`Created At: ${order.createdAt || order.created_at}`)
    console.log(`Updated At: ${order.updatedAt || order.updated_at}`)

    // Check line items
    const lineItems = order.lineItems || order.line_items || []
    console.log(`\n📋 LINE ITEMS: ${lineItems.length}\n`)

    if (lineItems.length === 0) {
      console.log('⚠️  No line items found in order')
      return
    }

    // Analyze each line item
    for (let i = 0; i < lineItems.length; i++) {
      const lineItem = lineItems[i]
      console.log('='.repeat(60))
      console.log(`\n📦 LINE ITEM ${i + 1}:\n`)
      console.log(`UID: ${lineItem.uid || 'N/A'}`)
      console.log(`Name: ${lineItem.name || 'N/A'}`)
      console.log(`Service Variation ID: ${lineItem.catalogObjectId || lineItem.catalog_object_id || lineItem.serviceVariationId || lineItem.service_variation_id || 'N/A'}`)
      console.log(`Quantity: ${lineItem.quantity || 'N/A'}`)
      console.log(`Item Type: ${lineItem.itemType || lineItem.item_type || 'N/A'}`)

      // Check for appliedServiceCharges
      const appliedServiceCharges = lineItem.appliedServiceCharges || lineItem.applied_service_charges || []
      console.log(`\n💰 Applied Service Charges: ${appliedServiceCharges.length}`)
      
      if (appliedServiceCharges.length > 0) {
        console.log('\n   Service Charge Details:')
        appliedServiceCharges.forEach((charge, idx) => {
          console.log(`\n   Charge ${idx + 1}:`)
          console.log(`     UID: ${charge.uid || 'N/A'}`)
          console.log(`     Name: ${charge.name || 'N/A'}`)
          console.log(`     Amount: ${charge.appliedMoney?.amount || charge.applied_money?.amount || 'N/A'} ${charge.appliedMoney?.currency || charge.applied_money?.currency || ''}`)
          console.log(`     Team Member ID: ${charge.teamMemberId || charge.team_member_id || 'N/A'}`)
          console.log(`     Type: ${charge.type || 'N/A'}`)
          
          // Check if this is a technician charge
          const uid = (charge.uid || '').toLowerCase()
          const name = (charge.name || '').toLowerCase()
          if (uid.includes('technician') || name.includes('technician') || uid === 'technician') {
            console.log(`     ✅ THIS IS A TECHNICIAN CHARGE!`)
            if (charge.teamMemberId || charge.team_member_id) {
              console.log(`     ✅ Has Team Member ID: ${charge.teamMemberId || charge.team_member_id}`)
            } else {
              console.log(`     ⚠️  No Team Member ID in this charge`)
            }
          }
        })
      } else {
        console.log('   ⚠️  No applied service charges found')
      }

      // Check for other possible technician fields
      console.log(`\n🔍 Other Fields Check:`)
      console.log(`   Line Item Keys: ${Object.keys(lineItem).join(', ')}`)
      
      // Check if there's a direct teamMemberId field
      if (lineItem.teamMemberId || lineItem.team_member_id) {
        console.log(`   ✅ Direct Team Member ID: ${lineItem.teamMemberId || lineItem.team_member_id}`)
      } else {
        console.log(`   ℹ️  No direct teamMemberId field`)
      }

      // Show full line item JSON structure (handle BigInt)
      console.log(`\n📄 Full Line Item JSON (first 1000 chars):`)
      const convertBigInt = (obj) => {
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
      const lineItemJson = JSON.stringify(convertBigInt(lineItem), null, 2)
      console.log(lineItemJson.substring(0, 1000) + (lineItemJson.length > 1000 ? '...' : ''))
    }

    // Check order-level service charges
    const orderServiceCharges = order.serviceCharges || order.service_charges || []
    console.log('\n' + '='.repeat(60))
    console.log(`\n💰 ORDER-LEVEL SERVICE CHARGES: ${orderServiceCharges.length}\n`)
    
    if (orderServiceCharges.length > 0) {
      orderServiceCharges.forEach((charge, idx) => {
        console.log(`Charge ${idx + 1}:`)
        console.log(`  UID: ${charge.uid || 'N/A'}`)
        console.log(`  Name: ${charge.name || 'N/A'}`)
        console.log(`  Team Member ID: ${charge.teamMemberId || charge.team_member_id || 'N/A'}`)
        console.log(`  Type: ${charge.type || 'N/A'}`)
      })
    } else {
      console.log('⚠️  No order-level service charges')
    }

    // Check for any other technician-related fields in order
    console.log('\n' + '='.repeat(60))
    console.log('\n🔍 ORDER-LEVEL FIELDS CHECK:\n')
    console.log(`Order Keys: ${Object.keys(order).join(', ')}`)
    
    // Check for metadata or other fields
    if (order.metadata) {
      console.log(`\nMetadata: ${JSON.stringify(order.metadata, null, 2)}`)
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('\n📊 SUMMARY:\n')
    
    let totalTechnicianCharges = 0
    let totalTeamMemberIds = 0
    
    for (const lineItem of lineItems) {
      const appliedServiceCharges = lineItem.appliedServiceCharges || lineItem.applied_service_charges || []
      for (const charge of appliedServiceCharges) {
        const uid = (charge.uid || '').toLowerCase()
        const name = (charge.name || '').toLowerCase()
        if (uid.includes('technician') || name.includes('technician') || uid === 'technician') {
          totalTechnicianCharges++
          if (charge.teamMemberId || charge.team_member_id) {
            totalTeamMemberIds++
          }
        }
      }
    }
    
    console.log(`Total Line Items: ${lineItems.length}`)
    console.log(`Line Items with Technician Charges: ${totalTechnicianCharges}`)
    console.log(`Technician Charges with Team Member ID: ${totalTeamMemberIds}`)
    
    if (totalTeamMemberIds > 0) {
      console.log(`\n✅ SUCCESS: Found ${totalTeamMemberIds} technician(s) with Team Member IDs in Square order data!`)
      console.log(`   We can extract technician_id from Square order data.`)
    } else {
      console.log(`\n⚠️  WARNING: No technician Team Member IDs found in Square order data.`)
      console.log(`   Technician info may not be available in order data.`)
      console.log(`   May need to use bookings table as fallback.`)
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.errors) {
      console.error('Square API errors:', JSON.stringify(error.errors, null, 2))
    }
    throw error
  }
}

testOrderTechnicianExtraction()
  .then(() => {
    console.log('\n✅ Test complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Test failed:', error)
    process.exit(1)
  })

