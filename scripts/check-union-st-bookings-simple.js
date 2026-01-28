#!/usr/bin/env node
/**
 * Simple check to see if we can fetch any Union St bookings at all.
 * Tries different approaches to find bookings.
 */

require('dotenv').config()
const { Client, Environment } = require('square')

const UNION_ST_LOCATION_ID = 'LT4ZHFBQQYB2N'
const UNION_ST_NAME = 'Union St'

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN_2 || process.env.SQUARE_ACCESS_TOKEN
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN(_2)')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const bookingsApi = square.bookingsApi

async function tryFetchBookings(description, options = {}) {
  const { locationId, startAt, endAt, limit = 10 } = options
  
  try {
    console.log(`\n   ${description}...`)
    const resp = await bookingsApi.listBookings(
      limit,
      undefined, // cursor
      undefined, // customerId
      undefined, // teamMemberId
      locationId,
      startAt,
      endAt
    )

    const bookings = resp.result?.bookings || []
    console.log(`      ✅ Success: Found ${bookings.length} booking${bookings.length === 1 ? '' : 's'}`)
    
    if (bookings.length > 0) {
      const sample = bookings[0]
      console.log(`      Sample booking:`)
      console.log(`         - ID: ${sample.id}`)
      console.log(`         - Start: ${sample.startAt}`)
      console.log(`         - Status: ${sample.status}`)
      console.log(`         - Location: ${sample.locationId}`)
    }
    
    return { success: true, count: bookings.length, bookings }
  } catch (error) {
    console.log(`      ❌ Error: ${error.message}`)
    if (error.errors && error.errors.length > 0) {
      console.log(`      Details: ${JSON.stringify(error.errors[0], null, 2)}`)
    }
    return { success: false, error: error.message }
  }
}

async function main() {
  console.log(`🔍 Testing Union St bookings fetch`)
  console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`)
  console.log(`📍 Location ID: ${UNION_ST_LOCATION_ID}\n`)
  
  const now = new Date()
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
  
  const results = []
  
  // Try 1: Recent bookings (last month) with location filter
  results.push(await tryFetchBookings(
    '1. Last month with location filter',
    {
      locationId: UNION_ST_LOCATION_ID,
      startAt: oneMonthAgo.toISOString(),
      endAt: now.toISOString()
    }
  ))
  
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Try 2: Recent bookings (last 6 months) with location filter
  results.push(await tryFetchBookings(
    '2. Last 6 months with location filter',
    {
      locationId: UNION_ST_LOCATION_ID,
      startAt: sixMonthsAgo.toISOString(),
      endAt: now.toISOString()
    }
  ))
  
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Try 3: Recent bookings (last year) with location filter
  results.push(await tryFetchBookings(
    '3. Last year with location filter',
    {
      locationId: UNION_ST_LOCATION_ID,
      startAt: oneYearAgo.toISOString(),
      endAt: now.toISOString()
    }
  ))
  
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Try 4: All bookings without location filter (to see if location ID is the issue)
  results.push(await tryFetchBookings(
    '4. Recent bookings without location filter',
    {
      locationId: undefined,
      startAt: oneMonthAgo.toISOString(),
      endAt: now.toISOString()
    }
  ))
  
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Try 5: 2022 specific date range (smaller window)
  const jan2022 = new Date('2022-01-15T00:00:00Z')
  const feb2022 = new Date('2022-02-15T00:00:00Z')
  results.push(await tryFetchBookings(
    '5. January 15 - February 15, 2022',
    {
      locationId: UNION_ST_LOCATION_ID,
      startAt: jan2022.toISOString(),
      endAt: feb2022.toISOString()
    }
  ))
  
  // Summary
  console.log(`\n📊 Summary:`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  
  const successful = results.filter(r => r.success && r.count > 0)
  const failed = results.filter(r => !r.success)
  
  if (successful.length > 0) {
    console.log(`✅ Found bookings with ${successful.length} approach(es)`)
    successful.forEach((r, idx) => {
      console.log(`   Approach ${idx + 1}: ${r.count} booking${r.count === 1 ? '' : 's'}`)
    })
  } else {
    console.log(`❌ No bookings found with any approach`)
  }
  
  if (failed.length > 0) {
    console.log(`\n⚠️  ${failed.length} approach(es) failed`)
  }
  
  // Check if location ID might be wrong
  const allBookings = results.filter(r => r.success && r.count > 0)
  if (allBookings.length === 0) {
    console.log(`\n💡 Troubleshooting:`)
    console.log(`   1. Verify location ID ${UNION_ST_LOCATION_ID} is correct`)
    console.log(`   2. Check if Union St location exists in Square`)
    console.log(`   3. Verify API token has bookings.read permission`)
    console.log(`   4. Check if bookings exist for this location in Square dashboard`)
  }
}

main()
  .catch((err) => {
    console.error('\n❌ Fatal error:', err)
    process.exit(1)
  })




