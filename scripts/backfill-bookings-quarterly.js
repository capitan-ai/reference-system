#!/usr/bin/env node
/**
 * Backfill Square Bookings in 3-Month (Quarterly) Chunks
 * 
 * This script fetches and saves historical bookings from Square in 3-month chunks.
 * It processes all locations (seller-level) and saves bookings to the database.
 * 
 * Usage:
 *   node scripts/backfill-bookings-quarterly.js [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]
 * 
 * Examples:
 *   # Backfill September 1 - December 31, 2025 (default)
 *   node scripts/backfill-bookings-quarterly.js
 * 
 *   # Backfill custom date range
 *   node scripts/backfill-bookings-quarterly.js --start-date 2025-09-01 --end-date 2025-12-31
 * 
 * Environment:
 *   SQUARE_ACCESS_TOKEN - Required
 *   SQUARE_ENV (production|sandbox) - Optional, defaults to production
 *   DATABASE_URL - Required
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const SquareBookingsBackfill = require('../lib/square-bookings-backfill')

const prisma = new PrismaClient()

/**
 * Generate 3-month (quarterly) date ranges from start to end
 * Note: Square API has a 31-day limit per request, so we'll process monthly within each quarter
 * @param {Date} startDate - Start date (inclusive)
 * @param {Date} endDate - End date (inclusive)
 * @returns {Array<{start: Date, end: Date, label: string}>}
 */
function generateQuarterlyRanges(startDate, endDate) {
  const ranges = []
  const current = new Date(startDate)
  const end = new Date(endDate)
  
  // Set to first day at midnight UTC
  current.setUTCHours(0, 0, 0, 0)
  end.setUTCHours(23, 59, 59, 999)
  
  while (current <= end) {
    const quarterStart = new Date(current)
    const quarterEnd = new Date(current)
    
    // Add 3 months, but cap at 31 days for Square API limit
    // Actually, let's do monthly instead since 3 months > 31 days
    // Square API limit is 31 days, so we'll break quarters into months
    quarterEnd.setUTCMonth(quarterEnd.getUTCMonth() + 1)
    quarterEnd.setUTCDate(0) // Last day of the month
    quarterEnd.setUTCHours(23, 59, 59, 999)
    
    // Don't go past the end date
    if (quarterEnd > end) {
      quarterEnd.setTime(end.getTime())
    }
    
    // Ensure range is at most 31 days (Square API limit)
    const daysDiff = Math.ceil((quarterEnd - quarterStart) / (1000 * 60 * 60 * 24))
    if (daysDiff > 31) {
      quarterEnd.setTime(quarterStart.getTime())
      quarterEnd.setUTCDate(quarterEnd.getUTCDate() + 31)
      quarterEnd.setUTCHours(23, 59, 59, 999)
      if (quarterEnd > end) {
        quarterEnd.setTime(end.getTime())
      }
    }
    
    const startMonth = String(quarterStart.getUTCMonth() + 1).padStart(2, '0')
    const endMonth = String(quarterEnd.getUTCMonth() + 1).padStart(2, '0')
    
    const label = `${quarterStart.getUTCFullYear()}-${startMonth}`
    if (quarterEnd.getUTCFullYear() !== quarterStart.getUTCFullYear() || quarterEnd.getUTCMonth() !== quarterStart.getUTCMonth()) {
      const labelEnd = `${quarterEnd.getUTCFullYear()}-${endMonth}`
      label = `${label} to ${labelEnd}`
    }
    
    ranges.push({
      start: quarterStart,
      end: quarterEnd,
      label
    })
    
    // Move to next month (start of next month)
    current.setUTCMonth(current.getUTCMonth() + 1)
    current.setUTCDate(1)
    current.setUTCHours(0, 0, 0, 0)
  }
  
  return ranges
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    startDate: new Date('2025-09-01T00:00:00Z'), // Default: September 1, 2025
    endDate: new Date('2025-12-31T23:59:59Z'),   // Default: December 31, 2025
    verify: true
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    if (arg === '--start-date') {
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
      // Add 1 day to make it inclusive of the end date
      options.endDate.setUTCHours(23, 59, 59, 999)
    } else if (arg === '--no-verify') {
      options.verify = false
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Backfill Square Bookings in 3-Month Chunks

Fetches historical bookings from Square in 3-month (quarterly) chunks
and saves them to the database for all locations.

Usage:
  node scripts/backfill-bookings-quarterly.js [options]

Options:
  --start-date <date>    Start date in ISO format (YYYY-MM-DD, default: 2025-09-01)
  --end-date <date>      End date in ISO format (YYYY-MM-DD, default: 2025-12-31)
  --no-verify            Skip verification after backfill
  --help, -h             Show this help message

Examples:
  # Backfill September 1 - December 31, 2025 (default)
  node scripts/backfill-bookings-quarterly.js

  # Backfill custom date range
  node scripts/backfill-bookings-quarterly.js --start-date 2025-06-01 --end-date 2025-09-30

Notes:
  - Processes all locations (seller-level access required)
  - Bookings are saved to the database using UPSERT (no duplicates)
  - Each quarter is processed separately with progress tracking
      `)
      process.exit(0)
    }
  }

  return options
}

async function ensureLocationsExist(square) {
  console.log(`\n📍 Ensuring locations exist in database...`)
  
  try {
    const locationsResp = await square.locationsApi.listLocations()
    const locations = locationsResp.result?.locations || []
    
    if (locations.length === 0) {
      console.log(`   ⚠️  No locations found in Square`)
      return []
    }
    
    const locationIds = []
    
    for (const location of locations) {
      const locationId = location.id
      locationIds.push(locationId)
      
      try {
        const existing = await prisma.location.findUnique({
          where: { square_location_id: locationId }
        })
        
        if (!existing) {
          const locationName = location.name || 'Unknown Location'
          await prisma.location.create({
            data: {
              square_location_id: locationId,
              name: locationName
            }
          })
          console.log(`   ✅ Created location: ${locationName} (${locationId})`)
        } else {
          console.log(`   ℹ️  Location exists: ${existing.name} (${locationId})`)
        }
      } catch (error) {
        console.error(`   ❌ Error ensuring location ${locationId}:`, error.message)
      }
    }
    
    return locationIds
  } catch (error) {
    console.error(`   ❌ Error fetching locations:`, error.message)
    return []
  }
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
  console.log(`📅 Date range: ${options.startDate.toISOString().split('T')[0]} to ${options.endDate.toISOString().split('T')[0]}`)
  console.log()

  // Ensure all locations exist in database
  const locationIds = await ensureLocationsExist(square)
  
  if (locationIds.length > 0) {
    console.log(`\n✅ Found ${locationIds.length} location(s) in Square`)
  }

  // Generate quarterly ranges
  const quarterlyRanges = generateQuarterlyRanges(options.startDate, options.endDate)
  
  console.log(`\n📅 Processing ${quarterlyRanges.length} quarter(s) (3-month chunks)`)
  console.log()

  // Track overall statistics
  const overallStats = {
    totalQuarters: quarterlyRanges.length,
    quartersProcessed: 0,
    totalFetched: 0,
    totalUpserted: 0,
    totalErrors: 0,
    totalRetries: 0
  }

  const startTime = Date.now()

  // Process each quarter (seller-level, all locations)
  // Pass undefined/null for locationId to get seller-level access (all locations)
  const backfill = new SquareBookingsBackfill(prisma, square, undefined, {
    limit: 100,
    maxRetries: 5,
    initialRetryDelay: 1000,
    maxRetryDelay: 60000
  })

  // Process each quarter
  for (let i = 0; i < quarterlyRanges.length; i++) {
    const range = quarterlyRanges[i]
    overallStats.quartersProcessed++
    
    console.log(`\n${'='.repeat(60)}`)
    console.log(`📆 Quarter ${i + 1}/${quarterlyRanges.length}: ${range.label}`)
    console.log(`   From: ${range.start.toISOString()}`)
    console.log(`   To:   ${range.end.toISOString()}`)
    console.log(`${'='.repeat(60)}`)

    try {
      // Reset stats for this quarter (but keep overall tracking)
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

      // Run backfill for this quarter (seller-level, all locations)
      // Pass undefined/null for locationId to get all locations
      const quarterStats = await backfill.backfillBookings({
        incremental: false,
        updatedAfter: null,
        startAtMin: range.start,
        startAtMax: range.end,
        onProgress
      })

      // Accumulate statistics
      overallStats.totalFetched += quarterStats.totalFetched
      overallStats.totalUpserted += quarterStats.totalUpserted
      overallStats.totalErrors += quarterStats.totalErrors
      overallStats.totalRetries += quarterStats.totalRetries

      console.log(`\n✅ Quarter ${range.label} completed:`)
      console.log(`   Fetched: ${quarterStats.totalFetched}`)
      console.log(`   Upserted: ${quarterStats.totalUpserted}`)
      console.log(`   Errors: ${quarterStats.totalErrors}`)
      console.log(`   Retries: ${quarterStats.totalRetries}`)

      // Small delay between quarters to avoid rate limiting
      if (i < quarterlyRanges.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } catch (error) {
      console.error(`\n❌ Error processing quarter ${range.label}:`, error.message)
      if (error.stack) {
        console.error(error.stack)
      }
      overallStats.totalErrors++
      
      // Continue with next quarter instead of failing completely
      console.log(`   Continuing with next quarter...`)
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  // Final summary
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 OVERALL SUMMARY`)
  console.log(`${'='.repeat(60)}`)
  console.log(`   Quarters processed: ${overallStats.quartersProcessed}/${overallStats.totalQuarters}`)
  console.log(`   Total fetched: ${overallStats.totalFetched}`)
  console.log(`   Total upserted: ${overallStats.totalUpserted}`)
  console.log(`   Total errors: ${overallStats.totalErrors}`)
  console.log(`   Total retries: ${overallStats.totalRetries}`)
  console.log(`   Duration: ${duration}s`)
  console.log(`${'='.repeat(60)}`)

  // Verify if requested
  if (options.verify) {
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
  }

  // Show location-specific statistics
  if (locationIds.length > 0) {
    console.log(`\n📊 Bookings by location:`)
    for (const locationId of locationIds) {
      try {
        const location = await prisma.location.findUnique({
          where: { square_location_id: locationId }
        })
        if (location) {
          const count = await prisma.booking.count({
            where: {
              location_id: locationId,
              start_at: {
                gte: options.startDate,
                lte: options.endDate
              }
            }
          })
          console.log(`   ${location.name}: ${count} bookings`)
        }
      } catch (error) {
        console.warn(`   Location ${locationId}: Error counting bookings: ${error.message}`)
      }
    }
  }

  console.log(`\n✅ Quarterly backfill completed successfully!`)
  process.exit(0)
}

main().catch((error) => {
  console.error(`\n❌ Fatal error:`, error.message)
  console.error(error.stack)
  process.exit(1)
}).finally(async () => {
  await prisma.$disconnect()
})

