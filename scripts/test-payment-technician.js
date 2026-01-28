#!/usr/bin/env node
/**
 * Test if payments contain technician information
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Import Square SDK
let squareClient
let paymentsApi
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
  paymentsApi = squareClient.paymentsApi
  
  console.log(`🔑 Using Square ${squareEnvName} environment`)
} catch (error) {
  console.error('Failed to initialize Square SDK:', error.message)
  process.exit(1)
}

// Function to convert BigInt to string for JSON serialization
function convertBigIntToString(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return obj.toString()
  if (Array.isArray(obj)) return obj.map(convertBigIntToString)
  if (typeof obj === 'object') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertBigIntToString(value)
    }
    return result
  }
  return obj
}

async function testPaymentTechnician() {
  console.log('🧪 Testing Payment for Technician Information\n')
  console.log('='.repeat(60))

  try {
    // Get a recent payment from database that has an order_id
    const payment = await prisma.$queryRaw`
      SELECT payment_id, order_id, administrator_id, booking_id
      FROM payments
      WHERE order_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `

    if (!payment || payment.length === 0) {
      console.log('⚠️  No payments with order_id found in database')
      return
    }

    const paymentId = payment[0].payment_id
    const orderId = payment[0].order_id
    const administratorId = payment[0].administrator_id
    const bookingId = payment[0].booking_id

    console.log(`\n📦 Payment from Database:`)
    console.log(`   Payment ID: ${paymentId}`)
    console.log(`   Order ID: ${orderId}`)
    console.log(`   Administrator ID: ${administratorId || 'N/A'}`)
    console.log(`   Booking ID: ${bookingId || 'N/A'}`)

    // Fetch payment from Square API
    console.log(`\n🔍 Fetching payment from Square API...`)
    const paymentResponse = await paymentsApi.getPayment(paymentId)
    const squarePayment = paymentResponse.result?.payment

    if (!squarePayment) {
      console.log('❌ Payment not found in Square')
      return
    }

    console.log(`\n✅ Payment Data from Square:`)
    console.log(JSON.stringify(convertBigIntToString(squarePayment), null, 2))

    // Check for team member fields
    console.log(`\n🔍 Checking for Team Member Fields:`)
    console.log(`   teamMemberId: ${squarePayment.teamMemberId || squarePayment.team_member_id || 'N/A'}`)
    console.log(`   employeeId: ${squarePayment.employeeId || squarePayment.employee_id || 'N/A'}`)
    
    // Check order reference
    const orderRef = squarePayment.orderId || squarePayment.order_id
    console.log(`   orderId: ${orderRef || 'N/A'}`)

    // Check if payment has any line item or service information
    console.log(`\n🔍 Checking for Service/Line Item Information:`)
    if (squarePayment.refunds) {
      console.log(`   Has refunds: ${Array.isArray(squarePayment.refunds) ? squarePayment.refunds.length : 'N/A'}`)
    }
    if (squarePayment.refundedMoney) {
      console.log(`   Refunded money: ${JSON.stringify(squarePayment.refundedMoney)}`)
    }

    // Get the order to see line items
    if (orderRef) {
      console.log(`\n📦 Fetching Order from Square...`)
      const ordersApi = squareClient.ordersApi
      const orderResponse = await ordersApi.retrieveOrder(orderRef)
      const squareOrder = orderResponse.result?.order

      if (squareOrder) {
        console.log(`\n✅ Order Line Items:`)
        const lineItems = squareOrder.lineItems || squareOrder.line_items || []
        console.log(`   Found ${lineItems.length} line item(s)\n`)

        lineItems.forEach((item, idx) => {
          console.log(`   Line Item ${idx + 1}:`)
          console.log(`     Name: ${item.name || 'N/A'}`)
          console.log(`     Service Variation ID: ${item.catalogObjectId || item.catalog_object_id || 'N/A'}`)
          
          // Check for applied service charges
          const serviceCharges = item.appliedServiceCharges || item.applied_service_charges || []
          if (serviceCharges && serviceCharges.length > 0) {
            console.log(`     Applied Service Charges: ${serviceCharges.length}`)
            serviceCharges.forEach((charge, cIdx) => {
              console.log(`       Charge ${cIdx + 1}:`)
              console.log(`         Name: ${charge.name || charge.uid || 'N/A'}`)
              console.log(`         Team Member ID: ${charge.teamMemberId || charge.team_member_id || 'N/A'}`)
            })
          } else {
            console.log(`     Applied Service Charges: None`)
          }
          console.log('')
        })
      }
    }

    // Check database for line items of this order
    console.log(`\n📊 Checking Database Line Items:`)
    const orderRecord = await prisma.$queryRaw`
      SELECT id FROM orders WHERE order_id = ${orderRef} LIMIT 1
    `

    if (orderRecord && orderRecord.length > 0) {
      const orderUuid = orderRecord[0].id
      const lineItems = await prisma.$queryRaw`
        SELECT name, service_variation_id, technician_id, administrator_id
        FROM order_line_items
        WHERE order_id = ${orderUuid}::uuid
      `

      console.log(`   Found ${lineItems.length} line item(s) in database:\n`)
      lineItems.forEach((item, idx) => {
        console.log(`   Line Item ${idx + 1}:`)
        console.log(`     Name: ${item.name || 'N/A'}`)
        console.log(`     Service Variation ID: ${item.service_variation_id || 'N/A'}`)
        console.log(`     Technician ID: ${item.technician_id || 'N/A'}`)
        console.log(`     Administrator ID: ${item.administrator_id || 'N/A'}`)
        console.log('')
      })
    }

    // Check if administrator_id from payment matches any team member
    if (administratorId) {
      console.log(`\n👤 Administrator from Payment:`)
      const admin = await prisma.$queryRaw`
        SELECT id, given_name, family_name, square_team_member_id
        FROM team_members
        WHERE id = ${administratorId}::uuid
        LIMIT 1
      `

      if (admin && admin.length > 0) {
        console.log(`   Name: ${admin[0].given_name || ''} ${admin[0].family_name || ''}`)
        console.log(`   Square Team Member ID: ${admin[0].square_team_member_id || 'N/A'}`)
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.errors) {
      console.error('Square API Errors:', JSON.stringify(error.errors, null, 2))
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

testPaymentTechnician()
  .then(() => {
    console.log('\n✅ Test complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  })

