#!/usr/bin/env node
/**
 * Check Union St bookings by month in 2022 to find when bookings actually start.
 * This helps determine the actual date range that has data.
 *
 * Usage:
 *   node scripts/check-union-st-bookings-by-month.js
 *
 * Environment:
 *   SQUARE_ACCESS_TOKEN (or SQUARE_ACCESS_TOKEN_2)
 *   SQUARE_ENV (production|sandbox) optional, defaults to production
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

function fmt(d) {
  return d.toISOString().split('T')[0] // Just the date part
}

function getMonthStart(year, month) {
  // month is 0-indexed (0 = January, 11 = December)
  return new Date(Date.UTC(year, month, 1, 0, 0, 0))
}

function getMonthEnd(year, month) {
  // Get last day of month
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59))
}

async function checkMonth(year, month) {
  const start = getMonthStart(year, month)
  const end = getMonthEnd(year, month)
  const monthName = start.toLocaleString('en-US', { month: 'long' })
  
  try {
    const resp = await bookingsApi.listBookings(
      1, // Just need to know if any exist
      undefined, // cursor
      undefined, // customerId
      undefined, // teamMemberId
      UNION_ST_LOCATION_ID,
      start.toISOString(),
      end.toISOString()
    )

    const bookings = resp.result?.bookings || []
    const count = bookings.length
    
    // If we found at least one, get the actual count
    let totalCount = count
    if (count > 0) {
      // Fetch all to get accurate count
      let cursor = resp.result?.cursor
      while (cursor) {
        const nextResp = await bookingsApi.listBookings(
          100,
          cursor,
          undefined,
          undefined,
          UNION_ST_LOCATION_ID,
          start.toISOString(),
          end.toISOString()
        )
        const nextBookings = nextResp.result?.bookings || []
        totalCount += nextBookings.length
        cursor = nextResp.result?.cursor
      }
    }
    
    return {
      month: monthName,
      year,
      monthNum: month + 1,
      start: fmt(start),
      end: fmt(end),
      count: totalCount,
      hasBookings: totalCount > 0
    }
  } catch (error) {
    console.error(`   ❌ Error checking ${monthName} ${year}:`, error.message)
    return {
      month: monthName,
      year,
      monthNum: month + 1,
      start: fmt(start),
      end: fmt(end),
      count: -1,
      hasBookings: false,
      error: error.message
    }
  }
}

async function checkYear(year) {
  const results = []
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  
  console.log(`\n📅 Checking ${year}:`)
  
  for (let month = 0; month < 12; month++) {
    process.stdout.write(`   ${months[month]}... `)
    const result = await checkMonth(year, month)
    results.push(result)
    
    if (result.error) {
      console.log(`❌ Error`)
    } else if (result.count > 0) {
      console.log(`✅ ${result.count} booking${result.count === 1 ? '' : 's'}`)
    } else {
      console.log(`⚪ 0`)
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  
  return results
}

async function main() {
  console.log(`🔍 Checking Union St bookings by month`)
  console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`)
  console.log(`📍 Location ID: ${UNION_ST_LOCATION_ID}\n`)
  
  const allResults = []
  const yearsToCheck = [2022, 2023, 2024]
  
  for (const year of yearsToCheck) {
    const yearResults = await checkYear(year)
    allResults.push({ year, results: yearResults })
  }
  
  // Summary
  console.log(`\n📊 Summary:`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  
  let firstYearWithBookings = null
  let firstMonthWithBookings = null
  let totalBookings = 0
  
  for (const { year, results } of allResults) {
    const monthsWithBookings = results.filter(r => r.count > 0)
    const yearTotal = results.reduce((sum, r) => sum + (r.count > 0 ? r.count : 0), 0)
    
    if (monthsWithBookings.length > 0 && !firstYearWithBookings) {
      firstYearWithBookings = year
      firstMonthWithBookings = monthsWithBookings[0]
    }
    
    totalBookings += yearTotal
    
    if (yearTotal > 0) {
      console.log(`\n${year}: ${yearTotal} total booking${yearTotal === 1 ? '' : 's'} in ${monthsWithBookings.length} month(s)`)
      monthsWithBookings.forEach(r => {
        console.log(`   - ${r.month}: ${r.count} booking${r.count === 1 ? '' : 's'}`)
      })
    }
  }
  
  if (!firstYearWithBookings) {
    console.log(`❌ No bookings found in 2022, 2023, or 2024`)
    console.log(`\n💡 This could mean:`)
    console.log(`   - Union St location didn't have bookings in these years`)
    console.log(`   - The location opened later (check 2025 or later)`)
    console.log(`   - There's an issue with the location ID or API access`)
    console.log(`   - Bookings might be stored in a different system`)
  } else {
    console.log(`\n✅ First bookings found in ${firstMonthWithBookings.month} ${firstYearWithBookings}`)
    console.log(`📈 Total bookings across all checked years: ${totalBookings}`)
    
    if (firstYearWithBookings === 2022) {
      console.log(`\n✅ 2022 has bookings! You can proceed with the backfill.`)
    } else if (firstYearWithBookings > 2022) {
      console.log(`\n⚠️  Note: First bookings are in ${firstYearWithBookings}, not 2022.`)
      console.log(`   You may want to adjust the backfill date range to start from ${firstYearWithBookings}.`)
    } else {
      console.log(`\n💡 Bookings start in ${firstYearWithBookings}, before 2022.`)
      console.log(`   You may want to backfill from ${firstYearWithBookings} instead.`)
    }
  }
  
  // Detailed table
  console.log(`\n📋 Detailed breakdown:`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  for (const { year, results } of allResults) {
    console.log(`\n${year}:`)
    console.log(`Month           | Bookings | Status`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    results.forEach(r => {
      const status = r.error ? '❌ Error' : (r.count > 0 ? '✅' : '⚪')
      const monthName = r.month.padEnd(14)
      const count = r.count >= 0 ? r.count.toString().padStart(8) : 'Error'.padStart(8)
      console.log(`${monthName} | ${count} | ${status}`)
    })
  }
}

main()
  .catch((err) => {
    console.error('\n❌ Fatal error:', err)
    process.exit(1)
  })

