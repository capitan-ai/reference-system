#!/usr/bin/env node
/**
 * Run consistency tests for analytics data
 * Tests data integrity after refresh operations
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function runConsistencyTests() {
  console.log('🔍 Running analytics consistency tests...\n')
  console.log('='.repeat(80))

  try {
    // Test 1: Check first_booking_at and last_booking_at
    console.log('\n1. Testing first_booking_at and last_booking_at consistency...')
    const bookingTest = await prisma.$queryRaw`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (
          WHERE first_booking_at IS NOT NULL
          AND last_booking_at IS NOT NULL
          AND first_booking_at > last_booking_at
        ) as booking_order_errors
      FROM customer_analytics
      WHERE first_visit_at IS NOT NULL
    `

    const bookingResults = bookingTest[0]
    console.log(`   Total records: ${bookingResults.total}`)
    console.log(`   Booking order errors: ${bookingResults.booking_order_errors}`)

    if (bookingResults.booking_order_errors > 0) {
      console.log('   ⚠️  WARNING: Found data consistency issues!')
    } else {
      console.log('   ✅ All booking date checks passed')
    }

    // Test 2: Check new_customers in VIEW
    console.log('\n2. Testing new_customers calculation in VIEW...')
    const viewTest = await prisma.$queryRaw`
      WITH manual_count AS (
        SELECT 
          b.organization_id,
          b.location_id,
          DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') as date,
          COUNT(DISTINCT ca.square_customer_id) as manual_new
        FROM bookings b
        JOIN customer_analytics ca ON b.customer_id = ca.square_customer_id
          AND b.organization_id = ca.organization_id
        WHERE b.status = 'ACCEPTED'
          AND DATE(ca.first_booking_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') = 
              DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
        GROUP BY b.organization_id, b.location_id, DATE(b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
      )
      SELECT 
        COUNT(*) as total_dates,
        COUNT(*) FILTER (WHERE v.new_customers != COALESCE(m.manual_new, 0)) as mismatches,
        SUM(ABS(v.new_customers - COALESCE(m.manual_new, 0))) as total_diff
      FROM analytics_appointments_by_location_daily v
      LEFT JOIN manual_count m 
        ON v.organization_id = m.organization_id
        AND v.location_id = m.location_id
        AND v.date = m.date
    `

    const viewResults = viewTest[0]
    console.log(`   Total date/location combinations: ${viewResults.total_dates}`)
    console.log(`   Mismatches: ${viewResults.mismatches}`)
    console.log(`   Total difference: ${viewResults.total_diff}`)
    
    if (viewResults.mismatches > 0) {
      console.log('   ⚠️  WARNING: VIEW new_customers calculation may be incorrect!')
    } else {
      console.log('   ✅ VIEW new_customers calculation is correct')
    }

    // Test 3: Check admin analytics consistency
    console.log('\n3. Testing admin analytics consistency...')
    const adminTest = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE bookings_created_count > appointments_total) as invalid_counts
      FROM admin_analytics_daily
    `

    const adminResults = adminTest[0]
    console.log(`   Total records: ${adminResults.total_records}`)
    console.log(`   Invalid counts (bookings_created > appointments_total): ${adminResults.invalid_counts}`)
    
    if (adminResults.invalid_counts > 0) {
      console.log('   ⚠️  WARNING: Found invalid admin analytics records!')
    } else {
      console.log('   ✅ All admin analytics checks passed')
    }

    // Test 4: Check total_accepted_bookings vs booking_visits
    console.log('\n4. Testing total_accepted_bookings vs booking_visits...')
    const bookingsTest = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE total_accepted_bookings != booking_visits) as mismatches
      FROM customer_analytics
      WHERE total_accepted_bookings > 0 OR booking_visits > 0
    `

    const bookingsResults = bookingsTest[0]
    console.log(`   Total records with bookings: ${bookingsResults.total}`)
    console.log(`   Mismatches: ${bookingsResults.mismatches}`)
    
    if (bookingsResults.mismatches > 0) {
      console.log('   ⚠️  WARNING: total_accepted_bookings != booking_visits!')
    } else {
      console.log('   ✅ total_accepted_bookings matches booking_visits')
    }

    // Test 5: Check total_visits >= booking_visits
    console.log('\n5. Testing total_visits >= booking_visits...')
    const visitsTest = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE total_visits < booking_visits) as errors
      FROM customer_analytics
      WHERE total_visits IS NOT NULL AND booking_visits IS NOT NULL
    `

    const visitsResults = visitsTest[0]
    console.log(`   Total records: ${visitsResults.total}`)
    console.log(`   Errors (total_visits < booking_visits): ${visitsResults.errors}`)
    
    if (visitsResults.errors > 0) {
      console.log('   ⚠️  WARNING: Found records where total_visits < booking_visits!')
    } else {
      console.log('   ✅ All visits counts are valid')
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    const totalErrors = 
      Number(bookingResults.booking_order_errors || 0) +
      Number(viewResults.mismatches || 0) +
      Number(adminResults.invalid_counts || 0) +
      Number(bookingsResults.mismatches || 0) +
      Number(visitsResults.errors || 0)

    if (totalErrors === 0) {
      console.log('✅ All consistency tests passed!')
    } else {
      console.log(`⚠️  Found ${totalErrors} total issues across all tests`)
    }
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error running consistency tests:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runConsistencyTests()

