#!/usr/bin/env node
/**
 * Test script to verify booking upsert works for Union St location.
 * Tests with a small date range (e.g., one week) to verify the approach.
 *
 * Usage:
 *   node scripts/test-union-st-bookings.js
 *
 * Environment:
 *   SQUARE_ACCESS_TOKEN (or SQUARE_ACCESS_TOKEN_2)
 *   SQUARE_ENV (production|sandbox) optional, defaults to production
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const UNION_ST_LOCATION_ID = 'LT4ZHFBQQYB2N'
const UNION_ST_NAME = 'Union St'

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN_2 || process.env.SQUARE_ACCESS_TOKEN
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN(_2)')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const bookingsApi = square.bookingsApi

// Test with a small date range: one month in 2022 (try different months if needed)
const TEST_START_DATE = new Date('2022-06-01T00:00:00Z')
const TEST_END_DATE = new Date('2022-06-30T23:59:59Z')

function fmt(d) {
  return d.toISOString()
}

function getDate(value) {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

async function ensureLocationExists() {
  // Ensure Union St location exists in database
  const location = await prisma.location.findUnique({
    where: { square_location_id: UNION_ST_LOCATION_ID }
  })
  
  if (!location) {
    console.log(`⚠️  Location ${UNION_ST_NAME} not found in database. Creating...`)
    await prisma.location.upsert({
      where: { square_location_id: UNION_ST_LOCATION_ID },
      update: {},
      create: {
        square_location_id: UNION_ST_LOCATION_ID,
        name: UNION_ST_NAME,
        address_line_1: '3089 Union St',
        locality: 'San Francisco',
        administrative_district_level_1: 'CA',
        postal_code: '94123'
      }
    })
    console.log(`✅ Location ${UNION_ST_NAME} created/updated in database`)
  } else {
    console.log(`✅ Location ${UNION_ST_NAME} exists in database`)
  }
}

async function testFetchBookings() {
  console.log(`\n🧪 Testing booking fetch for ${UNION_ST_NAME}`)
  console.log(`   Date range: ${fmt(TEST_START_DATE)} to ${fmt(TEST_END_DATE)}`)
  
  try {
    const resp = await bookingsApi.listBookings(
      10, // limit to 10 for testing
      undefined, // cursor
      undefined, // customerId
      undefined, // teamMemberId
      UNION_ST_LOCATION_ID,
      fmt(TEST_START_DATE),
      fmt(TEST_END_DATE)
    )

    const bookings = resp.result?.bookings || []
    console.log(`   ✅ Successfully fetched ${bookings.length} bookings`)
    
    if (bookings.length > 0) {
      console.log(`   📋 Sample booking:`)
      const sample = bookings[0]
      console.log(`      - ID: ${sample.id}`)
      console.log(`      - Start: ${sample.startAt}`)
      console.log(`      - Status: ${sample.status}`)
      console.log(`      - Location: ${sample.locationId}`)
      console.log(`      - Segments: ${(sample.appointmentSegments || []).length}`)
    }
    
    return bookings
  } catch (error) {
    console.error(`   ❌ Error fetching bookings:`, error.message)
    throw error
  }
}

async function testUpsertBooking(booking) {
  const id = booking.id
  if (!id) {
    console.log(`   ⚠️  Booking missing ID, skipping`)
    return false
  }

  const createdAt = getDate(booking.createdAt) || new Date()
  const updatedAt = getDate(booking.updatedAt) || createdAt

  try {
    // Upsert booking
    await prisma.booking.upsert({
      where: { id },
      update: {
        merchant_id: booking.merchantId || null,
        customer_id: booking.customerId || null,
        location_id: booking.locationId || UNION_ST_LOCATION_ID, // Ensure location_id is set
        location_type: booking.locationType || null,
        source: booking.source || null,
        start_at: getDate(booking.startAt),
        status: booking.status || null,
        version: booking.version ?? 0,
        all_day: booking.allDay ?? false,
        transition_time_minutes: booking.transitionTimeMinutes ?? 0,
        creator_type: booking.creatorDetails?.creatorType || null,
        creator_customer_id: booking.creatorDetails?.customerId || null,
        creator_team_member_id: booking.creatorDetails?.teamMemberId || null,
        address_line_1: booking.address?.addressLine1 || null,
        address_line_2: booking.address?.addressLine2 || null,
        address_line_3: booking.address?.addressLine3 || null,
        locality: booking.address?.locality || null,
        sublocality: booking.address?.sublocality || null,
        sublocality_2: booking.address?.sublocality2 || null,
        sublocality_3: booking.address?.sublocality3 || null,
        administrative_district_level_1:
          booking.address?.administrativeDistrictLevel1 || null,
        administrative_district_level_2:
          booking.address?.administrativeDistrictLevel2 || null,
        administrative_district_level_3:
          booking.address?.administrativeDistrictLevel3 || null,
        postal_code: booking.address?.postalCode || null,
        country: booking.address?.country || null,
        created_at: createdAt,
        updated_at: updatedAt
      },
      create: {
        id,
        merchant_id: booking.merchantId || null,
        customer_id: booking.customerId || null,
        location_id: booking.locationId || UNION_ST_LOCATION_ID, // Ensure location_id is set
        location_type: booking.locationType || null,
        source: booking.source || null,
        start_at: getDate(booking.startAt),
        status: booking.status || null,
        version: booking.version ?? 0,
        all_day: booking.allDay ?? false,
        transition_time_minutes: booking.transitionTimeMinutes ?? 0,
        creator_type: booking.creatorDetails?.creatorType || null,
        creator_customer_id: booking.creatorDetails?.customerId || null,
        creator_team_member_id: booking.creatorDetails?.teamMemberId || null,
        address_line_1: booking.address?.addressLine1 || null,
        address_line_2: booking.address?.addressLine2 || null,
        address_line_3: booking.address?.addressLine3 || null,
        locality: booking.address?.locality || null,
        sublocality: booking.address?.sublocality || null,
        sublocality_2: booking.address?.sublocality2 || null,
        sublocality_3: booking.address?.sublocality3 || null,
        administrative_district_level_1:
          booking.address?.administrativeDistrictLevel1 || null,
        administrative_district_level_2:
          booking.address?.administrativeDistrictLevel2 || null,
        administrative_district_level_3:
          booking.address?.administrativeDistrictLevel3 || null,
        postal_code: booking.address?.postalCode || null,
        country: booking.address?.country || null,
        created_at: createdAt,
        updated_at: updatedAt
      }
    })

    // Upsert segments
    const segments = booking.appointmentSegments || []
    await prisma.bookingAppointmentSegment.deleteMany({ where: { booking_id: id } })
    if (segments.length) {
      await prisma.bookingAppointmentSegment.createMany({
        data: segments.map((s) => ({
          booking_id: id,
          duration_minutes: s.durationMinutes ?? 0,
          intermission_minutes: s.intermissionMinutes ?? 0,
          service_variation_id: s.serviceVariationId || 'unknown',
          service_variation_client_id: s.serviceVariationClientId || null,
          service_variation_version: s.serviceVariationVersion
            ? BigInt(s.serviceVariationVersion)
            : null,
          team_member_id: s.teamMemberId || null,
          any_team_member: s.anyTeamMember ?? false
        }))
      })
    }
    
    return true
  } catch (error) {
    console.error(`   ❌ Error upserting booking ${id}:`, error.message)
    throw error
  }
}

async function main() {
  console.log(
    `🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`
  )
  
  try {
    // Step 1: Ensure location exists
    await ensureLocationExists()
    
    // Step 2: Test fetching bookings
    const bookings = await testFetchBookings()
    
    // Step 3: Test upserting bookings
    if (bookings.length > 0) {
      console.log(`\n💾 Testing upsert for ${bookings.length} bookings...`)
      let successCount = 0
      for (const booking of bookings) {
        const success = await testUpsertBooking(booking)
        if (success) successCount++
      }
      console.log(`   ✅ Successfully upserted ${successCount}/${bookings.length} bookings`)
      
      // Verify in database
      const dbCount = await prisma.booking.count({
        where: {
          location_id: UNION_ST_LOCATION_ID,
          start_at: {
            gte: TEST_START_DATE,
            lte: TEST_END_DATE
          }
        }
      })
      console.log(`   📊 Verified: ${dbCount} bookings in database for this date range`)
    } else {
      console.log(`   ℹ️  No bookings found in test date range`)
    }
    
    console.log(`\n✅ Test completed successfully!`)
    console.log(`\n💡 Next steps:`)
    console.log(`   1. Review the results above`)
    console.log(`   2. If successful, run: node scripts/backfill-union-st-2022.js`)
    
  } catch (error) {
    console.error('\n❌ Test failed:', error)
    throw error
  }
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

