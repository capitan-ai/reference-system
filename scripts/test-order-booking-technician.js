#!/usr/bin/env node
/**
 * Check if this order has a booking with technician info
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkOrderBooking() {
  const orderId = 'RQNfktNCBiZUvJ7ACllbMTMrJiSZY'
  
  console.log('🔍 Checking Order Booking for Technician Info\n')
  console.log('='.repeat(60))
  console.log(`Order ID: ${orderId}\n`)

  try {
    // Find order in database
    const order = await prisma.$queryRaw`
      SELECT id, order_id, organization_id, customer_id, location_id, state
      FROM orders
      WHERE order_id = ${orderId}
      LIMIT 1
    `

    if (!order || order.length === 0) {
      console.log('⚠️  Order not found in database')
      return
    }

    const orderUuid = order[0].id
    const organizationId = order[0].organization_id

    console.log('✅ Order found in database')
    console.log(`   Order UUID: ${orderUuid}`)
    console.log(`   Organization ID: ${organizationId}`)
    console.log(`   State: ${order[0].state}\n`)

    // Find payment linked to this order
    const payment = await prisma.$queryRaw`
      SELECT id, payment_id, booking_id, administrator_id
      FROM payments
      WHERE order_id = ${orderUuid}::uuid
      LIMIT 1
    `

    if (!payment || payment.length === 0) {
      console.log('⚠️  No payment found for this order')
      return
    }

    const bookingId = payment[0].booking_id
    console.log('✅ Payment found')
    console.log(`   Booking ID: ${bookingId}`)
    console.log(`   Administrator ID: ${payment[0].administrator_id || 'N/A'}\n`)

    // Find bookings with technician
    const bookings = await prisma.$queryRaw`
      SELECT 
        booking_id,
        service_variation_id,
        technician_id,
        any_team_member,
        start_at,
        duration_minutes
      FROM bookings
      WHERE booking_id LIKE ${`${bookingId}%`}
        AND organization_id = ${organizationId}::uuid
      ORDER BY start_at
    `

    if (!bookings || bookings.length === 0) {
      console.log('⚠️  No bookings found')
      return
    }

    console.log(`✅ Found ${bookings.length} booking(s)\n`)

    bookings.forEach((booking, idx) => {
      console.log(`Booking ${idx + 1}:`)
      console.log(`   Booking ID: ${booking.booking_id}`)
      console.log(`   Service Variation ID: ${booking.service_variation_id || 'N/A'}`)
      console.log(`   Technician ID: ${booking.technician_id || 'N/A'}`)
      console.log(`   Any Team Member: ${booking.any_team_member}`)
      console.log(`   Start At: ${booking.start_at}`)
      console.log(`   Duration: ${booking.duration_minutes} minutes`)
      console.log('')
    })

    // Check line items for this order
    const lineItems = await prisma.$queryRaw`
      SELECT 
        id,
        uid,
        name,
        service_variation_id,
        technician_id,
        location_id,
        customer_id
      FROM order_line_items
      WHERE order_id = ${orderUuid}::uuid
      ORDER BY created_at
    `

    console.log(`\n📦 Line Items in Database: ${lineItems.length}\n`)

    lineItems.forEach((item, idx) => {
      console.log(`Line Item ${idx + 1}:`)
      console.log(`   UID: ${item.uid || 'N/A'}`)
      console.log(`   Name: ${item.name || 'N/A'}`)
      console.log(`   Service Variation ID: ${item.service_variation_id || 'N/A'}`)
      console.log(`   Technician ID: ${item.technician_id || 'N/A'}`)
      console.log('')
    })

    // Match line items to bookings
    console.log('='.repeat(60))
    console.log('\n🔗 MATCHING ANALYSIS:\n')

    for (const lineItem of lineItems) {
      const matchingBooking = bookings.find(
        b => b.service_variation_id === lineItem.service_variation_id
      )

      if (matchingBooking) {
        console.log(`✅ Line Item "${lineItem.name}" matches Booking:`)
        console.log(`   Service Variation ID: ${lineItem.service_variation_id}`)
        console.log(`   Booking Technician ID: ${matchingBooking.technician_id || 'N/A'}`)
        console.log(`   Line Item Technician ID: ${lineItem.technician_id || 'N/A'}`)
        
        if (matchingBooking.technician_id && !lineItem.technician_id) {
          console.log(`   ⚠️  MISSING: Line item should have technician_id ${matchingBooking.technician_id}`)
        } else if (matchingBooking.technician_id && lineItem.technician_id === matchingBooking.technician_id) {
          console.log(`   ✅ CORRECT: Line item has matching technician_id`)
        }
      } else {
        console.log(`⚠️  Line Item "${lineItem.name}" has no matching booking`)
        console.log(`   Service Variation ID: ${lineItem.service_variation_id}`)
      }
      console.log('')
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

checkOrderBooking()
  .then(() => {
    console.log('\n✅ Check complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Check failed:', error)
    process.exit(1)
  })



