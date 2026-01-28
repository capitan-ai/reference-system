#!/usr/bin/env node
/**
 * Check for payment webhook errors in recent orders
 * Analyze why payments aren't being saved
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkPaymentWebhookErrors() {
  console.log('🔍 Checking Payment Webhook Errors\n')
  console.log('='.repeat(80))
  
  try {
    // Get recent orders without payments
    const recentOrdersWithoutPayments = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id,
        o.customer_id,
        o.location_id,
        o.state,
        o.created_at,
        o.organization_id
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE p.id IS NULL
        AND o.created_at >= NOW() - INTERVAL '30 days'
      ORDER BY o.created_at DESC
      LIMIT 10
    `
    
    console.log(`Found ${recentOrdersWithoutPayments.length} recent orders without payments:\n`)
    
    for (const order of recentOrdersWithoutPayments) {
      console.log(`\n${'='.repeat(80)}`)
      console.log(`Order: ${order.order_id}`)
      console.log(`  UUID: ${order.id}`)
      console.log(`  Customer: ${order.customer_id || 'NULL'}`)
      console.log(`  Location: ${order.location_id || 'NULL'}`)
      console.log(`  State: ${order.state}`)
      console.log(`  Created: ${order.created_at}`)
      console.log(`  Organization: ${order.organization_id}`)
      
      // Check if there are any payments for this customer around the same time
      if (order.customer_id) {
        const orderCreatedAt = new Date(order.created_at)
        const startWindow = new Date(orderCreatedAt.getTime() - 2 * 60 * 60 * 1000) // 2 hours before
        const endWindow = new Date(orderCreatedAt.getTime() + 2 * 60 * 60 * 1000) // 2 hours after
        
        // Get location UUID if location_id is a square_location_id
        let locationUuid = null
        if (order.location_id && order.location_id.length < 36) {
          const loc = await prisma.$queryRaw`
            SELECT id FROM locations 
            WHERE square_location_id = ${order.location_id}
              AND organization_id = ${order.organization_id}::uuid
            LIMIT 1
          `
          if (loc && loc.length > 0) {
            locationUuid = loc[0].id
          }
        } else {
          locationUuid = order.location_id
        }
        
        if (locationUuid) {
          const customerPayments = await prisma.$queryRaw`
            SELECT 
              p.id,
              p.payment_id,
              p.order_id,
              p.status,
              p.total_money_amount,
              p.created_at
            FROM payments p
            WHERE p.customer_id = ${order.customer_id}
              AND p.location_id = ${locationUuid}::uuid
              AND p.created_at >= ${startWindow}::timestamp
              AND p.created_at <= ${endWindow}::timestamp
            ORDER BY p.created_at DESC
            LIMIT 5
          `
          
          if (customerPayments.length > 0) {
            console.log(`  ⚠️  Found ${customerPayments.length} payment(s) for this customer in time window:`)
            customerPayments.forEach((p, idx) => {
              console.log(`    ${idx + 1}. Payment: ${p.id}`)
              console.log(`       Square Payment ID: ${p.payment_id}`)
              console.log(`       Linked Order: ${p.order_id || 'NULL'}`)
              console.log(`       Amount: $${(Number(p.total_money_amount) / 100).toFixed(2)}`)
              console.log(`       Created: ${p.created_at}`)
              if (!p.order_id) {
                console.log(`       ⚠️  UNLINKED - This payment might be for our order!`)
              }
            })
          } else {
            console.log(`  ❌ No payments found for this customer in time window`)
            console.log(`     This suggests payment webhook was never received or failed`)
          }
        }
      }
    }
    
    // Check for common error patterns
    console.log(`\n${'='.repeat(80)}`)
    console.log('📊 Error Pattern Analysis:\n')
    
    // Count orders by state
    const ordersByState = await prisma.$queryRaw`
      SELECT 
        o.state,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE p.id IS NOT NULL) as with_payments,
        COUNT(*) FILTER (WHERE p.id IS NULL) as without_payments
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY o.state
      ORDER BY total DESC
    `
    
    console.log('Orders by State (Last 30 Days):')
    ordersByState.forEach(row => {
      const total = Number(row.total)
      const withPayments = Number(row.with_payments)
      const withoutPayments = Number(row.without_payments)
      const missingRate = (withoutPayments / total) * 100
      console.log(`  ${row.state || 'NULL'}: ${total} total, ${withPayments} with payments, ${withoutPayments} without (${missingRate.toFixed(1)}% missing)`)
    })
    
    // Check for orders with NULL customer_id
    const ordersWithoutCustomer = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.created_at >= NOW() - INTERVAL '30 days'
        AND o.customer_id IS NULL
        AND p.id IS NULL
    `
    
    const noCustomerCount = Number(ordersWithoutCustomer[0].count)
    if (noCustomerCount > 0) {
      console.log(`\n  ⚠️  ${noCustomerCount} orders without customer_id also missing payments`)
      console.log(`     This might indicate orders created without customer context`)
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

checkPaymentWebhookErrors()
  .then(() => {
    console.log('\n✅ Analysis Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Analysis Failed:', error)
    process.exit(1)
  })



