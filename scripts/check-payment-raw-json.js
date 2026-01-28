#!/usr/bin/env node
/**
 * Check what Square Payment API returns - does it have booking_id?
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkPaymentData() {
  console.log('🔍 Checking Payment Data from Square\n')
  console.log('='.repeat(80))

  try {
    // Get a payment with raw_json
    const payment = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.payment_id as square_payment_id,
        p.order_id,
        p.booking_id,
        p.customer_id,
        p.raw_json
      FROM payments p
      WHERE p.raw_json IS NOT NULL
        AND p.order_id IS NOT NULL
      ORDER BY p.created_at DESC
      LIMIT 1
    `
    
    if (!payment || payment.length === 0) {
      console.log('❌ No payments found with raw_json')
      return
    }
    
    const paymentData = payment[0]
    const rawJson = paymentData.raw_json
    
    console.log(`✅ Found payment: ${paymentData.square_payment_id}`)
    console.log(`   Order ID: ${paymentData.order_id}`)
    console.log(`   Booking ID: ${paymentData.booking_id || 'NULL'}`)
    console.log(`   Customer ID: ${paymentData.customer_id || 'N/A'}\n`)
    
    console.log('📋 Payment Object Structure:\n')
    console.log('Top-level keys:', Object.keys(rawJson).join(', '))
    
    // Check for booking-related fields
    const bookingRelatedKeys = Object.keys(rawJson).filter(key => 
      key.toLowerCase().includes('booking') || 
      key.toLowerCase().includes('appointment')
    )
    
    if (bookingRelatedKeys.length > 0) {
      console.log('\n✅ Found booking-related keys:', bookingRelatedKeys.join(', '))
      bookingRelatedKeys.forEach(key => {
        console.log(`\n${key}:`)
        console.log(JSON.stringify(rawJson[key], null, 2).substring(0, 500))
      })
    } else {
      console.log('\n❌ No booking-related fields found')
    }
    
    // Check order_id field
    if (rawJson.orderId || rawJson.order_id) {
      console.log('\n✅ Order ID in payment:', rawJson.orderId || rawJson.order_id)
    }
    
    // Full raw JSON (first 2000 chars)
    console.log('\n' + '='.repeat(80))
    console.log('\n📄 Full Payment Raw JSON (first 2000 chars):\n')
    const jsonString = JSON.stringify(rawJson, null, 2)
    console.log(jsonString.substring(0, 2000))
    if (jsonString.length > 2000) {
      console.log('\n... (truncated)')
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

checkPaymentData()
  .then(() => {
    console.log('\n✅ Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })



