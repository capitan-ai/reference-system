#!/usr/bin/env node
/**
 * Check if payments exist in Square API for this order
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Get Square client
function getSquareClient() {
  const squareModule = require('square')
  const candidates = [squareModule, squareModule?.default].filter(Boolean)
  const pick = (selector) => {
    for (const candidate of candidates) {
      const value = selector(candidate)
      if (value) return value
    }
    return null
  }

  const Client = pick((mod) => (typeof mod?.Client === 'function' ? mod.Client : null)) ||
    (typeof candidates[0] === 'function' ? candidates[0] : null)
  const Environment = pick((mod) => mod?.Environment)

  if (typeof Client !== 'function' || !Environment) {
    throw new Error('Square SDK exports missing (Client/Environment)')
  }

  const squareEnvName = process.env.SQUARE_ENV === 'sandbox' ? 'sandbox' : 'production'
  const resolvedEnvironment = squareEnvName === 'sandbox' ? Environment.Sandbox : Environment.Production
  const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
    environment: resolvedEnvironment,
  })

  return squareClient
}

async function checkPaymentsFromSquare() {
  const orderId = 'P1c1WYwCzcpQQkLaHIiiDTQokLSZY'
  
  console.log('🔍 Checking Payments from Square API\n')
  console.log('='.repeat(80))
  console.log(`Order ID: ${orderId}\n`)
  
  try {
    const squareClient = getSquareClient()
    
    // Get order details first
    const ordersApi = squareClient.ordersApi
    const orderResponse = await ordersApi.retrieveOrder(orderId)
    const order = orderResponse.result?.order
    
    if (!order) {
      console.log('❌ Order not found in Square API')
      await prisma.$disconnect()
      return
    }
    
    console.log('Order from Square:')
    console.log(`  State: ${order.state}`)
    console.log(`  Customer ID: ${order.customerId || 'NULL'}`)
    console.log(`  Location ID: ${order.locationId || 'NULL'}`)
    console.log(`  Created: ${order.createdAt || 'NULL'}`)
    console.log(`  Total: $${(Number(order.totalMoney?.amount || 0) / 100).toFixed(2)}`)
    
    // Check if order has tenders (payments)
    const tenders = order.tenders || []
    console.log(`\nTenders (Payments) in Order: ${tenders.length}`)
    tenders.forEach((tender, idx) => {
      console.log(`  ${idx + 1}. Tender ID: ${tender.id}`)
      console.log(`     Type: ${tender.type}`)
      console.log(`     Amount: $${(Number(tender.amountMoney?.amount || 0) / 100).toFixed(2)}`)
      console.log(`     Status: ${tender.status || 'N/A'}`)
    })
    
    // Search for payments by order_id
    console.log(`\n${'='.repeat(80)}`)
    console.log('Searching Payments API for this order...\n')
    
    const paymentsApi = squareClient.paymentsApi
    
    // Try to search payments by order_id
    try {
      const searchRequest = {
        query: {
          filter: {
            orderFilter: {
              orderIds: [orderId]
            }
          }
        }
      }
      
      const paymentsResponse = await paymentsApi.searchPayments(searchRequest)
      const payments = paymentsResponse.result?.payments || []
      
      console.log(`Found ${payments.length} payment(s) in Square API for this order:`)
      for (let idx = 0; idx < payments.length; idx++) {
        const p = payments[idx]
        console.log(`  ${idx + 1}. Payment ID: ${p.id}`)
        console.log(`     Status: ${p.status}`)
        console.log(`     Amount: $${(Number(p.amountMoney?.amount || 0) / 100).toFixed(2)}`)
        console.log(`     Customer: ${p.customerId || 'NULL'}`)
        console.log(`     Order ID: ${p.orderId || 'NULL'}`)
        console.log(`     Created: ${p.createdAt || 'NULL'}`)
        
        // Check if this payment exists in our database
        const paymentInDb = await prisma.$queryRaw`
          SELECT id, order_id, booking_id
          FROM payments
          WHERE id = ${p.id}
          LIMIT 1
        `
        
        if (paymentInDb && paymentInDb.length > 0) {
          const dbPayment = paymentInDb[0]
          console.log(`     ✅ EXISTS in database`)
          console.log(`     Database order_id: ${dbPayment.order_id || 'NULL'}`)
          console.log(`     Database booking_id: ${dbPayment.booking_id || 'NULL'}`)
          
          // Get order UUID to compare
          const orderUuid = await prisma.$queryRaw`
            SELECT id FROM orders WHERE order_id = ${orderId} LIMIT 1
          `
          if (orderUuid && orderUuid.length > 0 && dbPayment.order_id !== orderUuid[0].id) {
            console.log(`     ⚠️  MISMATCH: Payment order_id (${dbPayment.order_id}) doesn't match order UUID (${orderUuid[0].id})`)
          }
        } else {
          console.log(`     ❌ NOT FOUND in database!`)
        }
      }
    } catch (searchError) {
      console.log(`⚠️  Could not search payments: ${searchError.message}`)
    }
    
    // Also check payments by customer_id
    if (order.customerId) {
      console.log(`\n${'='.repeat(80)}`)
      console.log(`Checking payments for customer ${order.customerId} on Dec 15, 2025...\n`)
      
      const dayStart = '2025-12-15T00:00:00Z'
      const dayEnd = '2025-12-16T00:00:00Z'
      
      try {
        const customerPaymentsRequest = {
          query: {
            filter: {
              customerFilter: {
                customerIds: [order.customerId]
              }
            }
          },
          limit: 10
        }
        
        const customerPaymentsResponse = await paymentsApi.searchPayments(customerPaymentsRequest)
        const customerPayments = customerPaymentsResponse.result?.payments || []
        
        console.log(`Found ${customerPayments.length} payment(s) for this customer:`)
        customerPayments.forEach((p, idx) => {
          const paymentDate = p.createdAt ? new Date(p.createdAt) : null
          const isSameDay = paymentDate && paymentDate >= new Date(dayStart) && paymentDate < new Date(dayEnd)
          
          console.log(`  ${idx + 1}. Payment ID: ${p.id}`)
          console.log(`     Order ID: ${p.orderId || 'NULL'}`)
          console.log(`     Amount: $${(Number(p.amountMoney?.amount || 0) / 100).toFixed(2)}`)
          console.log(`     Created: ${p.createdAt || 'NULL'}`)
          if (isSameDay) {
            console.log(`     ✅ Same day as order!`)
          }
        })
      } catch (customerError) {
        console.log(`⚠️  Could not search customer payments: ${customerError.message}`)
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
  } finally {
    await prisma.$disconnect()
  }
}

checkPaymentsFromSquare().catch(console.error)

