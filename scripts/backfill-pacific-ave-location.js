/**
 * Backfill Pacific Ave Location Data
 * 
 * This script does two things:
 * 1. Fixes existing bookings and payments that have incorrect or missing location_id values
 * 2. Reports missing records that need to be backfilled from Square API
 * 
 * Usage: 
 *   node scripts/backfill-pacific-ave-location.js [limit] [offset] [--check-missing]
 * 
 * Options:
 *   --check-missing: Only check for missing records, don't fix existing ones
 * 
 * To backfill missing records, use:
 *   node scripts/replay-square-events.js --begin 2026-01-02T00:00:00Z --types booking.created,payment.created,payment.updated
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const PACIFIC_AVE_SQUARE_LOCATION_ID = 'LNQKVBTQZN3EZ'
const ORGANIZATION_ID = 'd0e24178-2f94-4033-bc91-41f22df58278' // From your query
const START_DATE = '2026-01-02' // Start checking from this date

async function getPacificAveLocationUuid() {
  const result = await prisma.$queryRaw`
    SELECT id FROM locations 
    WHERE square_location_id = ${PACIFIC_AVE_SQUARE_LOCATION_ID}
      AND organization_id = ${ORGANIZATION_ID}::uuid
    LIMIT 1
  `
  
  if (!result || result.length === 0) {
    throw new Error(`Pacific Ave location not found (square_location_id: ${PACIFIC_AVE_SQUARE_LOCATION_ID})`)
  }
  
  return result[0].id
}

async function backfillBookings(pacificAveUuid, limit = 100, offset = 0) {
  console.log(`\n🔍 Finding bookings with Pacific Ave location_id in raw_json...`)
  
  // Find bookings that have Pacific Ave location_id in raw_json but wrong location_id in database
  const bookings = await prisma.$queryRaw`
    SELECT 
      b.id,
      b.booking_id,
      b.start_at,
      b.location_id as current_location_id,
      b.raw_json->>'locationId' as square_location_id,
      l.name as current_location_name
    FROM bookings b
    LEFT JOIN locations l ON b.location_id = l.id
    WHERE b.start_at >= ${START_DATE}::date
      AND b.organization_id = ${ORGANIZATION_ID}::uuid
      AND b.raw_json->>'locationId' = ${PACIFIC_AVE_SQUARE_LOCATION_ID}
      AND (b.location_id IS NULL OR b.location_id != ${pacificAveUuid}::uuid)
    ORDER BY b.start_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `
  
  if (bookings.length === 0) {
    console.log('   ✅ No bookings need fixing')
    return { updated: 0, skipped: 0, failed: 0 }
  }
  
  console.log(`   📊 Found ${bookings.length} bookings to fix`)
  
  let updated = 0
  let skipped = 0
  let failed = 0
  
  for (const booking of bookings) {
    try {
      const result = await prisma.$executeRaw`
        UPDATE bookings
        SET 
          location_id = ${pacificAveUuid}::uuid,
          updated_at = NOW()
        WHERE id = ${booking.id}::uuid
      `
      
      if (result > 0) {
        console.log(`   ✅ Fixed booking ${booking.booking_id} (${booking.start_at})`)
        updated++
      } else {
        console.log(`   ⏭️  Skipped booking ${booking.booking_id} (already updated?)`)
        skipped++
      }
    } catch (error) {
      console.error(`   ❌ Failed to fix booking ${booking.booking_id}: ${error.message}`)
      failed++
    }
  }
  
  return { updated, skipped, failed }
}

async function backfillPayments(pacificAveUuid, limit = 100, offset = 0) {
  console.log(`\n🔍 Finding payments that should be Pacific Ave...`)
  
  // Strategy 1: Find payments linked to bookings that are Pacific Ave
  const paymentsFromBookings = await prisma.$queryRaw`
    SELECT DISTINCT
      p.id,
      p.created_at,
      p.location_id as current_location_id,
      l.name as current_location_name,
      b.booking_id
    FROM payments p
    INNER JOIN bookings b ON p.booking_id = b.id
    LEFT JOIN locations l ON p.location_id = l.id
    WHERE p.created_at >= ${START_DATE}::date
      AND p.organization_id = ${ORGANIZATION_ID}::uuid
      AND b.location_id = ${pacificAveUuid}::uuid
      AND (p.location_id IS NULL OR p.location_id != ${pacificAveUuid}::uuid)
    ORDER BY p.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `
  
  // Strategy 2: Find payments with Pacific Ave locationId through orders
  // Only if p.order_id exists and is a valid UUID (some payments may have NULL or Square order IDs)
  let paymentsFromRawData = []
  try {
    paymentsFromRawData = await prisma.$queryRaw`
      SELECT DISTINCT
        p.id,
        p.created_at,
        p.location_id as current_location_id,
        l.name as current_location_name,
        p.order_id
      FROM payments p
      LEFT JOIN locations l ON p.location_id = l.id
      INNER JOIN orders o ON p.order_id = o.id
      INNER JOIN locations ol ON o.location_id = ol.id
      WHERE p.created_at >= ${START_DATE}::date
        AND p.organization_id = ${ORGANIZATION_ID}::uuid
        AND p.order_id IS NOT NULL
        AND ol.square_location_id = ${PACIFIC_AVE_SQUARE_LOCATION_ID}
        AND (p.location_id IS NULL OR p.location_id != ${pacificAveUuid}::uuid)
      ORDER BY p.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `
  } catch (error) {
    // If Strategy 2 fails (e.g., due to data type issues), just skip it
    console.warn(`   ⚠️  Strategy 2 (payments via orders) skipped: ${error.message}`)
  }
  
  // Combine and deduplicate by payment id
  const allPayments = [...paymentsFromBookings, ...paymentsFromRawData]
  const uniquePayments = allPayments.filter((p, index, self) => 
    index === self.findIndex((p2) => p2.id === p.id)
  )
  
  if (uniquePayments.length === 0) {
    console.log('   ✅ No payments need fixing (or no payments linked to Pacific Ave)')
    return { updated: 0, skipped: 0, failed: 0 }
  }
  
  console.log(`   📊 Found ${uniquePayments.length} payments to fix`)
  
  let updated = 0
  let skipped = 0
  let failed = 0
  
  for (const payment of uniquePayments) {
    try {
      const result = await prisma.$executeRaw`
        UPDATE payments
        SET 
          location_id = ${pacificAveUuid}::uuid,
          updated_at = NOW()
        WHERE id = ${payment.id}
      `
      
      if (result > 0) {
        console.log(`   ✅ Fixed payment ${payment.id} (${payment.created_at})`)
        updated++
      } else {
        console.log(`   ⏭️  Skipped payment ${payment.id} (already updated?)`)
        skipped++
      }
    } catch (error) {
      console.error(`   ❌ Failed to fix payment ${payment.id}: ${error.message}`)
      failed++
    }
  }
  
  return { updated, skipped, failed }
}

async function checkMissingRecords(pacificAveUuid) {
  console.log(`\n🔍 Checking for missing Pacific Ave records in database...`)
  
  // Count bookings in DB for Pacific Ave
  const dbBookings = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM bookings
    WHERE start_at >= ${START_DATE}::date
      AND organization_id = ${ORGANIZATION_ID}::uuid
      AND location_id = ${pacificAveUuid}::uuid
  `
  
  const dbBookingsCount = parseInt(dbBookings[0].count) || 0
  
  // Count payments in DB for Pacific Ave
  const dbPayments = await prisma.$queryRaw`
    SELECT COUNT(*) as count, COALESCE(SUM(total_money_amount), 0) as total_revenue
    FROM payments
    WHERE created_at >= ${START_DATE}::date
      AND organization_id = ${ORGANIZATION_ID}::uuid
      AND location_id = ${pacificAveUuid}::uuid
  `
  
  const dbPaymentsCount = parseInt(dbPayments[0].count) || 0
  const dbRevenue = parseInt(dbPayments[0].total_revenue) || 0
  
  console.log(`\n📊 Current Database Status (since ${START_DATE}):`)
  console.log(`   Bookings: ${dbBookingsCount}`)
  console.log(`   Payments: ${dbPaymentsCount}`)
  console.log(`   Revenue: $${(dbRevenue / 100).toFixed(2)}`)
  
  if (dbBookingsCount === 0 && dbPaymentsCount === 0) {
    console.log(`\n⚠️  WARNING: No Pacific Ave data found in database since ${START_DATE}!`)
    console.log(`\n   This suggests records were never synced from Square.`)
    console.log(`\n   To backfill missing data, run:`)
    console.log(`   node scripts/replay-square-events.js --begin ${START_DATE}T00:00:00Z --types booking.created,payment.created,payment.updated`)
    console.log(`\n   Or use the Square API directly to fetch and insert records.`)
  } else if (dbBookingsCount < 10 || dbPaymentsCount < 10) {
    console.log(`\n⚠️  WARNING: Very few Pacific Ave records found - data may be incomplete.`)
    console.log(`   Consider checking Square API directly to verify expected counts.`)
  }
  
  // Check for bookings with NULL location_id that might be Pacific Ave
  const bookingsWithNullLocation = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM bookings
    WHERE start_at >= ${START_DATE}::date
      AND organization_id = ${ORGANIZATION_ID}::uuid
      AND location_id IS NULL
  `
  
  const nullLocationCount = parseInt(bookingsWithNullLocation[0].count) || 0
  if (nullLocationCount > 0) {
    console.log(`\n⚠️  Found ${nullLocationCount} bookings with NULL location_id - these may be missing Pacific Ave data`)
  }
  
  // Check for payments with NULL location_id
  const paymentsWithNullLocation = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM payments
    WHERE created_at >= ${START_DATE}::date
      AND organization_id = ${ORGANIZATION_ID}::uuid
      AND location_id IS NULL
  `
  
  const nullPaymentLocationCount = parseInt(paymentsWithNullLocation[0].count) || 0
  if (nullPaymentLocationCount > 0) {
    console.log(`\n⚠️  Found ${nullPaymentLocationCount} payments with NULL location_id - these may be missing Pacific Ave data`)
  }
  
  return {
    bookings: dbBookingsCount,
    payments: dbPaymentsCount,
    revenue: dbRevenue,
    nullLocationBookings: nullLocationCount,
    nullLocationPayments: nullPaymentLocationCount
  }
}

async function main() {
  const args = process.argv.slice(2)
  const checkMissingOnly = args.includes('--check-missing')
  const limit = checkMissingOnly ? 1000 : parseInt(args.find(a => !a.startsWith('--')) || '100', 10)
  const offset = checkMissingOnly ? 0 : parseInt(args.find((a, i) => i > 0 && !a.startsWith('--') && !isNaN(a)) || '0', 10)
  
  console.log('='.repeat(80))
  console.log('🔧 Pacific Ave Location Data Backfill')
  console.log('='.repeat(80))
  
  if (checkMissingOnly) {
    console.log(`\n📊 Mode: Checking for missing records only`)
  } else {
    console.log(`\nProcessing up to ${limit} records (offset: ${offset})`)
  }
  
  try {
    // Get Pacific Ave location UUID
    const pacificAveUuid = await getPacificAveLocationUuid()
    console.log(`\n✅ Pacific Ave location UUID: ${pacificAveUuid}`)
    console.log(`   Square Location ID: ${PACIFIC_AVE_SQUARE_LOCATION_ID}`)
    
    // Always check for missing records first
    const missingCheck = await checkMissingRecords(pacificAveUuid)
    
    if (checkMissingOnly) {
      console.log(`\n✅ Check complete. Use replay-square-events.js to backfill missing data.`)
      return
    }
    
    // Backfill bookings
    const bookingResults = await backfillBookings(pacificAveUuid, limit, offset)
    
    // Backfill payments
    const paymentResults = await backfillPayments(pacificAveUuid, limit, offset)
    
    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('📊 SUMMARY')
    console.log('='.repeat(80))
    console.log('\nBookings:')
    console.log(`   ✅ Updated: ${bookingResults.updated}`)
    console.log(`   ⏭️  Skipped: ${bookingResults.skipped}`)
    console.log(`   ❌ Failed: ${bookingResults.failed}`)
    console.log('\nPayments:')
    console.log(`   ✅ Updated: ${paymentResults.updated}`)
    console.log(`   ⏭️  Skipped: ${paymentResults.skipped}`)
    console.log(`   ❌ Failed: ${paymentResults.failed}`)
    
    const totalUpdated = bookingResults.updated + paymentResults.updated
    const totalFailed = bookingResults.failed + paymentResults.failed
    
    if (totalUpdated > 0) {
      console.log(`\n✅ Successfully fixed ${totalUpdated} records!`)
    } else {
      console.log(`\nℹ️  No records needed fixing`)
    }
    
    if (totalFailed > 0) {
      console.log(`\n⚠️  ${totalFailed} records failed to update`)
    }
    
    // Show final status
    if (totalUpdated === 0 && (missingCheck.bookings === 0 || missingCheck.payments === 0)) {
      console.log(`\n💡 Tip: If data is still missing, the records may not exist in the database at all.`)
      console.log(`   Run with --check-missing flag to see detailed analysis.`)
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

