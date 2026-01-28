#!/usr/bin/env node
/**
 * Compare all orders with payments table
 * Identify orders without payments and missing payment data
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function compareOrdersWithPayments() {
  console.log('📊 Comparing Orders with Payments Table\n')
  console.log('='.repeat(80))
  
  try {
    // Get overall statistics
    const overallStats = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT o.id) FILTER (WHERE p.id IS NOT NULL) as orders_with_payments,
        COUNT(DISTINCT o.id) FILTER (WHERE p.id IS NULL) as orders_without_payments,
        COUNT(DISTINCT p.id) as total_payments,
        COUNT(DISTINCT p.id) FILTER (WHERE p.order_id IS NOT NULL) as payments_with_order_id,
        COUNT(DISTINCT p.id) FILTER (WHERE p.order_id IS NULL) as payments_without_order_id
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
    `
    
    const stats = overallStats[0]
    const totalOrders = Number(stats.total_orders)
    const ordersWithPayments = Number(stats.orders_with_payments)
    const ordersWithoutPayments = Number(stats.orders_without_payments)
    const totalPayments = Number(stats.total_payments)
    const paymentsWithOrderId = Number(stats.payments_with_order_id)
    const paymentsWithoutOrderId = Number(stats.payments_without_order_id)
    
    console.log('📈 Overall Statistics:\n')
    console.log(`Total Orders: ${totalOrders}`)
    console.log(`  ✅ Orders with payments: ${ordersWithPayments} (${((ordersWithPayments/totalOrders)*100).toFixed(1)}%)`)
    console.log(`  ❌ Orders without payments: ${ordersWithoutPayments} (${((ordersWithoutPayments/totalOrders)*100).toFixed(1)}%)`)
    console.log()
    console.log(`Total Payments: ${totalPayments}`)
    console.log(`  ✅ Payments with order_id: ${paymentsWithOrderId} (${((paymentsWithOrderId/totalPayments)*100).toFixed(1)}%)`)
    console.log(`  ⚠️  Payments without order_id: ${paymentsWithoutOrderId} (${((paymentsWithoutOrderId/totalPayments)*100).toFixed(1)}%)`)
    
    // Get orders without payments (recent ones first)
    console.log(`\n${'='.repeat(80)}`)
    console.log('📋 Orders Without Payments (Recent 20):\n')
    
    const ordersWithoutPaymentsList = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id,
        o.customer_id,
        o.location_id,
        o.state,
        o.created_at,
        o.booking_id
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE p.id IS NULL
      ORDER BY o.created_at DESC
      LIMIT 20
    `
    
    console.log(`Found ${ordersWithoutPaymentsList.length} orders without payments:\n`)
    ordersWithoutPaymentsList.forEach((order, idx) => {
      console.log(`${idx + 1}. Order: ${order.order_id}`)
      console.log(`   UUID: ${order.id}`)
      console.log(`   Customer: ${order.customer_id || 'NULL'}`)
      console.log(`   State: ${order.state || 'NULL'}`)
      console.log(`   Created: ${order.created_at}`)
      console.log(`   Booking ID: ${order.booking_id || 'NULL'}`)
      console.log()
    })
    
    // Get payments without order_id (unlinked payments)
    console.log(`${'='.repeat(80)}`)
    console.log('💳 Payments Without order_id (Unlinked - Recent 20):\n')
    
    const unlinkedPayments = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.payment_id,
        p.customer_id,
        p.location_id,
        p.status,
        p.total_money_amount,
        p.created_at
      FROM payments p
      WHERE p.order_id IS NULL
      ORDER BY p.created_at DESC
      LIMIT 20
    `
    
    console.log(`Found ${unlinkedPayments.length} unlinked payments:\n`)
    unlinkedPayments.forEach((payment, idx) => {
      console.log(`${idx + 1}. Payment: ${payment.id}`)
      console.log(`   Square Payment ID: ${payment.payment_id}`)
      console.log(`   Customer: ${payment.customer_id || 'NULL'}`)
      console.log(`   Status: ${payment.status || 'NULL'}`)
      console.log(`   Amount: $${(Number(payment.total_money_amount) / 100).toFixed(2)}`)
      console.log(`   Created: ${payment.created_at}`)
      console.log()
    })
    
    // Statistics by date range
    console.log(`${'='.repeat(80)}`)
    console.log('📅 Statistics by Date Range:\n')
    
    // Last 7 days
    const last7Days = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT o.id) FILTER (WHERE p.id IS NOT NULL) as orders_with_payments,
        COUNT(DISTINCT o.id) FILTER (WHERE p.id IS NULL) as orders_without_payments
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.created_at >= NOW() - INTERVAL '7 days'
    `
    const rs7 = last7Days[0]
    const total7 = Number(rs7.total_orders)
    if (total7 > 0) {
      console.log(`Last 7 days:`)
      console.log(`  Total Orders: ${total7}`)
      console.log(`  With Payments: ${Number(rs7.orders_with_payments)} (${((Number(rs7.orders_with_payments)/total7)*100).toFixed(1)}%)`)
      console.log(`  Without Payments: ${Number(rs7.orders_without_payments)} (${((Number(rs7.orders_without_payments)/total7)*100).toFixed(1)}%)`)
      console.log()
    }
    
    // 2025
    const year2025 = await prisma.$queryRaw`
      SELECT 
        COUNT(DISTINCT o.id) as total_orders,
        COUNT(DISTINCT o.id) FILTER (WHERE p.id IS NOT NULL) as orders_with_payments,
        COUNT(DISTINCT o.id) FILTER (WHERE p.id IS NULL) as orders_without_payments
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.created_at >= '2025-01-01'::timestamp 
        AND o.created_at <= '2025-12-31'::timestamp
    `
    const rs2025 = year2025[0]
    const total2025 = Number(rs2025.total_orders)
    if (total2025 > 0) {
      console.log(`2025:`)
      console.log(`  Total Orders: ${total2025}`)
      console.log(`  With Payments: ${Number(rs2025.orders_with_payments)} (${((Number(rs2025.orders_with_payments)/total2025)*100).toFixed(1)}%)`)
      console.log(`  Without Payments: ${Number(rs2025.orders_without_payments)} (${((Number(rs2025.orders_without_payments)/total2025)*100).toFixed(1)}%)`)
      console.log()
    }
    
    // Check for specific order
    console.log(`${'='.repeat(80)}`)
    console.log('🔍 Checking Specific Order: P1c1WYwCzcpQQkLaHIiiDTQokLSZY\n')
    
    const specificOrder = await prisma.$queryRaw`
      SELECT 
        o.order_id,
        o.id,
        o.customer_id,
        o.location_id,
        o.state,
        o.created_at,
        o.booking_id,
        COUNT(DISTINCT p.id) as payment_count
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.order_id = 'P1c1WYwCzcpQQkLaHIiiDTQokLSZY'
      GROUP BY o.order_id, o.id, o.customer_id, o.location_id, o.state, o.created_at, o.booking_id
    `
    
    if (specificOrder && specificOrder.length > 0) {
      const so = specificOrder[0]
      console.log(`Order: ${so.order_id}`)
      console.log(`  UUID: ${so.id}`)
      console.log(`  Customer: ${so.customer_id}`)
      console.log(`  State: ${so.state}`)
      console.log(`  Created: ${so.created_at}`)
      console.log(`  Booking ID: ${so.booking_id || 'NULL'}`)
      console.log(`  Payments: ${Number(so.payment_count)}`)
      
      if (Number(so.payment_count) === 0) {
        console.log(`  ⚠️  NO PAYMENTS FOUND!`)
        console.log(`  This order should have payments but doesn't.`)
        console.log(`  Possible causes:`)
        console.log(`    1. Payment webhook not received`)
        console.log(`    2. Payment webhook failed`)
        console.log(`    3. Payment saved with wrong order_id`)
        console.log(`    4. Payment saved with NULL order_id (arrived before order webhook)`)
      }
    }
    
    // Summary and recommendations
    console.log(`\n${'='.repeat(80)}`)
    console.log('💡 Recommendations:\n')
    
    if (ordersWithoutPayments > 0) {
      console.log(`1. ${ordersWithoutPayments} orders are missing payments`)
      console.log(`   - Check if payment webhooks are being received`)
      console.log(`   - Check if payment webhook handler is working correctly`)
      console.log(`   - Consider backfilling payments from Square API`)
    }
    
    if (paymentsWithoutOrderId > 0) {
      console.log(`2. ${paymentsWithoutOrderId} payments are unlinked (no order_id)`)
      console.log(`   - These payments arrived before their orders`)
      console.log(`   - The new linking logic should handle this`)
      console.log(`   - Consider running a backfill to link them`)
    }
    
    const missingRate = (ordersWithoutPayments / totalOrders) * 100
    if (missingRate > 10) {
      console.log(`\n⚠️  WARNING: ${missingRate.toFixed(1)}% of orders are missing payments!`)
      console.log(`   This suggests a systemic issue with payment webhook processing.`)
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

compareOrdersWithPayments()
  .then(() => {
    console.log('\n✅ Analysis Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Analysis Failed:', error)
    process.exit(1)
  })

