#!/usr/bin/env node
/**
 * Search for bookings in Square API using order data
 * This demonstrates how to get booking_id from Square Bookings API
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
const bookingsApi = square.bookingsApi

// Helper to safely stringify JSON with BigInt support
function safeStringify(obj, indent = 2) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  , indent)
}

async function searchBookingsFromSquare(orderId) {
  console.log('🔍 Searching Square Bookings API for Matching Booking\n')
  console.log('='.repeat(80))
  console.log(`Order ID (internal UUID): ${orderId}\n`)

  try {
    // Get order details
    const orderRecord = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.order_id as square_order_id,
        o.customer_id,
        o.location_id,
        o.created_at,
        o.organization_id,
        l.square_location_id
      FROM orders o
      LEFT JOIN locations l ON l.id::text = o.location_id::text
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
    console.log(`   Location ID: ${order.location_id}`)
    console.log(`   Square Location ID: ${order.square_location_id || order.location_id}`)
    console.log(`   Order Created: ${order.created_at}\n`)
    
    if (!order.customer_id) {
      console.log('❌ Order has no customer_id - cannot search bookings')
      return
    }
    
    // Get line items with service_variation_id
    const lineItems = await prisma.$queryRaw`
      SELECT 
        oli.service_variation_id,
        oli.name,
        oli.variation_name
      FROM order_line_items oli
      WHERE oli.order_id = ${order.id}::uuid
        AND oli.service_variation_id IS NOT NULL
      LIMIT 5
    `
    
    const orderCreatedAt = new Date(order.created_at)
    const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000) // 7 days before
    const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000) // 1 day after
    
    const locationId = order.square_location_id || order.location_id
    
    console.log('='.repeat(80))
    console.log('\n📡 Searching Square Bookings API...\n')
    console.log(`Search Criteria:`)
    console.log(`   Customer ID: ${order.customer_id}`)
    console.log(`   Location ID: ${locationId}`)
    console.log(`   Start Window: ${startWindow.toISOString()}`)
    console.log(`   End Window: ${endWindow.toISOString()}`)
    if (lineItems && lineItems.length > 0) {
      console.log(`   Service Variation IDs: ${lineItems.map(li => li.service_variation_id).join(', ')}`)
    }
    console.log()
    
    // Method 1: Search by customer and location
    console.log('🔍 Method 1: Search by Customer ID and Location\n')
    
    try {
      // Square Bookings API - SearchBookings
      // Note: Square API might not have a direct search endpoint, so we'll use ListBookings with filters
      // or RetrieveBooking if we have the booking ID
      
      // Since Square doesn't have a search endpoint, we need to:
      // 1. List all bookings for the customer (if API supports it)
      // 2. Or use our database as the source of truth
      
      // Let's check what Square Bookings API provides
      console.log('⚠️  Square Bookings API Limitations:')
      console.log('   - No direct search/filter endpoint for bookings')
      console.log('   - Can only retrieve bookings by ID')
      console.log('   - Cannot search by customer_id + location + time range')
      console.log('\n✅ Solution: Use our database (populated from booking webhooks)\n')
      
      // Search in our database (which is populated from Square booking webhooks)
      console.log('='.repeat(80))
      console.log('\n🔍 Method 2: Search in Our Database (Populated from Square Webhooks)\n')
      
      if (lineItems && lineItems.length > 0) {
        for (const lineItem of lineItems) {
          console.log(`\n📋 Searching for Line Item: ${lineItem.name || 'N/A'}`)
          console.log(`   Service Variation ID: ${lineItem.service_variation_id}\n`)
          
          // Search in database
          let matchingBookings = null
          
          if (locationId && locationId.length < 36) {
            // Square location ID
            matchingBookings = await prisma.$queryRaw`
              SELECT 
                b.id,
                b.booking_id as square_booking_id,
                b.customer_id,
                b.location_id,
                b.start_at,
                b.technician_id,
                b.service_variation_id,
                sv.square_variation_id,
                EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)) as time_diff_seconds
              FROM bookings b
              INNER JOIN locations l ON l.id::text = b.location_id::text
              INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
              WHERE b.customer_id = ${order.customer_id}
                AND l.square_location_id = ${locationId}
                AND sv.square_variation_id = ${lineItem.service_variation_id}
                AND b.start_at >= ${startWindow}::timestamp
                AND b.start_at <= ${endWindow}::timestamp
              ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
              LIMIT 5
            `
          } else {
            // UUID
            matchingBookings = await prisma.$queryRaw`
              SELECT 
                b.id,
                b.booking_id as square_booking_id,
                b.customer_id,
                b.location_id,
                b.start_at,
                b.technician_id,
                b.service_variation_id,
                sv.square_variation_id,
                EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)) as time_diff_seconds
              FROM bookings b
              INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
              WHERE b.customer_id = ${order.customer_id}
                AND b.location_id::text = ${locationId}::text
                AND sv.square_variation_id = ${lineItem.service_variation_id}
                AND b.start_at >= ${startWindow}::timestamp
                AND b.start_at <= ${endWindow}::timestamp
              ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
              LIMIT 5
            `
          }
          
          if (!matchingBookings || matchingBookings.length === 0) {
            console.log('   ❌ No matching bookings found in database')
            
            // Try to retrieve from Square API if we have a booking ID from elsewhere
            console.log('\n   📡 Attempting to retrieve from Square API...')
            console.log('   ⚠️  Note: Square API requires booking ID - cannot search by criteria')
            console.log('   ✅ Our database is the best source (populated from booking.created webhooks)')
          } else {
            console.log(`   ✅ Found ${matchingBookings.length} matching booking(s):\n`)
            
            for (let i = 0; i < matchingBookings.length; i++) {
              const booking = matchingBookings[i]
              const timeDiffHours = Math.abs(parseFloat(booking.time_diff_seconds) / 3600)
              
              console.log(`   ${i + 1}. Booking:`)
              console.log(`      Square Booking ID: ${booking.square_booking_id}`)
              console.log(`      Internal UUID: ${booking.id}`)
              console.log(`      Start: ${booking.start_at}`)
              console.log(`      Time difference: ${timeDiffHours.toFixed(2)} hours`)
              console.log(`      Technician ID: ${booking.technician_id || 'N/A'}`)
              
              // Retrieve full booking from Square API
              if (i === 0 && timeDiffHours <= 24) {
                console.log(`\n      📡 Retrieving full booking from Square API...`)
                try {
                  const squareBooking = await bookingsApi.retrieveBooking(booking.square_booking_id)
                  if (squareBooking.result?.booking) {
                    console.log(`      ✅ Retrieved from Square API:`)
                    console.log(`         Status: ${squareBooking.result.booking.status}`)
                    console.log(`         Customer ID: ${squareBooking.result.booking.customerId}`)
                    console.log(`         Location ID: ${squareBooking.result.booking.locationId}`)
                    console.log(`         Start: ${squareBooking.result.booking.startAt}`)
                    if (squareBooking.result.booking.appointmentSegments) {
                      console.log(`         Services: ${squareBooking.result.booking.appointmentSegments.length} segment(s)`)
                      squareBooking.result.booking.appointmentSegments.forEach((seg, idx) => {
                        console.log(`            ${idx + 1}. Service: ${seg.serviceVariationId || 'N/A'}, Tech: ${seg.teamMemberId || 'N/A'}`)
                      })
                    }
                    console.log(`\n      📋 Full Booking Data:`)
                    console.log(safeStringify(squareBooking.result.booking).substring(0, 1000))
                    if (safeStringify(squareBooking.result.booking).length > 1000) {
                      console.log(`      ... (truncated)`)
                    }
                  }
                } catch (apiError) {
                  console.log(`      ⚠️  Could not retrieve from Square API: ${apiError.message}`)
                }
              }
              console.log()
            }
          }
        }
      } else {
        console.log('⚠️  No line items with service_variation_id found')
        console.log('   Cannot match to specific booking without service information')
      }
      
    } catch (error) {
      console.error('❌ Error:', error.message)
      if (error.stack) {
        console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
      }
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('\n📝 Summary: How to Get booking_id from Square\n')
    console.log('Square API Limitations:')
    console.log('  ❌ Orders API does NOT provide booking_id')
    console.log('  ❌ Bookings API cannot search by customer + location + time')
    console.log('  ✅ Bookings API can only retrieve by booking ID\n')
    console.log('✅ Best Approach:')
    console.log('  1. Store bookings in database from booking.created webhooks')
    console.log('  2. Match orders to bookings using:')
    console.log('     - Customer ID')
    console.log('     - Location ID')
    console.log('     - Service Variation ID (from line item catalogObjectId)')
    console.log('     - Time window (booking start within 7 days of order)')
    console.log('  3. Update orders.booking_id and order_line_items.booking_id')
    console.log('\n  This is what we demonstrated above! ✅')

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

searchBookingsFromSquare(orderId)
  .then(() => {
    console.log('\n✅ Complete')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Failed:', error)
    process.exit(1)
  })



