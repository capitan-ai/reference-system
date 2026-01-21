#!/usr/bin/env node
/**
 * Backfill historical bookings from Square into the database.
 *
 * - Currently configured for Union St location (LT4ZHFBQQYB2N) for 2022
 * - Walks time windows backward from end of 2022 to start of 2022
 * - Uses listBookings with start_at_min/max to respect the 31-day window rule
 * - Upserts into bookings and booking_appointment_segments
 *
 * Usage:
 *   node scripts/backfill-bookings.js
 *
 * To test first:
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

// Only process Union St location for 2022 backfill
const LOCATIONS = [
  { id: 'LT4ZHFBQQYB2N', name: 'Union St' }
]

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

const WINDOW_DAYS = 30 // Square listBookings supports max 31-day window
const START_DATE = new Date('2022-01-01T00:00:00Z') // Start of 2022
const END_DATE = new Date('2022-12-31T23:59:59Z') // End of 2022

function fmt(d) {
  return d.toISOString()
}

function addDays(date, days) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

async function backfillLocation(locationId, locationName) {
  console.log(`\n📍 Location ${locationName} (${locationId})`)
  
  // Ensure location exists in database
  await prisma.location.upsert({
    where: { square_location_id: locationId },
    update: {},
    create: {
      square_location_id: locationId,
      name: locationName,
      address_line_1: locationName === 'Union St' ? '3089 Union St' : '550 Pacific Ave',
      locality: 'San Francisco',
      administrative_district_level_1: 'CA',
      postal_code: locationName === 'Union St' ? '94123' : '94133'
    }
  })
  
  let end = new Date(END_DATE) // End of 2022
  let start = addDays(end, -WINDOW_DAYS)
  if (start < START_DATE) start = new Date(START_DATE)

  let total = 0

  while (end >= START_DATE) {
    const startStr = fmt(start)
    const endStr = fmt(end)
    let cursor = null
    let page = 0
    let windowCount = 0

    do {
      page++
      // Signature: listBookings(limit?, cursor?, customerId?, teamMemberId?, locationId?, startAtMin?, startAtMax?)
      const resp = await bookingsApi.listBookings(
        100,
        cursor || undefined,
        undefined,
        undefined,
        locationId,
        startStr,
        endStr
      )

      const bookings = resp.result?.bookings || []
      cursor = resp.result?.cursor
      windowCount += bookings.length
      total += bookings.length

      if (bookings.length) {
        console.log(
          `  window ${startStr} - ${endStr} page ${page}: ${bookings.length} bookings`
        )
      }

      for (const b of bookings) {
        await upsertBooking(b, locationId)
      }
    } while (cursor)

    console.log(
      `  ✅ Window ${startStr} - ${endStr}: ${windowCount} bookings`
    )

    // Move window back
    end = addDays(start, -1)
    start = addDays(end, -WINDOW_DAYS)
    if (start < START_DATE) start = new Date(START_DATE)
  }

  console.log(`📊 Location ${locationName}: total upserted ${total}`)
}

function getDate(value) {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

async function upsertBooking(booking, locationId) {
  const id = booking.id
  if (!id) return

  const createdAt = getDate(booking.createdAt) || new Date()
  const updatedAt = getDate(booking.updatedAt) || createdAt

  // Ensure location_id is set (should always be present from API, but fallback for safety)
  const finalLocationId = booking.locationId || locationId

  // Upsert booking
  await prisma.booking.upsert({
    where: { id },
    update: {
      merchant_id: booking.merchantId || null,
      customer_id: booking.customerId || null,
      location_id: finalLocationId, // Ensure location_id is set
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
      location_id: finalLocationId, // Ensure location_id is set
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

  // Upsert segments: simple strategy—delete existing segments for this booking then recreate
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
}

async function main() {
  console.log(
    `🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`
  )
  console.log(`📅 Backfilling Union St bookings from ${fmt(START_DATE)} to ${fmt(END_DATE)}, window ${WINDOW_DAYS}d`)
  for (const loc of LOCATIONS) {
    await backfillLocation(loc.id, loc.name)
  }
  console.log(`\n✅ Backfill complete!`)
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

