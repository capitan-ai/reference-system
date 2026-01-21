#!/usr/bin/env node
/**
 * Test script to check if listBookings returns all bookings without date filters
 */

require('dotenv').config()
const { Client, Environment } = require('square')

const square = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim() || process.env.SQUARE_ACCESS_TOKEN_2?.trim(),
  environment: Environment.Production
})

async function testListAllBookings() {
  const locationId = 'LT4ZHFBQQYB2N'
  let allBookings = []
  let cursor
  let pageCount = 0

  console.log(`🔍 Testing listBookings WITHOUT date filters for location ${locationId}\n`)

  do {
    pageCount++
    try {
      // Call WITHOUT date filters - should return ALL bookings
      const resp = await square.bookingsApi.listBookings(
        100,        // limit
        cursor,     // cursor
        undefined,  // customerId
        undefined,  // teamMemberId
        locationId, // locationId
        undefined,  // startAt - NOT PROVIDED
        undefined   // endAt - NOT PROVIDED
      )

      const bookings = resp.result?.bookings || []
      allBookings.push(...bookings)
      cursor = resp.result?.cursor

      console.log(`Page ${pageCount}: ${bookings.length} bookings, cursor: ${cursor ? 'yes' : 'no'}`)

      if (pageCount >= 50) {
        console.log('⚠️  Reached safety limit of 50 pages')
        break
      }
    } catch (error) {
      console.error(`❌ Error on page ${pageCount}:`, error.message)
      break
    }
  } while (cursor)

  console.log(`\n📊 Results:`)
  console.log(`   Total bookings found: ${allBookings.length}`)
  
  if (allBookings.length > 0) {
    const dates = allBookings
      .map(b => new Date(b.startAt || b.start_at || 0).getTime())
      .filter(d => d > 0)
    
    if (dates.length > 0) {
      const earliest = new Date(Math.min(...dates))
      const latest = new Date(Math.max(...dates))
      console.log(`   Date range: ${earliest.toISOString()} to ${latest.toISOString()}`)
    }
    
    const withCustomer = allBookings.filter(b => b.customerId || b.customer_id)
    console.log(`   Bookings with customer ID: ${withCustomer.length}/${allBookings.length} (${((withCustomer.length/allBookings.length)*100).toFixed(1)}%)`)
    
    if (withCustomer.length > 0) {
      const sampleCustomerIds = [...new Set(withCustomer.map(b => b.customerId || b.customer_id))].slice(0, 5)
      console.log(`   Sample customer IDs: ${sampleCustomerIds.join(', ')}`)
    }
  }
}

testListAllBookings().catch(console.error)


