#!/usr/bin/env node

// Load environment variables
require('dotenv').config()

const { Client, Environment } = require('square')
const crypto = require('crypto')

// Import the idempotency key builder
const { buildIdempotencyKey } = require('../lib/runs/giftcard-run-tracker')

console.log('🧪 Testing Payment Creation for Order')
console.log('=' .repeat(50))

// Initialize Square client
const environment = process.env.SQUARE_ENV?.trim() === 'sandbox' 
  ? Environment.Sandbox 
  : Environment.Production

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})

const ordersApi = squareClient.ordersApi
const paymentsApi = squareClient.paymentsApi

const locationId = process.env.SQUARE_LOCATION_ID?.trim()

if (!locationId) {
  console.error('❌ SQUARE_LOCATION_ID is required')
  process.exit(1)
}

// Test customer ID (you can use a real customer ID or leave undefined)
const testCustomerId = process.argv[2] || undefined

async function testPaymentForOrder() {
  try {
    console.log('\n📦 Step 1: Creating promotion order...')
    console.log(`   Location ID: ${locationId}`)
    console.log(`   Customer ID: ${testCustomerId || 'None (anonymous)'}`)
    
    const amountMoney = {
      amount: 1000, // $10.00
      currency: 'USD'
    }

    // Create order (similar to createPromotionOrder function)
    const idempotencySeed = buildIdempotencyKey(['promo-order', testCustomerId || 'anon', amountMoney.amount || 0])
    const lineUid = `line-${Math.random().toString(36).slice(2, 10)}`
    
    const orderRequest = {
      idempotencyKey: buildIdempotencyKey([idempotencySeed, 'create']),
      order: {
        locationId,
        referenceId: 'Test referral promotion',
        customerId: testCustomerId || undefined,
        lineItems: [
          {
            uid: lineUid,
            name: 'Test referral promotion',
            quantity: '1',
            basePriceMoney: amountMoney,
            itemType: 'GIFT_CARD'
          }
        ]
      }
    }

    console.log(`   Idempotency Key: ${orderRequest.idempotencyKey}`)
    console.log(`   Idempotency Key Length: ${orderRequest.idempotencyKey.length} characters`)
    
    if (orderRequest.idempotencyKey.length > 45) {
      console.error(`   ❌ ERROR: Idempotency key exceeds 45 characters!`)
      process.exit(1)
    } else {
      console.log(`   ✅ Idempotency key is within limit (≤45 chars)`)
    }

    let orderResponse
    let createdOrder
    
    try {
      orderResponse = await ordersApi.createOrder(orderRequest)
      createdOrder = orderResponse.result?.order
    } catch (error) {
      console.error('❌ Failed to create order')
      if (error.errors) {
        console.error('Errors:', JSON.stringify(error.errors, null, 2))
        
        // Check for permission errors
        const hasPermissionError = error.errors.some(
          err => err.code === 'INSUFFICIENT_SCOPES'
        )
        if (hasPermissionError) {
          console.error('\n⚠️  PERMISSION ERROR:')
          console.error('   Your Square application needs ORDERS_WRITE scope.')
          console.error('   Please authorize your app in Square Dashboard with ORDERS_WRITE permission.')
          console.error('\n   ✅ GOOD NEWS: The idempotency key fix is working correctly!')
          console.error('   ✅ The key length (' + orderRequest.idempotencyKey.length + ' chars) is within the 45-character limit.')
        }
      }
      throw error
    }

    if (!createdOrder?.id) {
      console.error('❌ Failed to create order - no order ID returned')
      if (orderResponse?.result?.errors) {
        console.error('Errors:', JSON.stringify(orderResponse.result.errors, null, 2))
      }
      process.exit(1)
    }

    console.log(`✅ Order created successfully!`)
    console.log(`   Order ID: ${createdOrder.id}`)
    console.log(`   Line Item UID: ${lineUid}`)
    console.log(`   Amount: $${amountMoney.amount / 100}`)

    // Wait a moment for order to be ready
    await new Promise(resolve => setTimeout(resolve, 1000))

    console.log('\n💳 Step 2: Creating payment for order...')
    
    // Create payment (similar to completePromotionOrderPayment function)
    const paymentIdempotencySeed = buildIdempotencyKey(['promo-payment', createdOrder.id, amountMoney.amount || 0])
    const paymentRequest = {
      idempotencyKey: buildIdempotencyKey([paymentIdempotencySeed, 'create']),
      sourceId: 'CASH',
      locationId,
      orderId: createdOrder.id,
      amountMoney,
      cashDetails: {
        buyerSuppliedMoney: amountMoney,
        changeBackMoney: { amount: 0, currency: amountMoney.currency || 'USD' }
      },
      note: 'Test referral promotion gift card'
    }

    console.log(`   Payment Idempotency Key: ${paymentRequest.idempotencyKey}`)
    console.log(`   Payment Idempotency Key Length: ${paymentRequest.idempotencyKey.length} characters`)
    
    if (paymentRequest.idempotencyKey.length > 45) {
      console.error(`   ❌ ERROR: Payment idempotency key exceeds 45 characters!`)
      process.exit(1)
    } else {
      console.log(`   ✅ Payment idempotency key is within limit (≤45 chars)`)
    }

    let paymentResponse
    let payment
    
    try {
      paymentResponse = await paymentsApi.createPayment(paymentRequest)
      payment = paymentResponse.result?.payment
    } catch (error) {
      console.error('❌ Failed to create payment')
      if (error.errors) {
        console.error('Errors:', JSON.stringify(error.errors, null, 2))
        
        // Check for permission errors
        const hasPermissionError = error.errors.some(
          err => err.code === 'INSUFFICIENT_SCOPES'
        )
        if (hasPermissionError) {
          console.error('\n⚠️  PERMISSION ERROR:')
          console.error('   Your Square application needs PAYMENTS_WRITE scope.')
          console.error('   Please authorize your app in Square Dashboard with PAYMENTS_WRITE permission.')
          console.error('\n   ✅ GOOD NEWS: The idempotency key fix is working correctly!')
          console.error('   ✅ The payment idempotency key length (' + paymentRequest.idempotencyKey.length + ' chars) is within the 45-character limit.')
        }
      }
      throw error
    }

    if (!payment) {
      console.error('❌ Failed to create payment - no payment returned')
      if (paymentResponse?.result?.errors) {
        console.error('Errors:', JSON.stringify(paymentResponse.result.errors, null, 2))
      }
      process.exit(1)
    }

    console.log(`✅ Payment created successfully!`)
    console.log(`   Payment ID: ${payment.id}`)
    console.log(`   Status: ${payment.status}`)
    console.log(`   Amount: $${payment.amountMoney?.amount ? payment.amountMoney.amount / 100 : 'N/A'}`)
    console.log(`   Order ID: ${payment.orderId}`)

    if (payment.status === 'COMPLETED') {
      console.log('\n🎉 SUCCESS: Payment completed successfully!')
      console.log(`   The order ${createdOrder.id} has been paid`)
    } else {
      console.log(`\n⚠️  WARNING: Payment status is ${payment.status} (expected COMPLETED)`)
    }

    console.log('\n' + '='.repeat(50))
    console.log('✅ Test completed successfully!')
    console.log('\nSummary:')
    console.log(`  - Order created: ${createdOrder.id}`)
    console.log(`  - Payment created: ${payment.id}`)
    console.log(`  - Payment status: ${payment.status}`)
    console.log(`  - All idempotency keys are ≤45 characters ✅`)

  } catch (error) {
    console.error('\n❌ Test failed with error:')
    console.error(error.message)
    if (error.errors) {
      console.error('\nSquare API errors:')
      console.error(JSON.stringify(error.errors, null, 2))
    }
    process.exit(1)
  }
}

// Run the test
testPaymentForOrder()
  .then(() => {
    console.log('\n✅ All tests passed!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  })

