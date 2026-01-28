#!/usr/bin/env node
/**
 * Test inserting the 3 remaining missing bookings to see why they failed
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const { getSquareEnvironmentName } = require('../lib/utils/square-env')

const prisma = new PrismaClient()

const squareEnvironmentName = getSquareEnvironmentName()
const environment = squareEnvironmentName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const bookingsApi = square.bookingsApi

const missingBookingIds = [
  'm0lud7huzzev37',
  'be1lzixhdrs1j2',
  '86pyh6yai1wqvn'
]

async function testInsertBooking(bookingId) {
  console.log(`\n🔍 Testing booking: ${bookingId}`)
  
  try {
    // Fetch booking from Square
    const response = await bookingsApi.retrieveBooking(bookingId)
    const booking = response.result?.booking
    
    if (!booking) {
      console.log(`   ❌ Booking not found in Square`)
      return
    }
    
    console.log(`   ✅ Fetched from Square`)
    console.log(`   Customer ID: ${booking.customerId || booking.customer_id || 'N/A'}`)
    console.log(`   Location ID: ${booking.locationId || booking.location_id || 'N/A'}`)
    console.log(`   Status: ${booking.status}`)
    
    // Check if customer exists
    const customerId = booking.customerId || booking.customer_id
    if (customerId) {
      const customer = await prisma.$queryRaw`
        SELECT square_customer_id, organization_id FROM square_existing_clients 
        WHERE square_customer_id = ${customerId} LIMIT 1
      `
      if (customer && customer.length > 0) {
        console.log(`   ✅ Customer exists in DB: ${customer[0].organization_id}`)
      } else {
        console.log(`   ⚠️  Customer NOT in DB`)
      }
    }
    
    // Check if location exists
    const squareLocationId = booking.locationId || booking.location_id
    if (squareLocationId) {
      const location = await prisma.$queryRaw`
        SELECT id, organization_id, square_location_id FROM locations 
        WHERE square_location_id = ${squareLocationId} LIMIT 1
      `
      if (location && location.length > 0) {
        console.log(`   ✅ Location exists in DB: ${location[0].id}`)
      } else {
        console.log(`   ⚠️  Location NOT in DB`)
      }
    }
    
    // Try to insert using the insert script function
    const { saveBookingToDatabase } = require('./insert-missing-bookings')
    const merchantId = process.env.SQUARE_MERCHANT_ID || null
    
    console.log(`   🔄 Attempting to insert...`)
    const result = await saveBookingToDatabase(booking, merchantId, null)
    
    if (result.success) {
      console.log(`   ✅ Successfully inserted: ${result.inserted} record(s)`)
    } else {
      console.log(`   ❌ Failed: ${result.reason || result.error}`)
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`)
    if (error.stack) {
      console.log(`   Stack: ${error.stack.split('\n').slice(0, 5).join('\n')}`)
    }
  }
}

async function main() {
  console.log('🔍 Investigating 3 remaining missing bookings...\n')
  
  for (const bookingId of missingBookingIds) {
    await testInsertBooking(bookingId)
  }
  
  await prisma.$disconnect()
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })



