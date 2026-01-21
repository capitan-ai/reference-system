#!/usr/bin/env node
/**
 * Square Bookings 2024 Backfill Script
 * 
 * Backfills all bookings from January 1, 2024 to December 31, 2024 into the database.
 * 
 * This script processes bookings month by month to ensure all historical data is captured.
 * 
 * Usage:
 *   # Backfill all 2024 bookings for a location
 *   node scripts/backfill-2024-bookings.js --location LT4ZHFBQQYB2N
 * 
 *   # Backfill for a specific customer
 *   node scripts/backfill-2024-bookings.js --location LT4ZHFBQQYB2N --customer E4WWWKMSZM3KY4RSNNBV5398GG
 * 
 *   # Skip verification
 *   node scripts/backfill-2024-bookings.js --location LT4ZHFBQQYB2N --no-verify
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
 * Generate monthly date ranges for 2024
 * @returns {Array<{start: Date, end: Date, label: string}>}
 */
function generate2024MonthlyRanges() {
  const ranges = []
  
  // Start: January 1, 2024 00:00:00 UTC
  // End: January 1, 2025 00:00:00 UTC (exclusive)
  const startDate = new Date('2024-01-01T00:00:00.000Z')
  const endDate = new Date('2025-01-01T00:00:00.000Z')
  
  const current = new Date(startDate)
  
  while (current < endDate) {
    const monthStart = new Date(current)
    const monthEnd = new Date(current)
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
    
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
    verify: true
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    if (arg === '--location' || arg === '-l') {
      options.location = args[++i]
    } else if (arg === '--customer' || arg === '-c') {
      options.customerId = args[++i]
    } else if (arg === '--no-verify') {
      options.verify = false
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Square Bookings 2024 Backfill

Backfills all bookings from January 1, 2024 to December 31, 2024 into the database.

Usage:
  node scripts/backfill-2024-bookings.js [options]

Options:
  --location, -l <id>          Square location ID (required)
  --customer, -c <id>          Square customer ID to filter by (optional)
  --no-verify                   Skip verification after backfill
  --help, -h                    Show this help message

Examples:
  # Backfill all 2024 bookings
  node scripts/backfill-2024-bookings.js --location LT4ZHFBQQYB2N

  # Backfill for specific customer
  node scripts/backfill-2024-bookings.js --location LT4ZHFBQQYB2N --customer E4WWWKMSZM3KY4RSNNBV5398GG
`)
      process.exit(0)
    }
  }

  // Use environment variable as fallback
  if (!options.location) {
    options.location = process.env.SQUARE_LOCATION_ID?.trim()
  }

  if (!options.location) {
    console.error('❌ --location is required (or set SQUARE_LOCATION_ID environment variable)')
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
  console.log(`📅 Date Range: 2024-01-01 to 2024-12-31`)
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

  // Generate monthly ranges for 2024
  const monthlyRanges = generate2024MonthlyRanges()
  
  console.log(`📅 Processing ${monthlyRanges.length} month(s) for 2024`)
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
  console.log(`📊 OVERALL SUMMARY - 2024 BACKFILL`)
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
        customer_id: options.customerId,
        start_at: {
          gte: new Date('2024-01-01T00:00:00.000Z'),
          lt: new Date('2025-01-01T00:00:00.000Z')
        }
      }
    })
    console.log(`\n📊 Customer ${options.customerId} bookings in database for 2024: ${customerBookings}`)
  } else {
    // Show 2024-specific stats
    const bookings2024 = await prisma.booking.count({
      where: {
        location_id: options.location,
        start_at: {
          gte: new Date('2024-01-01T00:00:00.000Z'),
          lt: new Date('2025-01-01T00:00:00.000Z')
        }
      }
    })
    console.log(`\n📊 Total 2024 bookings in database: ${bookings2024}`)
  }

  console.log(`\n✅ 2024 backfill completed successfully!`)
  process.exit(0)
}

main().catch((error) => {
  console.error(`\n❌ Fatal error:`, error.message)
  console.error(error.stack)
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})

