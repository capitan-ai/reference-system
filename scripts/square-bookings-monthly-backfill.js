#!/usr/bin/env node
/**
 * Square Bookings Monthly Historical Backfill Script
 * 
 * Fetches historical bookings from Square in monthly chunks, starting from
 * January 2022 (or 2023) up to the present, and stores them in the database.
 * 
 * CRITICAL: Square does NOT return historical bookings unless a start_at_range
 * filter is explicitly provided. This script processes month by month to ensure
 * all historical data is captured.
 * 
 * Usage:
 *   # Backfill all bookings for a location (month by month from 2022)
 *   node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N
 * 
 *   # Backfill for a specific customer
 *   node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --customer E4WWWKMSZM3KY4RSNNBV5398GG
 * 
 *   # Start from 2023 instead of 2022
 *   node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --start-year 2023
 * 
 *   # Backfill specific date range
 *   node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --start-date 2022-06-01 --end-date 2022-12-31
 * 
 * Environment:
 *   SQUARE_ACCESS_TOKEN (or SQUARE_ACCESS_TOKEN_2)
 *   SQUARE_ENV (production|sandbox) optional, defaults to production
 *   DATABASE_URL
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const SquareBookingsBackfill = require('../lib/square-bookings-backfill')

const prisma = new PrismaClient()

/**
 * Generate monthly date ranges from start to end
 * @param {Date} startDate - Start date (inclusive)
 * @param {Date} endDate - End date (exclusive, will be set to start of next month)
 * @returns {Array<{start: Date, end: Date, label: string}>}
 */
function generateMonthlyRanges(startDate, endDate) {
  const ranges = []
  const current = new Date(startDate)
  const end = new Date(endDate)
  
  // Set to first day of month at midnight UTC
  current.setUTCDate(1)
  current.setUTCHours(0, 0, 0, 0)
  
  while (current < end) {
    const monthStart = new Date(current)
    const monthEnd = new Date(current)
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
    
    // Don't go past the end date
    if (monthEnd > end) {
      monthEnd.setTime(end.getTime())
    }
    
    const label = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`
    
    ranges.push({
      start: monthStart,
      end: monthEnd,
      label
    })
    
    // Move to next month
    current.setUTCMonth(current.getUTCMonth() + 1)
  }
  
  return ranges
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    location: null,
    customerId: null,
    startYear: 2022,
    startDate: null,
    endDate: null,
    verify: true
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    if (arg === '--location' || arg === '-l') {
      options.location = args[++i]
    } else if (arg === '--customer' || arg === '-c') {
      options.customerId = args[++i]
    } else if (arg === '--start-year') {
      options.startYear = parseInt(args[++i], 10)
      if (isNaN(options.startYear) || options.startYear < 2000 || options.startYear > 2100) {
        console.error(`❌ Invalid start year: ${args[i]}`)
        process.exit(1)
      }
    } else if (arg === '--start-date') {
      const dateStr = args[++i]
      options.startDate = new Date(dateStr)
      if (isNaN(options.startDate.getTime())) {
        console.error(`❌ Invalid start date: ${dateStr}`)
        process.exit(1)
      }
    } else if (arg === '--end-date') {
      const dateStr = args[++i]
      options.endDate = new Date(dateStr)
      if (isNaN(options.endDate.getTime())) {
        console.error(`❌ Invalid end date: ${dateStr}`)
        process.exit(1)
      }
    } else if (arg === '--no-verify') {
      options.verify = false
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Square Bookings Monthly Historical Backfill

Fetches historical bookings from Square in monthly chunks, starting from
January 2022 (or specified year) up to the present.

CRITICAL: Square does NOT return historical bookings unless a start_at_range
filter is explicitly provided. This script processes month by month to ensure
all historical data is captured.

Usage:
  node scripts/square-bookings-monthly-backfill.js [options]

Options:
  --location, -l <id>          Square location ID (required)
  --customer, -c <id>          Square customer ID to filter by (optional)
  --start-year <year>          Start year (default: 2022)
  --start-date <date>           Start date in ISO format (YYYY-MM-DD)
  --end-date <date>             End date in ISO format (YYYY-MM-DD, default: now)
  --no-verify                   Skip verification after backfill
  --help, -h                    Show this help message

Examples:
  # Backfill all bookings from 2022 to present
  node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N

  # Backfill for specific customer
  node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --customer E4WWWKMSZM3KY4RSNNBV5398GG

  # Start from 2023
  node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --start-year 2023

  # Specific date range
  node scripts/square-bookings-monthly-backfill.js --location LT4ZHFBQQYB2N --start-date 2022-06-01 --end-date 2022-12-31
`)
      process.exit(0)
    }
  }

  if (!options.location) {
    console.error('❌ --location is required')
    console.error('   Use --help for usage information')
    process.exit(1)
  }

  return options
}

async function main() {
  const options = parseArgs()

  // Initialize Square client
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

  console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`)
  console.log(`📍 Location ID: ${options.location}`)
  if (options.customerId) {
    console.log(`👤 Customer ID: ${options.customerId}`)
  }
  console.log()

  // Ensure location exists in database
  try {
    const location = await prisma.location.findUnique({
      where: { square_location_id: options.location }
    })

    if (!location) {
      console.log(`⚠️  Location ${options.location} not found in database`)
      console.log(`   Creating location record...`)
      
      // Try to fetch location name from Square
      let locationName = 'Unknown Location'
      try {
        const locationsResp = await square.locationsApi.listLocations()
        const squareLocation = locationsResp.result?.locations?.find(
          loc => loc.id === options.location
        )
        if (squareLocation) {
          locationName = squareLocation.name || locationName
        }
      } catch (err) {
        console.warn(`   Could not fetch location name from Square: ${err.message}`)
      }

      await prisma.location.create({
        data: {
          square_location_id: options.location,
          name: locationName
        }
      })
      console.log(`   ✅ Location created: ${locationName}`)
    } else {
      console.log(`✅ Location found: ${location.name}`)
    }
  } catch (error) {
    console.error(`❌ Error ensuring location exists:`, error.message)
    process.exit(1)
  }

  // Determine date range
  const now = new Date()
  const startDate = options.startDate || new Date(options.startYear, 0, 1) // January 1st of start year
  const endDate = options.endDate || now

  // Generate monthly ranges
  const monthlyRanges = generateMonthlyRanges(startDate, endDate)
  
  console.log(`📅 Processing ${monthlyRanges.length} month(s) from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`)
  console.log()

  // Initialize backfill with customer filter if provided
  const backfill = new SquareBookingsBackfill(prisma, square, options.location, {
    limit: 100,
    maxRetries: 5,
    initialRetryDelay: 1000,
    maxRetryDelay: 60000,
    customerId: options.customerId || null
  })

  // Track overall statistics
  const overallStats = {
    totalMonths: monthlyRanges.length,
    monthsProcessed: 0,
    totalFetched: 0,
    totalUpserted: 0,
    totalErrors: 0,
    totalRetries: 0
  }

  const startTime = Date.now()

  // Process each month
  for (let i = 0; i < monthlyRanges.length; i++) {
    const range = monthlyRanges[i]
    overallStats.monthsProcessed++
    
    console.log(`\n${'='.repeat(60)}`)
    console.log(`📆 Month ${i + 1}/${monthlyRanges.length}: ${range.label}`)
    console.log(`   From: ${range.start.toISOString()}`)
    console.log(`   To:   ${range.end.toISOString()}`)
    console.log(`${'='.repeat(60)}`)

    try {
      // Reset stats for this month (but keep overall tracking)
      backfill.stats.totalFetched = 0
      backfill.stats.totalUpserted = 0
      backfill.stats.totalErrors = 0
      backfill.stats.totalRetries = 0
      backfill.stats.pagesProcessed = 0

      // Progress callback
      const onProgress = (progress) => {
        if (progress.page % 10 === 0 || !progress.cursor) {
          console.log(`   Progress: Page ${progress.page}, Fetched: ${progress.totalFetched}, Upserted: ${progress.totalUpserted}`)
        }
      }

      // Run backfill for this month
      const monthStats = await backfill.backfillBookings({
        incremental: false,
        updatedAfter: null,
        startAtMin: range.start,
        startAtMax: range.end,
        onProgress
      })

      // Accumulate statistics
      overallStats.totalFetched += monthStats.totalFetched
      overallStats.totalUpserted += monthStats.totalUpserted
      overallStats.totalErrors += monthStats.totalErrors
      overallStats.totalRetries += monthStats.totalRetries

      console.log(`\n✅ Month ${range.label} completed:`)
      console.log(`   Fetched: ${monthStats.totalFetched}`)
      console.log(`   Upserted: ${monthStats.totalUpserted}`)
      console.log(`   Errors: ${monthStats.totalErrors}`)
      console.log(`   Retries: ${monthStats.totalRetries}`)

      // Small delay between months to avoid rate limiting
      if (i < monthlyRanges.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    } catch (error) {
      console.error(`\n❌ Error processing month ${range.label}:`, error.message)
      overallStats.totalErrors++
      
      // Continue with next month instead of failing completely
      console.log(`   Continuing with next month...`)
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  // Final summary
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 OVERALL SUMMARY`)
  console.log(`${'='.repeat(60)}`)
  console.log(`   Months processed: ${overallStats.monthsProcessed}/${overallStats.totalMonths}`)
  console.log(`   Total fetched: ${overallStats.totalFetched}`)
  console.log(`   Total upserted: ${overallStats.totalUpserted}`)
  console.log(`   Total errors: ${overallStats.totalErrors}`)
  console.log(`   Total retries: ${overallStats.totalRetries}`)
  console.log(`   Duration: ${duration}s`)
  console.log(`${'='.repeat(60)}`)

  // Verify if requested
  if (options.verify && !options.customerId) {
    // Only verify if not filtering by customer (verification doesn't work well with customer filter)
    console.log(`\n🔍 Verifying backfill completeness...`)
    try {
      const verification = await backfill.verifyBackfill()
      
      if (!verification.allPassed) {
        console.log(`\n⚠️  Verification found issues. Review the output above.`)
        process.exit(1)
      }
    } catch (error) {
      console.warn(`\n⚠️  Verification failed: ${error.message}`)
      console.log(`   Continuing anyway...`)
    }
  } else if (options.customerId) {
    // For customer-specific backfill, show customer-specific stats
    const customerBookings = await prisma.booking.count({
      where: {
        location_id: options.location,
        customer_id: options.customerId
      }
    })
    console.log(`\n📊 Customer ${options.customerId} bookings in database: ${customerBookings}`)
  }

  console.log(`\n✅ Monthly backfill completed successfully!`)
  process.exit(0)
}

main().catch((error) => {
  console.error(`\n❌ Fatal error:`, error.message)
  console.error(error.stack)
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})


