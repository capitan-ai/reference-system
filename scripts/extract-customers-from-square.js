#!/usr/bin/env node
/**
 * Extract all customers from Square by fetching their bookings
 * 
 * This script fetches bookings from Square and extracts unique customer IDs,
 * then optionally fetches all bookings for each customer.
 * 
 * Usage:
 *   node scripts/extract-customers-from-square.js --location LT4ZHFBQQYB2N
 *   node scripts/extract-customers-from-square.js --location LT4ZHFBQQYB2N --backfill
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const SquareBookingsBackfill = require('../lib/square-bookings-backfill')

const prisma = new PrismaClient()

// Parse args
const locationId = process.argv.find(arg => arg.startsWith('--location') || arg.startsWith('-l'))?.split('=')[1] || 
                   process.argv[process.argv.indexOf('--location') + 1] ||
                   process.argv[process.argv.indexOf('-l') + 1] ||
                   null

const shouldBackfill = process.argv.includes('--backfill') || process.argv.includes('-b')

async function main() {
  // Initialize Square
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

  const bookingsApi = square.bookingsApi

  console.log(`🔍 Extracting customers from Square bookings\n`)
  if (locationId) {
    console.log(`📍 Location: ${locationId}\n`)
  } else {
    console.log(`📍 All locations\n`)
  }

  // Fetch bookings to extract customer IDs
  const customerIds = new Set()
  let cursor = null
  let page = 0
  let totalBookings = 0

  console.log(`📡 Fetching bookings from Square...\n`)

  do {
    page++
    try {
      const response = await bookingsApi.listBookings(
        100,
        cursor || undefined,
        undefined, // customerId
        undefined, // teamMemberId
        locationId || undefined,
        undefined, // startAtMin
        undefined  // startAtMax
      )

      const result = response.result || {}
      const bookings = result.bookings || []
      cursor = result.cursor || null

      bookings.forEach(booking => {
        if (booking.customerId) {
          customerIds.add(booking.customerId)
        }
        totalBookings++
      })

      if (bookings.length > 0) {
        console.log(`   Page ${page}: ${bookings.length} bookings, ${customerIds.size} unique customers`)
      }
    } catch (error) {
      console.error(`   ❌ Error on page ${page}:`, error.message)
      if (error.statusCode === 400 && error.errors) {
        const dateError = error.errors.find(e => e.detail && e.detail.includes('31 days'))
        if (dateError) {
          console.log(`   ⚠️  Date range limitation - Square API requires date filters`)
          console.log(`   💡 Try using the location-based backfill instead`)
          break
        }
      }
      break
    }

    if (cursor) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } while (cursor)

  console.log(`\n✅ Extraction complete!`)
  console.log(`   Total bookings processed: ${totalBookings}`)
  console.log(`   Unique customers found: ${customerIds.size}\n`)

  if (customerIds.size === 0) {
    console.log(`⚠️  No customers found`)
    await prisma.$disconnect()
    return
  }

  // Display customers
  console.log(`📋 Customers found:\n`)
  const customerArray = Array.from(customerIds)
  customerArray.forEach((customerId, idx) => {
    console.log(`   ${idx + 1}. ${customerId}`)
  })

  // Optionally backfill bookings for each customer
  if (shouldBackfill) {
    console.log(`\n🚀 Starting backfill for ${customerIds.size} customers...\n`)

    const backfill = new SquareBookingsBackfill(prisma, square, locationId || 'ALL', {
      limit: 100,
      maxRetries: 3
    })

    let processed = 0
    let totalUpserted = 0

    for (const customerId of customerArray) {
      processed++
      console.log(`\n${processed}/${customerIds.size} 👤 Customer: ${customerId}`)

      try {
        // Fetch bookings for this customer
        let customerCursor = null
        let customerBookings = []
        let customerPage = 0

        do {
          customerPage++
          const response = await bookingsApi.listBookings(
            100,
            customerCursor || undefined,
            customerId,
            undefined,
            locationId || undefined
          )

          const result = response.result || {}
          const bookings = result.bookings || []
          customerBookings.push(...bookings)
          customerCursor = result.cursor || null

          if (bookings.length > 0) {
            console.log(`   Page ${customerPage}: ${bookings.length} bookings`)
          }
        } while (customerCursor)

        if (customerBookings.length === 0) {
          console.log(`   ⚪ No bookings found`)
          continue
        }

        console.log(`   ✅ Found ${customerBookings.length} booking(s)`)

        // Upsert bookings
        let upserted = 0
        for (const booking of customerBookings) {
          const success = await backfill.upsertBooking(booking)
          if (success) upserted++
        }

        console.log(`   💾 Upserted ${upserted}/${customerBookings.length}`)
        totalUpserted += upserted

      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`)
      }

      await new Promise(resolve => setTimeout(resolve, 200))
    }

    console.log(`\n✅ Backfill complete!`)
    console.log(`   Customers processed: ${processed}`)
    console.log(`   Total bookings upserted: ${totalUpserted}`)
  } else {
    console.log(`\n💡 To backfill bookings for these customers, run:`)
    console.log(`   node scripts/extract-customers-from-square.js --location ${locationId || 'ALL'} --backfill`)
  }
}

main()
  .catch((err) => {
    console.error('\n❌ Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })




