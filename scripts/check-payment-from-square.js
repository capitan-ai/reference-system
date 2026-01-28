#!/usr/bin/env node
/**
 * Retrieve a specific payment from Square API and check all available data
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const paymentsApi = square.paymentsApi

// Helper to safely stringify JSON with BigInt support
function safeStringify(obj, indent = 2) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  , indent)
}

async function checkPayment(paymentId) {
  console.log('🔍 Checking Payment from Square API\n')
  console.log('='.repeat(80))
  console.log(`Square Payment ID: ${paymentId}\n`)

  try {
    // First check if we have it in database
    const paymentRecord = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.payment_id as square_payment_id,
        p.order_id,
        p.booking_id,
        p.customer_id,
        p.location_id,
        p.status,
        p.total_money_amount,
        p.created_at
      FROM payments p
      WHERE p.payment_id = ${paymentId}
      LIMIT 1
    `
    
    if (paymentRecord && paymentRecord.length > 0) {
      const payment = paymentRecord[0]
      console.log('✅ Found in database:')
      console.log(`   Internal UUID: ${payment.id}`)
      console.log(`   Order ID: ${payment.order_id || 'NULL'}`)
      console.log(`   Booking ID: ${payment.booking_id || 'NULL'}`)
      console.log(`   Customer ID: ${payment.customer_id || 'NULL'}`)
      console.log(`   Location ID: ${payment.location_id || 'NULL'}`)
      console.log(`   Status: ${payment.status}`)
      console.log(`   Amount: $${(payment.total_money_amount / 100).toFixed(2)}`)
      console.log(`   Created: ${payment.created_at}\n`)
    } else {
      console.log('⚠️  Not found in database\n')
    }
    
    // Retrieve from Square API
    console.log('📡 Retrieving from Square API...\n')
    
    try {
      const response = await paymentsApi.getPayment(paymentId)
      
      if (!response.result?.payment) {
        console.log('❌ No payment returned from Square API')
        return
      }
      
      const squarePayment = response.result.payment
      
      console.log('✅ Successfully retrieved payment from Square!\n')
      console.log('='.repeat(80))
      console.log('\n📋 Complete Payment Object from Square API:\n')
      console.log(safeStringify(squarePayment))
      
      console.log('\n' + '='.repeat(80))
      console.log('\n📊 Field Summary:\n')
      
      // Show top-level keys
      console.log('Top-level keys:', Object.keys(squarePayment).join(', '))
      
      // Check for booking-related fields
      const bookingRelatedKeys = Object.keys(squarePayment).filter(key => 
        key.toLowerCase().includes('booking') || 
        key.toLowerCase().includes('appointment') ||
        key.toLowerCase().includes('order')
      )
      
      if (bookingRelatedKeys.length > 0) {
        console.log('\n✅ Found booking/order-related keys:', bookingRelatedKeys.join(', '))
        bookingRelatedKeys.forEach(key => {
          console.log(`\n${key}:`)
          const value = squarePayment[key]
          if (value) {
            console.log(safeStringify(value).substring(0, 500))
            if (safeStringify(value).length > 500) {
              console.log('... (truncated)')
            }
          }
        })
      } else {
        console.log('\n❌ No booking-related fields found')
      }
      
      // Check order_id
      if (squarePayment.orderId || squarePayment.order_id) {
        console.log('\n✅ Order ID in payment:', squarePayment.orderId || squarePayment.order_id)
      }
      
      // Check customer_id
      if (squarePayment.customerId || squarePayment.customer_id) {
        console.log('\n✅ Customer ID:', squarePayment.customerId || squarePayment.customer_id)
      }
      
      // Check location_id
      if (squarePayment.locationId || squarePayment.location_id) {
        console.log('\n✅ Location ID:', squarePayment.locationId || squarePayment.location_id)
      }
      
      // Check for any metadata or custom fields
      if (squarePayment.metadata || squarePayment.customAttributes) {
        console.log('\n✅ Metadata/Custom Attributes:')
        console.log(safeStringify(squarePayment.metadata || squarePayment.customAttributes))
      }
      
      // Check applicationDetails
      if (squarePayment.applicationDetails) {
        console.log('\n✅ Application Details:')
        console.log(safeStringify(squarePayment.applicationDetails))
      }
      
      // Summary
      console.log('\n' + '='.repeat(80))
      console.log('\n📝 Summary:\n')
      console.log('Square Payment API provides:')
      console.log(`  ✅ Order ID: ${squarePayment.orderId || squarePayment.order_id || 'N/A'}`)
      console.log(`  ✅ Customer ID: ${squarePayment.customerId || squarePayment.customer_id || 'N/A'}`)
      console.log(`  ✅ Location ID: ${squarePayment.locationId || squarePayment.location_id || 'N/A'}`)
      console.log(`  ❌ Booking ID: NOT PROVIDED by Square Payment API`)
      console.log(`\n💡 To get booking_id:`)
      console.log(`  1. Use payment's order_id to find the order`)
      console.log(`  2. Use order's customer_id + location_id + service_variation_id + time to match booking`)
      console.log(`  3. Or match payment directly to booking using customer_id + location_id + time`)

    } catch (squareError) {
      console.error('❌ Error retrieving from Square API:', squareError.message)
      if (squareError.errors) {
        console.error('Square API errors:', safeStringify(squareError.errors))
      }
      throw squareError
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Get payment ID from command line argument
const paymentId = process.argv[2] || 'R2ZxYK3gEQc5ATpF3dqqzh1fvaB'

checkPayment(paymentId)
  .then(() => {
    console.log('\n✅ Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })



