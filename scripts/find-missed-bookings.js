#!/usr/bin/env node
require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function findMissedBookings() {
  console.log('🔍 Finding Missed Bookings\n')
  console.log('=' .repeat(60))
  
  try {
    // 1. Find booking.created webhooks that completed but booking not in DB
    console.log('\n1️⃣ Checking booking.created webhooks...\n')
    
    const bookingCreatedRuns = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        trigger_type,
        resource_id,
        status,
        context,
        created_at,
        updated_at
      FROM giftcard_runs
      WHERE trigger_type = 'booking.created'
        AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 50
    `
    
    console.log(`   Found ${bookingCreatedRuns.length} completed booking.created webhooks`)
    
    const missedBookings = []
    
    for (const run of bookingCreatedRuns) {
      const bookingId = run.resource_id || run.context?.bookingId || run.context?.booking_id
      const customerId = run.context?.customerId || run.context?.customer_id
      
      if (!bookingId) {
        continue
      }
      
      // Check if booking exists in database
      // Try both base ID and segmented IDs
      const existingBooking = await prisma.$queryRaw`
        SELECT id, booking_id, organization_id, customer_id
        FROM bookings
        WHERE booking_id = ${bookingId}
           OR booking_id LIKE ${`${bookingId}%`}
        LIMIT 1
      `
      
      if (!existingBooking || existingBooking.length === 0) {
        missedBookings.push({
          bookingId,
          customerId,
          correlationId: run.correlation_id,
          createdAt: run.created_at,
          context: run.context
        })
      }
    }
    
    console.log(`\n   ❌ Found ${missedBookings.length} missed bookings:\n`)
    
    if (missedBookings.length > 0) {
      missedBookings.forEach((booking, idx) => {
        console.log(`   ${idx + 1}. Booking ID: ${booking.bookingId}`)
        console.log(`      Customer ID: ${booking.customerId || 'missing'}`)
        console.log(`      Correlation ID: ${booking.correlationId}`)
        console.log(`      Created: ${booking.createdAt}`)
        console.log(`      Context: ${JSON.stringify(booking.context, null, 2).substring(0, 200)}...`)
        console.log('')
      })
    } else {
      console.log('   ✅ All booking.created webhooks have corresponding database entries!')
    }
    
    // 2. Check booking.updated webhooks that might have tried to create bookings
    console.log('\n2️⃣ Checking booking.updated webhooks...\n')
    
    const bookingUpdatedRuns = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        trigger_type,
        resource_id,
        status,
        context,
        created_at
      FROM giftcard_runs
      WHERE trigger_type = 'booking.updated'
        AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 50
    `
    
    console.log(`   Found ${bookingUpdatedRuns.length} completed booking.updated webhooks`)
    
    const updatedMissedBookings = []
    
    for (const run of bookingUpdatedRuns) {
      const bookingId = run.resource_id || run.context?.bookingId || run.context?.booking_id
      
      if (!bookingId) {
        continue
      }
      
      // Check if booking exists
      const existingBooking = await prisma.$queryRaw`
        SELECT id, booking_id
        FROM bookings
        WHERE booking_id = ${bookingId}
           OR booking_id LIKE ${`${bookingId}%`}
        LIMIT 1
      `
      
      if (!existingBooking || existingBooking.length === 0) {
        updatedMissedBookings.push({
          bookingId,
          correlationId: run.correlation_id,
          createdAt: run.created_at
        })
      }
    }
    
    if (updatedMissedBookings.length > 0) {
      console.log(`\n   ⚠️  Found ${updatedMissedBookings.length} booking.updated webhooks for missing bookings:\n`)
      updatedMissedBookings.forEach((booking, idx) => {
        console.log(`   ${idx + 1}. Booking ID: ${booking.bookingId}`)
        console.log(`      Correlation ID: ${booking.correlationId}`)
        console.log(`      Created: ${booking.createdAt}`)
        console.log('')
      })
    } else {
      console.log(`   ✅ All booking.updated webhooks have corresponding database entries!`)
    }
    
    // 3. Summary
    console.log('\n' + '=' .repeat(60))
    console.log('\n📊 Summary:\n')
    console.log(`   Total missed bookings: ${missedBookings.length + updatedMissedBookings.length}`)
    console.log(`   From booking.created: ${missedBookings.length}`)
    console.log(`   From booking.updated: ${updatedMissedBookings.length}`)
    
    if (missedBookings.length > 0 || updatedMissedBookings.length > 0) {
      console.log('\n💡 Next steps:')
      console.log('   1. Run: node scripts/backfill-missed-bookings.js')
      console.log('   2. This will fetch booking data from Square API')
      console.log('   3. Use new location_id resolution to save them')
    }
    
    // Return data for backfill script
    return {
      missedBookings,
      updatedMissedBookings
    }
    
  } catch (error) {
    console.error('\n❌ Error finding missed bookings:', error.message)
    console.error('Stack:', error.stack)
    return null
  } finally {
    await prisma.$disconnect()
  }
}

findMissedBookings()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

