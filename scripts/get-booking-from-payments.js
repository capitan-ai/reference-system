#!/usr/bin/env node
/**
 * Get booking_id from payments table for an order
 * Since payments have both order_id and booking_id, we can use payments as a bridge
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function getBookingFromPayments(orderId) {
  console.log('🔍 Getting booking_id from Payments Table\n')
  console.log('='.repeat(80))
  console.log(`Order ID (internal UUID): ${orderId}\n`)

  try {
    // Get order details
    const orderRecord = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id as square_order_id,
        o.customer_id,
        o.booking_id as current_booking_id
      FROM orders o
      WHERE o.id = ${orderId}::uuid
      LIMIT 1
    `
    
    if (!orderRecord || orderRecord.length === 0) {
      console.log('❌ Order not found in database')
      return
    }
    
    const order = orderRecord[0]
    
    console.log('✅ Order Details:')
    console.log(`   Square Order ID: ${order.square_order_id}`)
    console.log(`   Customer ID: ${order.customer_id}`)
    console.log(`   Current Booking ID: ${order.current_booking_id || 'NULL'}\n`)
    
    // Get payments for this order
    console.log('='.repeat(80))
    console.log('\n💳 Payments for this Order:\n')
    
    const payments = await prisma.$queryRaw`
      SELECT 
        p.id,
        p.payment_id as square_payment_id,
        p.order_id,
        p.booking_id,
        p.customer_id,
        p.status,
        p.total_money_amount,
        p.created_at,
        b.booking_id as square_booking_id,
        b.start_at as booking_start_at
      FROM payments p
      LEFT JOIN bookings b ON b.id = p.booking_id
      WHERE p.order_id = ${order.id}::uuid
      ORDER BY p.created_at DESC
    `
    
    if (!payments || payments.length === 0) {
      console.log('❌ No payments found for this order')
      return
    }
    
    console.log(`✅ Found ${payments.length} payment(s):\n`)
    
    let bookingIdFromPayment = null
    let bookingDetails = null
    
    payments.forEach((payment, idx) => {
      console.log(`Payment ${idx + 1}:`)
      console.log(`   Square Payment ID: ${payment.square_payment_id}`)
      console.log(`   Status: ${payment.status}`)
      console.log(`   Amount: $${(payment.total_money_amount / 100).toFixed(2)}`)
      console.log(`   Created: ${payment.created_at}`)
      console.log(`   Booking ID: ${payment.booking_id || 'NULL'}`)
      
      if (payment.booking_id) {
        console.log(`   ✅ HAS BOOKING_ID!`)
        console.log(`      Square Booking ID: ${payment.square_booking_id || 'N/A'}`)
        console.log(`      Booking Start: ${payment.booking_start_at || 'N/A'}`)
        
        if (!bookingIdFromPayment) {
          bookingIdFromPayment = payment.booking_id
          bookingDetails = {
            square_booking_id: payment.square_booking_id,
            start_at: payment.booking_start_at
          }
        }
      } else {
        console.log(`   ❌ No booking_id`)
      }
      console.log()
    })
    
    // Summary
    console.log('='.repeat(80))
    console.log('\n📊 Summary:\n')
    
    if (bookingIdFromPayment) {
      console.log(`✅ Found booking_id from payments: ${bookingIdFromPayment}`)
      console.log(`   Square Booking ID: ${bookingDetails.square_booking_id}`)
      console.log(`   Booking Start: ${bookingDetails.start_at}`)
      
      // Check if order already has this booking_id
      if (order.current_booking_id === bookingIdFromPayment) {
        console.log(`\n✅ Order already has this booking_id - no update needed`)
      } else {
        console.log(`\n💾 Would update order with booking_id: ${bookingIdFromPayment}`)
        
        // Ask for confirmation
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        })
        
        const answer = await new Promise(resolve => {
          readline.question('\n   Do you want to update the order? (yes/no): ', resolve)
        })
        readline.close()
        
        if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
          await prisma.$executeRaw`
            UPDATE orders
            SET booking_id = ${bookingIdFromPayment}::uuid,
                updated_at = NOW()
            WHERE id = ${order.id}::uuid
          `
          console.log(`\n   ✅ Successfully updated order with booking_id!`)
          
          // Also update order_line_items
          const lineItemsCount = await prisma.$executeRaw`
            UPDATE order_line_items
            SET booking_id = ${bookingIdFromPayment}::uuid,
                updated_at = NOW()
            WHERE order_id = ${order.id}::uuid
              AND booking_id IS NULL
          `
          console.log(`   ✅ Updated ${lineItemsCount} order_line_item(s) with booking_id`)
        } else {
          console.log('\n   ⏭️  Skipped update')
        }
      }
    } else {
      console.log(`❌ No payments have booking_id for this order`)
      console.log(`\n   This means:`)
      console.log(`   - Payments were created without booking context`)
      console.log(`   - Or booking_id wasn't populated when payment was processed`)
      console.log(`   - Need to use matching logic (customer + location + service + time)`)
    }
    
    // Show statistics
    console.log('\n' + '='.repeat(80))
    console.log('\n📈 Payment Statistics:\n')
    
    const paymentStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_payments,
        COUNT(booking_id) as payments_with_booking_id,
        COUNT(*) FILTER (WHERE order_id IS NOT NULL) as payments_with_order_id,
        COUNT(*) FILTER (WHERE order_id IS NOT NULL AND booking_id IS NOT NULL) as payments_with_both
      FROM payments
      WHERE organization_id = (SELECT organization_id FROM orders WHERE id = ${order.id}::uuid)
    `
    
    if (paymentStats && paymentStats.length > 0) {
      const stats = paymentStats[0]
      console.log(`   Total Payments: ${stats.total_payments}`)
      const bookingPercent = stats.total_payments > 0 
        ? ((Number(stats.payments_with_booking_id) / Number(stats.total_payments)) * 100).toFixed(1)
        : '0.0'
      console.log(`   Payments with booking_id: ${stats.payments_with_booking_id} (${bookingPercent}%)`)
      console.log(`   Payments with order_id: ${stats.payments_with_order_id}`)
      console.log(`   Payments with BOTH order_id AND booking_id: ${stats.payments_with_both}`)
      console.log(`\n   💡 If payments have both order_id and booking_id, we can use them to link orders to bookings!`)
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

// Get order ID from command line argument
const orderId = process.argv[2] || 'a3b1f1a7-201f-449f-ab7a-e931ddaa37a1'

getBookingFromPayments(orderId)
  .then(() => {
    console.log('\n✅ Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })

