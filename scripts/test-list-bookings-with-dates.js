#!/usr/bin/env node
/**
 * Test script to check if listBookings returns historical bookings with date filters
 */

require('dotenv').config()
const { Client, Environment } = require('square')

const square = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim() || process.env.SQUARE_ACCESS_TOKEN_2?.trim(),
  environment: Environment.Production
})

async function testListBookingsWithDates() {
  const locationId = 'LT4ZHFBQQYB2N'
  
  // Test different date ranges
  const testRanges = [
    { name: '2022 (full year)', start: '2022-01-01T00:00:00Z', end: '2022-12-31T23:59:59Z' },
    { name: '2023 (full year)', start: '2023-01-01T00:00:00Z', end: '2023-12-31T23:59:59Z' },
    { name: '2024 (full year)', start: '2024-01-01T00:00:00Z', end: '2024-12-31T23:59:59Z' },
    { name: '2025 (full year)', start: '2025-01-01T00:00:00Z', end: '2025-12-31T23:59:59Z' },
    { name: 'Sep-Oct 2025', start: '2025-09-01T00:00:00Z', end: '2025-10-31T23:59:59Z' },
  ]

  for (const range of testRanges) {
    console.log(`\n🔍 Testing ${range.name}: ${range.start} to ${range.end}`)
    
    let allBookings = []
    let cursor
    let pageCount = 0

    do {
      pageCount++
      try {
        const resp = await square.bookingsApi.listBookings(
          100,        // limit
          cursor,     // cursor
          undefined,  // customerId
          undefined,  // teamMemberId
          locationId, // locationId
          range.start, // startAt
          range.end    // endAt
        )

        const bookings = resp.result?.bookings || []
        allBookings.push(...bookings)
        cursor = resp.result?.cursor

        if (pageCount === 1) {
          console.log(`   Page 1: ${bookings.length} bookings`)
        }

        if (pageCount >= 10) {
          console.log(`   ⚠️  Reached safety limit of 10 pages`)
          break
        }
      } catch (error) {
        console.error(`   ❌ Error:`, error.message)
        break
      }
    } while (cursor)

    console.log(`   Total: ${allBookings.length} bookings`)
    if (allBookings.length > 0) {
      const withCustomer = allBookings.filter(b => b.customerId || b.customer_id)
      console.log(`   With customer ID: ${withCustomer.length}/${allBookings.length}`)
    }
  }
}

testListBookingsWithDates().catch(console.error)


