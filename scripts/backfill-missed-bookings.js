#!/usr/bin/env node
/**
 * Backfill missed bookings by fetching from Square API
 * Uses new location_id resolution logic to save them
 * 
 * Usage:
 *   node scripts/backfill-missed-bookings.js [limit]
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

const envName = (process.env.SQUARE_ENV || 'production').toLowerCase()
const environment = envName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const bookingsApi = square.bookingsApi
const locationsApi = square.locationsApi

// Helper: Resolve team member UUID
async function resolveTeamMemberUuid(squareTeamMemberId, organizationId) {
  if (!squareTeamMemberId || !organizationId) return null
  try {
    const result = await prisma.$queryRaw`
      SELECT id FROM team_members
      WHERE square_team_member_id = ${squareTeamMemberId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    return result && result.length > 0 ? result[0].id : null
  } catch (error) {
    return null
  }
}

// Helper: Resolve service variation UUID
async function resolveServiceVariationUuid(squareServiceVariationId, organizationId) {
  if (!squareServiceVariationId || !organizationId) return null
  try {
    const result = await prisma.$queryRaw`
      SELECT id FROM service_variation
      WHERE square_variation_id = ${squareServiceVariationId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    return result && result.length > 0 ? result[0].id : null
  } catch (error) {
    return null
  }
}

// Import resolution functions (simplified versions)
async function resolveOrganizationIdFromLocationId(squareLocationId) {
  if (!squareLocationId) return null
  
  try {
    // Fast database lookup
    const location = await prisma.$queryRaw`
      SELECT organization_id, square_merchant_id
      FROM locations
      WHERE square_location_id = ${squareLocationId}
      LIMIT 1
    `
    
    if (location && location.length > 0) {
      const loc = location[0]
      
      if (loc.organization_id) {
        return loc.organization_id
      }
      
      if (loc.square_merchant_id) {
        const org = await prisma.$queryRaw`
          SELECT id FROM organizations 
          WHERE square_merchant_id = ${loc.square_merchant_id}
          LIMIT 1
        `
        if (org && org.length > 0) {
          return org[0].id
        }
      }
    }
    
    // Fetch from Square API
    console.log(`   📍 Fetching location ${squareLocationId} from Square API...`)
    const response = await locationsApi.retrieveLocation(squareLocationId)
    const locationData = response.result?.location
    
    if (!locationData) {
      return null
    }
    
    // Square API returns merchantId (camelCase), not merchant_id
    const merchantId = locationData.merchantId || locationData.merchant_id || null
    
    if (!merchantId) {
      return null
    }
    const org = await prisma.$queryRaw`
      SELECT id FROM organizations 
      WHERE square_merchant_id = ${merchantId}
      LIMIT 1
    `
    
    if (org && org.length > 0) {
      const orgId = org[0].id
      
      // Update location
      await prisma.$executeRaw`
        INSERT INTO locations (
          id, organization_id, square_location_id, square_merchant_id, name, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${orgId}::uuid, ${squareLocationId}, ${merchantId},
          ${locationData.name || `Location ${squareLocationId.substring(0, 8)}...`},
          NOW(), NOW()
        )
        ON CONFLICT (organization_id, square_location_id) DO UPDATE SET
          square_merchant_id = COALESCE(EXCLUDED.square_merchant_id, locations.square_merchant_id),
          organization_id = COALESCE(EXCLUDED.organization_id, locations.organization_id),
          updated_at = NOW()
      `
      
      return orgId
    }
    
    return null
  } catch (error) {
    console.error(`   ❌ Error resolving organization_id: ${error.message}`)
    return null
  }
}

async function saveBookingToDatabase(bookingData, segment, customerId, merchantId, organizationId) {
  // Resolve UUIDs before building query
  let administratorId = null
  let serviceVariationId = null
  let technicianId = null
  
  const creatorDetails = bookingData.creator_details || bookingData.creatorDetails || {}
  if (creatorDetails.team_member_id || creatorDetails.teamMemberId) {
    administratorId = await resolveTeamMemberUuid(
      creatorDetails.team_member_id || creatorDetails.teamMemberId,
      organizationId
    )
  }
  
  if (segment) {
    if (segment.service_variation_id || segment.serviceVariationId) {
      serviceVariationId = await resolveServiceVariationUuid(
        segment.service_variation_id || segment.serviceVariationId,
        organizationId
      )
    }
    if (segment.team_member_id || segment.teamMemberId) {
      technicianId = await resolveTeamMemberUuid(
        segment.team_member_id || segment.teamMemberId,
        organizationId
      )
    }
  }
  try {
    const baseBookingId = bookingData.id || bookingData.bookingId
    const bookingId = segment 
      ? `${baseBookingId}-${segment.service_variation_id || segment.serviceVariationId || 'unknown'}`
      : baseBookingId
    
    const address = bookingData.address || {}
    
    // Resolve location_id
    const squareLocationId = 
      bookingData.location_id || 
      bookingData.locationId || 
      bookingData.location?.id
    
    if (!squareLocationId) {
      console.error(`   ❌ Booking ${bookingId} missing location_id`)
      return false
    }
    
    // Resolve location UUID
    let locationUuid = null
    try {
      // Fetch location from Square API to get merchant_id
      const locationResponse = await locationsApi.retrieveLocation(squareLocationId)
      const location = locationResponse.result?.location
      // Square API returns merchantId (camelCase), not merchant_id
      const locationMerchantId = location?.merchantId || location?.merchant_id || null
      const locationName = location?.name || `Location ${squareLocationId.substring(0, 8)}...`
      
      // Ensure location exists
      await prisma.$executeRaw`
        INSERT INTO locations (
          id, organization_id, square_location_id, square_merchant_id, name, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${organizationId}::uuid, ${squareLocationId}, ${locationMerchantId},
          ${locationName}, NOW(), NOW()
        )
        ON CONFLICT (organization_id, square_location_id) DO UPDATE SET
          square_merchant_id = COALESCE(EXCLUDED.square_merchant_id, locations.square_merchant_id),
          name = COALESCE(EXCLUDED.name, locations.name),
          updated_at = NOW()
      `
      
      const locationRecord = await prisma.$queryRaw`
        SELECT id FROM locations 
        WHERE square_location_id = ${squareLocationId}
          AND organization_id = ${organizationId}::uuid
        LIMIT 1
      `
      locationUuid = locationRecord && locationRecord.length > 0 ? locationRecord[0].id : null
      
      if (!locationUuid) {
        console.error(`   ❌ Cannot save booking: location UUID not found`)
        return false
      }
    } catch (err) {
      console.error(`   ❌ Error resolving location: ${err.message}`)
      return false
    }
    
    // Save booking
    await prisma.$executeRaw`
      INSERT INTO bookings (
        id, organization_id, booking_id, version, customer_id, location_id, location_type, source,
        start_at, status, all_day, transition_time_minutes,
        creator_type, creator_customer_id, administrator_id,
        address_line_1, locality, administrative_district_level_1, postal_code,
        service_variation_id, service_variation_version, duration_minutes,
        intermission_minutes, technician_id, any_team_member,
        customer_note, seller_note,
        merchant_id, created_at, updated_at, raw_json
      ) VALUES (
        gen_random_uuid(),
        ${organizationId}::uuid,
        ${bookingId},
        ${bookingData.version || 0},
        ${customerId},
        ${locationUuid}::uuid,
        ${bookingData.location_type || bookingData.locationType || null},
        ${bookingData.source || null},
        ${bookingData.start_at || bookingData.startAt ? new Date(bookingData.start_at || bookingData.startAt) : new Date()}::timestamptz,
        ${bookingData.status || 'ACCEPTED'},
        ${bookingData.all_day || bookingData.allDay || false},
        ${bookingData.transition_time_minutes || bookingData.transitionTimeMinutes || 0},
        ${creatorDetails.creator_type || creatorDetails.creatorType || null},
        ${creatorDetails.customer_id || creatorDetails.customerId || null},
        ${administratorId}::uuid,
        ${address.address_line_1 || address.addressLine1 || null},
        ${address.locality || null},
        ${address.administrative_district_level_1 || address.administrativeDistrictLevel1 || null},
        ${address.postal_code || address.postalCode || null},
        ${serviceVariationId}::uuid,
        ${segment?.service_variation_version || segment?.serviceVariationVersion ? BigInt(segment.service_variation_version || segment.serviceVariationVersion) : null},
        ${segment?.duration_minutes || segment?.durationMinutes || null},
        ${segment?.intermission_minutes || segment?.intermissionMinutes || 0},
        ${technicianId}::uuid,
        ${segment?.any_team_member ?? segment?.anyTeamMember ?? false},
        ${bookingData.customer_note || bookingData.customerNote || null},
        ${bookingData.seller_note || bookingData.sellerNote || null},
        ${merchantId},
        ${bookingData.created_at || bookingData.createdAt ? new Date(bookingData.created_at || bookingData.createdAt) : new Date()}::timestamptz,
        ${bookingData.updated_at || bookingData.updatedAt ? new Date(bookingData.updatedAt || bookingData.updated_at) : new Date()}::timestamptz,
        ${JSON.stringify(bookingData, (key, value) => 
          typeof value === 'bigint' ? value.toString() : value
        )}::jsonb
      )
      ON CONFLICT (organization_id, booking_id) DO UPDATE SET
        version = EXCLUDED.version,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at,
        raw_json = EXCLUDED.raw_json
    `
    
    return true
  } catch (error) {
    console.error(`   ❌ Error saving booking: ${error.message}`)
    return false
  }
}

async function backfillMissedBookings() {
  const limit = parseInt(process.argv[2]) || 50
  
  console.log('🔄 Backfilling Missed Bookings\n')
  console.log('=' .repeat(60))
  
  try {
    // Find missed bookings
    const bookingCreatedRuns = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        resource_id,
        context,
        created_at
      FROM giftcard_runs
      WHERE trigger_type = 'booking.created'
        AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    
    const missedBookings = []
    
    for (const run of bookingCreatedRuns) {
      const bookingId = run.resource_id || run.context?.bookingId || run.context?.booking_id
      
      if (!bookingId) continue
      
      const existingBooking = await prisma.$queryRaw`
        SELECT id FROM bookings
        WHERE booking_id = ${bookingId} OR booking_id LIKE ${`${bookingId}%`}
        LIMIT 1
      `
      
      if (!existingBooking || existingBooking.length === 0) {
        missedBookings.push({
          bookingId,
          customerId: run.context?.customerId || run.context?.customer_id,
          correlationId: run.correlation_id
        })
      }
    }
    
    console.log(`\n📋 Found ${missedBookings.length} missed bookings to backfill\n`)
    
    if (missedBookings.length === 0) {
      console.log('✅ No missed bookings found!')
      return
    }
    
    let successCount = 0
    let errorCount = 0
    
    for (let i = 0; i < missedBookings.length; i++) {
      const { bookingId, customerId } = missedBookings[i]
      
      console.log(`\n${i + 1}/${missedBookings.length}. Processing booking: ${bookingId}`)
      
      try {
        // Fetch booking from Square API
        console.log(`   📡 Fetching from Square API...`)
        const response = await bookingsApi.retrieveBooking(bookingId)
        const bookingData = response.result?.booking
        
        if (!bookingData) {
          console.log(`   ❌ Booking not found in Square API`)
          errorCount++
          continue
        }
        
        console.log(`   ✅ Fetched booking data`)
        
        // Resolve organization_id from location_id
        const squareLocationId = bookingData.location_id || bookingData.locationId
        if (!squareLocationId) {
          console.log(`   ❌ Booking missing location_id`)
          errorCount++
          continue
        }
        
        console.log(`   📍 Resolving organization_id from location_id: ${squareLocationId}`)
        const organizationId = await resolveOrganizationIdFromLocationId(squareLocationId)
        
        if (!organizationId) {
          console.log(`   ❌ Could not resolve organization_id`)
          errorCount++
          continue
        }
        
        console.log(`   ✅ Resolved organization_id: ${organizationId}`)
        
        // Get merchant_id from location
        const merchantId = bookingData.merchant_id || null
        
        // Save booking
        const segments = bookingData.appointment_segments || bookingData.appointmentSegments || []
        
        if (segments.length === 0) {
          const saved = await saveBookingToDatabase(bookingData, null, customerId, merchantId, organizationId)
          if (saved) {
            console.log(`   ✅ Saved booking`)
            successCount++
          } else {
            errorCount++
          }
        } else {
          let allSaved = true
          for (const segment of segments) {
            const saved = await saveBookingToDatabase(bookingData, segment, customerId, merchantId, organizationId)
            if (!saved) allSaved = false
          }
          if (allSaved) {
            console.log(`   ✅ Saved ${segments.length} booking record(s)`)
            successCount++
          } else {
            errorCount++
          }
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200))
        
      } catch (error) {
        console.error(`   ❌ Error processing booking: ${error.message}`)
        errorCount++
      }
    }
    
    console.log('\n' + '=' .repeat(60))
    console.log('\n📊 Summary:')
    console.log(`   ✅ Successfully backfilled: ${successCount}`)
    console.log(`   ❌ Errors: ${errorCount}`)
    console.log(`   📋 Total processed: ${missedBookings.length}`)
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

backfillMissedBookings()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

