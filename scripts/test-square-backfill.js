#!/usr/bin/env node
/**
 * Test script for Square Bookings Backfill
 * Tests the backfill with a small sample to verify it works
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const SquareBookingsBackfill = require('../lib/square-bookings-backfill')

const prisma = new PrismaClient()

async function main() {
  const locationId = process.argv[2] || 'LT4ZHFBQQYB2N' // Union St default
  
  console.log('🧪 Testing Square Bookings Backfill\n')
  
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

  // Test if searchBookings method exists
  console.log('1️⃣ Checking Square SDK methods...')
  if (typeof square.bookingsApi.searchBookings === 'function') {
    console.log('   ✅ searchBookings method available')
  } else {
    console.log('   ⚠️  searchBookings not available, will use listBookings')
  }
  
  // Initialize backfill
  const backfill = new SquareBookingsBackfill(prisma, square, locationId, {
    limit: 10 // Small limit for testing
  })

  // Test fetching a single page
  console.log('\n2️⃣ Testing fetchBookingsPage...')
  try {
    const page = await backfill.fetchBookingsPage(null, null)
    console.log(`   ✅ Successfully fetched page`)
    console.log(`   Bookings: ${page.bookings.length}`)
    console.log(`   Cursor: ${page.cursor ? page.cursor.substring(0, 20) + '...' : 'null'}`)
    console.log(`   Errors: ${page.errors.length}`)
    
    if (page.bookings.length > 0) {
      const sample = page.bookings[0]
      console.log(`\n   Sample booking:`)
      console.log(`   - ID: ${sample.id}`)
      console.log(`   - Start: ${sample.startAt}`)
      console.log(`   - Status: ${sample.status}`)
      console.log(`   - Version: ${sample.version}`)
    }
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`)
    process.exit(1)
  }

  // Test upserting a booking (if we have one)
  console.log('\n3️⃣ Testing upsertBooking...')
  try {
    const page = await backfill.fetchBookingsPage(null, null)
    if (page.bookings.length > 0) {
      const success = await backfill.upsertBooking(page.bookings[0])
      if (success) {
        console.log(`   ✅ Successfully upserted booking ${page.bookings[0].id}`)
        
        // Verify it's in database
        const dbBooking = await prisma.booking.findUnique({
          where: { id: page.bookings[0].id }
        })
        if (dbBooking) {
          console.log(`   ✅ Verified in database`)
        } else {
          console.log(`   ⚠️  Not found in database`)
        }
      } else {
        console.log(`   ⚠️  Upsert returned false`)
      }
    } else {
      console.log(`   ⚠️  No bookings to test upsert`)
    }
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`)
  }

  console.log('\n✅ Test completed!')
  console.log('\n💡 Next steps:')
  console.log('   Run full backfill: node scripts/square-bookings-backfill.js --location ' + locationId)
}

main()
  .catch((err) => {
    console.error('\n❌ Test failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })




