#!/usr/bin/env node
/**
 * Test fetching bookings for today
 */

require('dotenv').config()
const { Client, Environment } = require('square')

const UNION_ST_LOCATION_ID = 'LT4ZHFBQQYB2N'

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
  console.log('🔍 Testing bookings fetch for today\n')
  console.log(`📍 Location: ${UNION_ST_LOCATION_ID}`)
  console.log(`🔑 Environment: ${environment === Environment.Production ? 'Production' : 'Sandbox'}\n`)

  // Get today's date range
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const startAt = today.toISOString()
  const endAt = tomorrow.toISOString()

  console.log(`📅 Date range:`)
  console.log(`   Start: ${startAt}`)
  console.log(`   End: ${endAt}\n`)

  try {
    console.log('📡 Fetching bookings from Square API...\n')

    const response = await bookingsApi.listBookings(
      100, // limit
      undefined, // cursor
      undefined, // customerId
      undefined, // teamMemberId
      UNION_ST_LOCATION_ID,
      startAt,
      endAt
    )

    const result = response.result || {}
    const bookings = result.bookings || []
    const cursor = result.cursor || null
    const errors = result.errors || []

    console.log(`✅ API Response:`)
    console.log(`   Bookings found: ${bookings.length}`)
    console.log(`   Cursor: ${cursor ? cursor.substring(0, 30) + '...' : 'null'}`)
    console.log(`   Errors: ${errors.length}`)

    if (errors.length > 0) {
      console.log(`\n⚠️  API Errors:`)
      errors.forEach(err => {
        console.log(`   - ${err.code}: ${err.detail || err.message}`)
      })
    }

    if (bookings.length > 0) {
      console.log(`\n📋 Bookings:`)
      bookings.forEach((booking, idx) => {
        console.log(`\n   ${idx + 1}. Booking ID: ${booking.id}`)
        console.log(`      Start: ${booking.startAt}`)
        console.log(`      Status: ${booking.status}`)
        console.log(`      Version: ${booking.version}`)
        if (booking.customerId) {
          console.log(`      Customer: ${booking.customerId}`)
        }
        if (booking.appointmentSegments && booking.appointmentSegments.length > 0) {
          console.log(`      Segments: ${booking.appointmentSegments.length}`)
        }
      })
    } else {
      console.log(`\n⚪ No bookings found for today`)
    }

    // Also try without date filter to see if we get any bookings
    console.log(`\n📡 Trying without date filter (all bookings)...\n`)
    
    const responseAll = await bookingsApi.listBookings(
      10, // limit to 10 for testing
      undefined, // cursor
      undefined, // customerId
      undefined, // teamMemberId
      UNION_ST_LOCATION_ID
      // No date filters
    )

    const resultAll = responseAll.result || {}
    const bookingsAll = resultAll.bookings || []

    console.log(`✅ All bookings (no date filter):`)
    console.log(`   Bookings found: ${bookingsAll.length}`)

    if (bookingsAll.length > 0) {
      console.log(`\n📋 Sample bookings:`)
      bookingsAll.forEach((booking, idx) => {
        console.log(`\n   ${idx + 1}. Booking ID: ${booking.id}`)
        console.log(`      Start: ${booking.startAt}`)
        console.log(`      Status: ${booking.status}`)
        const startDate = new Date(booking.startAt)
        console.log(`      Date: ${startDate.toISOString().split('T')[0]}`)
      })
    }

  } catch (error) {
    console.error(`\n❌ Error:`, error.message)
    if (error.errors) {
      console.error(`   Details:`, JSON.stringify(error.errors, null, 2))
    }
    if (error.statusCode) {
      console.error(`   Status Code: ${error.statusCode}`)
    }
    process.exit(1)
  }
}

main()


