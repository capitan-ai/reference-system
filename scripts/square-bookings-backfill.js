#!/usr/bin/env node
/**
 * Square Bookings Historical Backfill Script
 * 
 * Production-ready script for backfilling all historical bookings from Square.
 * Supports both full historical backfill and incremental sync.
 * 
 * Usage:
 *   # Full historical backfill
 *   node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N
 * 
 *   # Incremental sync (only new/updated bookings)
 *   node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N --incremental
 * 
 *   # Backfill with date filter
 *   node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N --updated-after 2024-01-01
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

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    location: null,
    incremental: false,
    updatedAfter: null,
    verify: true
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    if (arg === '--location' || arg === '-l') {
      options.location = args[++i]
    } else if (arg === '--incremental' || arg === '-i') {
      options.incremental = true
    } else if (arg === '--updated-after' || arg === '-u') {
      const dateStr = args[++i]
      options.updatedAfter = new Date(dateStr)
      if (isNaN(options.updatedAfter.getTime())) {
        console.error(`❌ Invalid date: ${dateStr}`)
        process.exit(1)
      }
    } else if (arg === '--no-verify') {
      options.verify = false
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Square Bookings Historical Backfill

Usage:
  node scripts/square-bookings-backfill.js [options]

Options:
  --location, -l <id>          Square location ID (required)
  --incremental, -i             Only fetch bookings updated after last sync
  --updated-after, -u <date>   Only fetch bookings updated after this date (ISO format)
  --no-verify                   Skip verification after backfill
  --help, -h                    Show this help message

Examples:
  # Full historical backfill for Union St
  node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N

  # Incremental sync
  node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N --incremental

  # Backfill from specific date
  node scripts/square-bookings-backfill.js --location LT4ZHFBQQYB2N --updated-after 2024-01-01T00:00:00Z
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
  console.log(`📍 Location ID: ${options.location}\n`)

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

  // Initialize backfill
  const backfill = new SquareBookingsBackfill(prisma, square, options.location, {
    limit: 100,
    maxRetries: 5,
    initialRetryDelay: 1000,
    maxRetryDelay: 60000
  })

  // Progress callback
  const onProgress = (progress) => {
    if (progress.page % 10 === 0 || !progress.cursor) {
      console.log(`   Progress: Page ${progress.page}, Fetched: ${progress.totalFetched}, Upserted: ${progress.totalUpserted}`)
    }
  }

  try {
    // Run backfill
    const stats = await backfill.backfillBookings({
      incremental: options.incremental,
      updatedAfter: options.updatedAfter,
      onProgress
    })

    // Verify if requested
    if (options.verify) {
      const verification = await backfill.verifyBackfill()
      
      if (!verification.allPassed) {
        console.log(`\n⚠️  Verification found issues. Review the output above.`)
        process.exit(1)
      }
    }

    console.log(`\n✅ Backfill completed successfully!`)
    process.exit(0)
  } catch (error) {
    console.error(`\n❌ Backfill failed:`, error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()




