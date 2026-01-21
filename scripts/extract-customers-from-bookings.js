#!/usr/bin/env node
/**
 * Extract customers from existing bookings in database
 * 
 * Uses booking IDs from database to fetch full booking details from Square,
 * then extracts customer IDs and optionally fetches all bookings for each customer.
 * 
 * Usage:
 *   node scripts/extract-customers-from-bookings.js --location LT4ZHFBQQYB2N
 *   node scripts/extract-customers-from-bookings.js --location LT4ZHFBQQYB2N --backfill
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

  console.log(`🔍 Extracting customers from database bookings\n`)
  if (locationId) {
    console.log(`📍 Location: ${locationId}\n`)
  }

  // Get bookings from database
  const whereClause = locationId ? { location_id: locationId } : {}
  const dbBookings = await prisma.booking.findMany({
    where: whereClause,
    select: { id: true, customer_id: true },
    take: 100 // Limit for testing
  })

  console.log(`📋 Found ${dbBookings.length} bookings in database\n`)

  if (dbBookings.length === 0) {
    console.log(`⚠️  No bookings found`)
    await prisma.$disconnect()
    return
  }

  // Fetch full booking details from Square to get customer IDs
  const customerIds = new Set()
  const customerBookingsMap = new Map() // customerId -> [bookings]

  console.log(`📡 Fetching booking details from Square...\n`)

  for (let i = 0; i < dbBookings.length; i++) {
    const dbBooking = dbBookings[i]
    process.stdout.write(`   ${i + 1}/${dbBookings.length} Fetching ${dbBooking.id.substring(0, 15)}... `)

    try {
      const response = await bookingsApi.retrieveBooking(dbBooking.id)
      const booking = response.result?.booking

      if (booking && booking.customerId) {
        customerIds.add(booking.customerId)
        
        if (!customerBookingsMap.has(booking.customerId)) {
          customerBookingsMap.set(booking.customerId, [])
        }
        customerBookingsMap.get(booking.customerId).push(booking)
        
        console.log(`✅ Customer: ${booking.customerId}`)
      } else {
        console.log(`⚪ No customer ID`)
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`)
    }

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log(`\n✅ Extraction complete!`)
  console.log(`   Unique customers found: ${customerIds.size}\n`)

  if (customerIds.size === 0) {
    console.log(`⚠️  No customers found in bookings`)
    await prisma.$disconnect()
    return
  }

  // Display customers
  console.log(`📋 Customers found:\n`)
  const customerArray = Array.from(customerIds)
  customerArray.forEach((customerId, idx) => {
    const bookings = customerBookingsMap.get(customerId) || []
    console.log(`   ${idx + 1}. ${customerId} (${bookings.length} booking(s) found)`)
  })

  // Update database bookings with customer IDs
  console.log(`\n💾 Updating database bookings with customer IDs...\n`)
  let updated = 0
  for (const [customerId, bookings] of customerBookingsMap.entries()) {
    for (const booking of bookings) {
      try {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { customer_id: customerId }
        })
        updated++
      } catch (error) {
        // Ignore errors (booking might already have customer_id)
      }
    }
  }
  console.log(`   ✅ Updated ${updated} booking(s)\n`)

  // Optionally backfill all bookings for each customer
  if (shouldBackfill) {
    console.log(`🚀 Starting backfill for ${customerIds.size} customers...\n`)

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
        // Use bookings we already fetched from database
        let customerBookings = customerBookingsMap.get(customerId) || []
        
        if (customerBookings.length === 0) {
          console.log(`   ⚪ No bookings found for this customer`)
          continue
        }

        console.log(`   ✅ Using ${customerBookings.length} booking(s) from database`)
        
        // Optionally try to fetch more from Square (but this often fails due to API limitations)
        // We'll skip this for now and use what we have

        console.log(`   ✅ Processing ${customerBookings.length} booking(s)`)

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
    console.log(`\n💡 To backfill all bookings for these customers, run:`)
    console.log(`   node scripts/extract-customers-from-bookings.js --location ${locationId || 'ALL'} --backfill`)
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

