#!/usr/bin/env node
/**
 * Fetch December 2025 bookings from Square API
 * 
 * This script fetches all bookings for December 2025 using Square's listBookings API.
 * According to Square docs: start_at_min defaults to current time if not set,
 * which is why we MUST explicitly set both start_at_min and start_at_max for historical data.
 * 
 * Usage:
 *   node scripts/get-december-2025-bookings.js [--location LOCATION_ID] [--save]
 * 
 * Environment:
 *   SQUARE_ACCESS_TOKEN - Required
 *   SQUARE_ENV (production|sandbox) - Optional, defaults to production
 *   DATABASE_URL - Required if --save is used
 */

require('dotenv').config()
const { Client, Environment } = require('square')

// Configuration based on Square API documentation
const DECEMBER_2025_START = '2025-12-01T00:00:00Z'  // start_at_min
const DECEMBER_2025_END = '2026-01-01T00:00:00Z'    // start_at_max (exclusive, so this includes all of Dec)
const DEFAULT_LIMIT = 100  // Square's max is 100 per page

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    locationId: null,
    save: false
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--location' || arg === '-l') {
      options.locationId = args[++i]
    } else if (arg === '--save') {
      options.save = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Fetch December 2025 Bookings from Square

Usage:
  node scripts/get-december-2025-bookings.js [options]

Options:
  --location, -l <id>    Square location ID (optional, fetches all locations if not specified)
  --save                  Save bookings to database (requires DATABASE_URL)
  --help, -h              Show this help message

Examples:
  # Fetch December 2025 bookings for a specific location
  node scripts/get-december-2025-bookings.js --location LT4ZHFBQQYB2N

  # Fetch and save to database
  node scripts/get-december-2025-bookings.js --location LT4ZHFBQQYB2N --save

Notes:
  - Square API requires explicit start_at_min and start_at_max for historical bookings
  - Date range is capped at 31 days (December fits within this limit)
  - Requires APPOINTMENTS_ALL_READ scope in Square access token
      `)
      process.exit(0)
    }
  }

  return options
}

async function fetchDecember2025Bookings(bookingsApi, locationId = null) {
  console.log(`📅 Fetching December 2025 bookings from Square...`)
  console.log(`   Date range: ${DECEMBER_2025_START} to ${DECEMBER_2025_END}`)
  if (locationId) {
    console.log(`   Location ID: ${locationId}`)
  } else {
    console.log(`   Location: All locations (seller-level)`)
  }
  console.log()

  let allBookings = []
  let cursor = undefined
  let pageCount = 0
  let totalFetched = 0

  do {
    pageCount++
    
    try {
      // Square SDK listBookings signature (positional parameters):
      // listBookings(limit?, cursor?, customerId?, teamMemberId?, locationId?, startAtMin?, startAtMax?)
      //
      // According to Square API docs:
      // - start_at_min: REQUIRED for historical bookings (defaults to current time if not set)
      // - start_at_max: REQUIRED for historical bookings (defaults to 31 days after start_at_min)
      // - Range is capped at 31 days (December fits within this)
      
      const response = await bookingsApi.listBookings(
        DEFAULT_LIMIT,          // limit
        cursor || undefined,     // cursor
        undefined,               // customerId
        undefined,               // teamMemberId
        locationId || undefined, // locationId (null = all locations for seller)
        DECEMBER_2025_START,     // start_at_min - REQUIRED
        DECEMBER_2025_END        // start_at_max - REQUIRED
      )

      const result = response.result || {}
      const bookings = result.bookings || []
      const errors = result.errors || []

      if (errors.length > 0) {
        console.error(`   ⚠️  API returned errors:`, JSON.stringify(errors, null, 2))
      }

      allBookings.push(...bookings)
      totalFetched += bookings.length
      cursor = result.cursor || null

      if (bookings.length > 0) {
        console.log(`   Page ${pageCount}: Fetched ${bookings.length} booking(s) (Total: ${totalFetched})`)
        
        // Show sample booking dates
        if (pageCount === 1) {
          const sampleDate = bookings[0]?.startAt || bookings[0]?.start_at
          if (sampleDate) {
            console.log(`   Sample booking date: ${sampleDate}`)
          }
        }
      } else {
        console.log(`   Page ${pageCount}: No bookings found`)
      }

      // Rate limiting: small delay between pages
      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }

    } catch (error) {
      console.error(`\n❌ Error fetching page ${pageCount}:`, error.message)
      
      if (error.statusCode === 429) {
        console.log(`   Rate limited. Waiting 2 seconds before retry...`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        continue
      }
      
      if (error.statusCode === 401 || error.statusCode === 403) {
        console.error(`   Authentication failed. Check your Square access token has APPOINTMENTS_ALL_READ scope.`)
        throw error
      }
      
      if (error.errors) {
        console.error(`   Error details:`, JSON.stringify(error.errors, null, 2))
      }
      
      throw error
    }

  } while (cursor)

  return allBookings
}

async function saveBookingsToDatabase(bookings, locationId) {
  // This would use Prisma to save bookings
  // You can integrate with your existing SquareBookingsBackfill class
  console.log(`\n💾 Saving ${bookings.length} booking(s) to database...`)
  console.log(`   Note: Implement database saving logic here`)
  // Example:
  // const { PrismaClient } = require('@prisma/client')
  // const SquareBookingsBackfill = require('../lib/square-bookings-backfill')
  // const prisma = new PrismaClient()
  // const backfill = new SquareBookingsBackfill(prisma, square, locationId)
  // for (const booking of bookings) {
  //   await backfill.upsertBooking(booking)
  // }
}

async function main() {
  const options = parseArgs()

  // Initialize Square client
  const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
  const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
  
  let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
  
  if (!token) {
    console.error('❌ Missing SQUARE_ACCESS_TOKEN')
    console.error('   Set SQUARE_ACCESS_TOKEN environment variable with your Square access token')
    process.exit(1)
  }
  
  if (token.startsWith('Bearer ')) {
    token = token.slice(7)
  }

  const square = new Client({
    accessToken: token.trim(),
    environment
  })

  console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`)
  console.log()

  try {
    // Fetch bookings
    const bookings = await fetchDecember2025Bookings(
      square.bookingsApi,
      options.locationId
    )

    // Summary
    console.log(`\n${'='.repeat(60)}`)
    console.log(`📊 SUMMARY`)
    console.log(`${'='.repeat(60)}`)
    console.log(`   Total bookings fetched: ${bookings.length}`)
    
    if (bookings.length > 0) {
      // Analyze bookings
      const withCustomer = bookings.filter(b => b.customerId || b.customer_id)
      const uniqueCustomers = new Set(bookings.map(b => b.customerId || b.customer_id).filter(Boolean))
      const uniqueLocations = new Set(bookings.map(b => b.locationId || b.location_id).filter(Boolean))
      
      const dates = bookings
        .map(b => new Date(b.startAt || b.start_at || 0))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => a - b)
      
      const earliestDate = dates[0]
      const latestDate = dates[dates.length - 1]

      console.log(`   Bookings with customer ID: ${withCustomer.length}/${bookings.length}`)
      console.log(`   Unique customers: ${uniqueCustomers.size}`)
      console.log(`   Unique locations: ${uniqueLocations.size}`)
      
      if (earliestDate && latestDate) {
        console.log(`   Date range: ${earliestDate.toISOString()} to ${latestDate.toISOString()}`)
      }
      
      // Show sample booking
      console.log(`\n   Sample booking (first):`)
      const sample = bookings[0]
      console.log(`     ID: ${sample.id}`)
      console.log(`     Start: ${sample.startAt || sample.start_at}`)
      console.log(`     Customer: ${sample.customerId || sample.customer_id || 'N/A'}`)
      console.log(`     Location: ${sample.locationId || sample.location_id || 'N/A'}`)
      console.log(`     Status: ${sample.status || 'N/A'}`)
    }

    console.log(`${'='.repeat(60)}\n`)

    // Save to database if requested
    if (options.save) {
      if (options.locationId) {
        await saveBookingsToDatabase(bookings, options.locationId)
      } else {
        console.log(`⚠️  --save requires --location to be specified`)
      }
    } else {
      console.log(`💡 Tip: Use --save to store these bookings in the database`)
    }

    console.log(`✅ Completed successfully!`)
    process.exit(0)

  } catch (error) {
    console.error(`\n❌ Fatal error:`, error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

main()

