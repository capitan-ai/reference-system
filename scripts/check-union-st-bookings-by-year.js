#!/usr/bin/env node
/**
 * Check Union St bookings by year to find when bookings actually start.
 * Checks 2020-2024 to find the earliest year with data.
 *
 * Usage:
 *   node scripts/check-union-st-bookings-by-year.js
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
  return d.toISOString().split('T')[0]
}

async function checkYear(year) {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0)) // Jan 1
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59)) // Dec 31
  
  try {
    // First, try to get at least one booking to see if any exist
    const resp = await bookingsApi.listBookings(
      1,
      undefined,
      undefined,
      undefined,
      UNION_ST_LOCATION_ID,
      start.toISOString(),
      end.toISOString()
    )

    const bookings = resp.result?.bookings || []
    const hasBookings = bookings.length > 0
    
    if (!hasBookings) {
      return { year, count: 0, hasBookings: false }
    }
    
    // If we found at least one, count all of them
    let totalCount = bookings.length
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
    
    // Get earliest and latest booking dates
    let earliest = null
    let latest = null
    
    if (totalCount > 0) {
      // Fetch first page again to get dates
      const firstResp = await bookingsApi.listBookings(
        100,
        undefined,
        undefined,
        undefined,
        UNION_ST_LOCATION_ID,
        start.toISOString(),
        end.toISOString()
      )
      const allBookings = firstResp.result?.bookings || []
      
      if (allBookings.length > 0) {
        const dates = allBookings
          .map(b => b.startAt ? new Date(b.startAt) : null)
          .filter(d => d !== null)
          .sort((a, b) => a - b)
        
        if (dates.length > 0) {
          earliest = dates[0]
          latest = dates[dates.length - 1]
        }
      }
    }
    
    return {
      year,
      count: totalCount,
      hasBookings: true,
      earliest: earliest ? fmt(earliest) : null,
      latest: latest ? fmt(latest) : null
    }
  } catch (error) {
    console.error(`   ❌ Error checking ${year}:`, error.message)
    return {
      year,
      count: -1,
      hasBookings: false,
      error: error.message
    }
  }
}

async function main() {
  console.log(`🔍 Checking Union St bookings by year`)
  console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment\n`)
  
  const years = [2020, 2021, 2022, 2023, 2024, 2025]
  const results = []
  
  // Check each year
  for (const year of years) {
    process.stdout.write(`   Checking ${year}... `)
    const result = await checkYear(year)
    results.push(result)
    
    if (result.error) {
      console.log(`❌ Error`)
    } else if (result.count > 0) {
      console.log(`✅ ${result.count} booking${result.count === 1 ? '' : 's'}`)
      if (result.earliest && result.latest) {
        console.log(`      (${result.earliest} to ${result.latest})`)
      }
    } else {
      console.log(`⚪ 0 bookings`)
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  
  // Summary
  console.log(`\n📊 Summary:`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  
  const yearsWithBookings = results.filter(r => r.count > 0)
  const totalBookings = results.reduce((sum, r) => sum + (r.count > 0 ? r.count : 0), 0)
  
  if (yearsWithBookings.length === 0) {
    console.log(`❌ No bookings found in any checked year (2020-2025)`)
    console.log(`\n💡 This could mean:`)
    console.log(`   - Union St location doesn't have historical bookings in Square`)
    console.log(`   - The location ID might be incorrect`)
    console.log(`   - There's an issue with API access or permissions`)
    console.log(`   - Bookings might be stored differently or in a different system`)
  } else {
    console.log(`✅ Found bookings in ${yearsWithBookings.length} year(s)`)
    console.log(`📈 Total bookings across all years: ${totalBookings}`)
    
    const firstYear = yearsWithBookings[0]
    const lastYear = yearsWithBookings[yearsWithBookings.length - 1]
    
    console.log(`\n📅 Years with bookings:`)
    yearsWithBookings.forEach(r => {
      const dateRange = r.earliest && r.latest ? ` (${r.earliest} to ${r.latest})` : ''
      console.log(`   ${r.year}: ${r.count} booking${r.count === 1 ? '' : 's'}${dateRange}`)
    })
    
    console.log(`\n🎯 First year with data: ${firstYear.year}`)
    if (firstYear.earliest) {
      console.log(`   Earliest booking: ${firstYear.earliest}`)
    }
    
    if (firstYear.year === 2022) {
      console.log(`\n✅ 2022 has bookings! You can proceed with the backfill.`)
    } else if (firstYear.year > 2022) {
      console.log(`\n⚠️  Note: First bookings are in ${firstYear.year}, not 2022.`)
      console.log(`   You may want to adjust the backfill date range.`)
    } else {
      console.log(`\n💡 Bookings start in ${firstYear.year}, before 2022.`)
      console.log(`   You may want to backfill from ${firstYear.year} instead.`)
    }
  }
  
  // Detailed table
  console.log(`\n📋 Detailed breakdown:`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`Year  | Bookings | Status`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  results.forEach(r => {
    const status = r.error ? '❌ Error' : (r.count > 0 ? '✅' : '⚪')
    const year = r.year.toString().padEnd(5)
    const count = r.count >= 0 ? r.count.toString().padStart(9) : 'Error'.padStart(9)
    console.log(`${year} | ${count} | ${status}`)
  })
}

main()
  .catch((err) => {
    console.error('\n❌ Fatal error:', err)
    process.exit(1)
  })


