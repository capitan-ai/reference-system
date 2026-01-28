#!/usr/bin/env node
/**
 * Analyze payment webhook processing issue
 * Check if payments exist in Square API but not in database
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

async function analyzePaymentWebhookIssue() {
  console.log('🔍 Analyzing Payment Webhook Processing Issue\n')
  console.log('='.repeat(80))
  
  try {
    // Get a sample of orders without payments from 2025
    const ordersWithoutPayments = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id,
        o.customer_id,
        o.location_id,
        o.state,
        o.created_at
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE p.id IS NULL
        AND o.created_at >= '2025-01-01'::timestamp
        AND o.created_at <= '2025-12-31'::timestamp
      ORDER BY o.created_at DESC
      LIMIT 5
    `
    
    console.log(`Checking ${ordersWithoutPayments.length} orders from 2025 without payments:\n`)
    
    const squareClient = getSquareClient()
    const paymentsApi = squareClient.paymentsApi
    
    for (const order of ordersWithoutPayments) {
      console.log(`\n${'='.repeat(80)}`)
      console.log(`Order: ${order.order_id}`)
      console.log(`  Created: ${order.created_at}`)
      console.log(`  State: ${order.state}`)
      console.log(`  Customer: ${order.customer_id}`)
      
      try {
        // Search for payments by order_id in Square API
        const searchRequest = {
          query: {
            filter: {
              orderFilter: {
                orderIds: [order.order_id]
              }
            }
          }
        }
        
        const paymentsResponse = await paymentsApi.searchPayments(searchRequest)
        const payments = paymentsResponse.result?.payments || []
        
        console.log(`  Square API Payments: ${payments.length}`)
        
        if (payments.length > 0) {
          console.log(`  ⚠️  PAYMENTS EXIST IN SQUARE BUT NOT IN DATABASE!`)
          for (let idx = 0; idx < payments.length; idx++) {
            const p = payments[idx]
            console.log(`    ${idx + 1}. Payment ID: ${p.id}`)
            console.log(`       Status: ${p.status}`)
            console.log(`       Amount: $${(Number(p.amountMoney?.amount || 0) / 100).toFixed(2)}`)
            console.log(`       Created: ${p.createdAt || 'N/A'}`)
            
            // Check if payment exists in DB
            const paymentInDb = await prisma.$queryRaw`
              SELECT id, order_id FROM payments WHERE id = ${p.id} LIMIT 1
            `
            
            if (paymentInDb && paymentInDb.length > 0) {
              console.log(`       ✅ EXISTS in DB but not linked to order`)
              console.log(`       DB order_id: ${paymentInDb[0].order_id || 'NULL'}`)
            } else {
              console.log(`       ❌ NOT IN DATABASE - payment webhook never processed!`)
            }
          }
        } else {
          console.log(`  ℹ️  No payments found in Square API (might be a test order or refunded)`)
        }
      } catch (error) {
        console.log(`  ❌ Error checking Square API: ${error.message}`)
      }
    }
    
    // Check specific order
    console.log(`\n${'='.repeat(80)}`)
    console.log(`Checking Specific Order: P1c1WYwCzcpQQkLaHIiiDTQokLSZY\n`)
    
    try {
      const searchRequest = {
        query: {
          filter: {
            orderFilter: {
              orderIds: ['P1c1WYwCzcpQQkLaHIiiDTQokLSZY']
            }
          }
        }
      }
      
      const paymentsResponse = await paymentsApi.searchPayments(searchRequest)
      const payments = paymentsResponse.result?.payments || []
      
      console.log(`Square API Payments: ${payments.length}`)
      
      if (payments.length > 0) {
        console.log(`⚠️  PAYMENTS EXIST IN SQUARE BUT NOT IN DATABASE!`)
        for (const p of payments) {
          console.log(`  Payment ID: ${p.id}`)
          console.log(`  Status: ${p.status}`)
          console.log(`  Amount: $${(Number(p.amountMoney?.amount || 0) / 100).toFixed(2)}`)
          console.log(`  Created: ${p.createdAt || 'N/A'}`)
          
          const paymentInDb = await prisma.$queryRaw`
            SELECT id, order_id FROM payments WHERE id = ${p.id} LIMIT 1
          `
          
          if (paymentInDb && paymentInDb.length > 0) {
            console.log(`  ✅ EXISTS in DB`)
            console.log(`  DB order_id: ${paymentInDb[0].order_id || 'NULL'}`)
          } else {
            console.log(`  ❌ NOT IN DATABASE - payment webhook never processed!`)
          }
        }
      } else {
        console.log(`ℹ️  No payments found in Square API`)
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`)
    }
    
    // Summary
    console.log(`\n${'='.repeat(80)}`)
    console.log('📊 Summary:\n')
    console.log('If payments exist in Square API but not in database:')
    console.log('  → Payment webhooks are NOT being received or processed')
    console.log('  → Check webhook endpoint logs')
    console.log('  → Check if webhook handler is throwing errors')
    console.log('  → Check if Square webhook configuration is correct')
    
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

analyzePaymentWebhookIssue()
  .then(() => {
    console.log('\n✅ Analysis Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Analysis Failed:', error)
    process.exit(1)
  })

