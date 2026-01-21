#!/usr/bin/env node
/**
 * Test fetching a specific booking by ID
 */

require('dotenv').config()
const { Client, Environment } = require('square')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN_2 || process.env.SQUARE_ACCESS_TOKEN

if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN(_2)')
  process.exit(1)
}

if (token.startsWith('Bearer ')) {
  token = token.slice(7)
}

const square = new Client({
  accessToken: token.trim(),
  environment
})

const bookingsApi = square.bookingsApi

async function main() {
  // Get a booking ID from database
  const dbBooking = await prisma.booking.findFirst({
    where: { location_id: 'LT4ZHFBQQYB2N' },
    orderBy: { start_at: 'desc' }
  })

  if (!dbBooking) {
    console.log('❌ No bookings found in database')
    await prisma.$disconnect()
    return
  }

  console.log('🔍 Testing booking fetch by ID\n')
  console.log(`📋 Database booking:`)
  console.log(`   ID: ${dbBooking.id}`)
  console.log(`   Start: ${dbBooking.start_at}`)
  console.log(`   Status: ${dbBooking.status}\n`)

  try {
    console.log('📡 Fetching booking from Square API...\n')

    // Try to retrieve the booking by ID
    const response = await bookingsApi.retrieveBooking(dbBooking.id)

    const booking = response.result?.booking

    if (booking) {
      console.log(`✅ Booking found in Square!`)
      console.log(`\n📋 Booking details:`)
      console.log(`   ID: ${booking.id}`)
      console.log(`   Start: ${booking.startAt}`)
      console.log(`   Status: ${booking.status}`)
      console.log(`   Version: ${booking.version}`)
      console.log(`   Location: ${booking.locationId}`)
      if (booking.customerId) {
        console.log(`   Customer: ${booking.customerId}`)
      }
    } else {
      console.log(`❌ Booking not found in Square API`)
      console.log(`   Response:`, JSON.stringify(response.result, null, 2))
    }
  } catch (error) {
    console.error(`\n❌ Error:`, error.message)
    if (error.errors) {
      console.error(`   Details:`, JSON.stringify(error.errors, null, 2))
    }
    if (error.statusCode) {
      console.error(`   Status Code: ${error.statusCode}`)
      
      if (error.statusCode === 404) {
        console.log(`\n💡 This booking might have been deleted or archived in Square`)
      }
    }
  }

  // Also try fetching with status filter
  console.log(`\n📡 Trying to fetch with status filter (including cancelled)...\n`)
  
  try {
    // Try fetching recent bookings (last 6 months) to see if we get any
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    
    const response = await bookingsApi.listBookings(
      100,
      undefined,
      undefined,
      undefined,
      'LT4ZHFBQQYB2N',
      sixMonthsAgo.toISOString(),
      new Date().toISOString()
    )

    const bookings = response.result?.bookings || []
    console.log(`✅ Bookings in last 6 months: ${bookings.length}`)
    
    if (bookings.length > 0) {
      console.log(`\n📋 Found bookings:`)
      bookings.forEach((b, idx) => {
        console.log(`   ${idx + 1}. ${b.id} - ${b.startAt} - ${b.status}`)
      })
    }
  } catch (error) {
    console.error(`   Error: ${error.message}`)
  }

  await prisma.$disconnect()
}

main()


