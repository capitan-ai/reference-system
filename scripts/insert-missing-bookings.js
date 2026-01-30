#!/usr/bin/env node
/**
 * Insert missing bookings from Square into the database
 * 
 * Reads the missing bookings JSON file and fetches each booking from Square API,
 * then inserts them using the same logic as the webhook handler.
 * 
 * Usage:
 *   node scripts/insert-missing-bookings.js [missing-bookings-file.json]
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const { getSquareEnvironmentName } = require('../lib/utils/square-env')
const { resolveLocationUuidForSquareLocationId } = require('../lib/location-resolver')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

/**
 * Safely stringify JSON, handling BigInt values
 */
function safeStringify(obj) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )
}

const squareEnvironmentName = getSquareEnvironmentName()
const environment = squareEnvironmentName === 'sandbox' ? Environment.Sandbox : Environment.Production
let token = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN_2
if (!token) {
  console.error('❌ Missing SQUARE_ACCESS_TOKEN')
  process.exit(1)
}
if (token.startsWith('Bearer ')) token = token.slice(7)

const square = new Client({ accessToken: token.trim(), environment })
const bookingsApi = square.bookingsApi

/**
 * Resolve organization_id from merchant_id
 */
async function resolveOrganizationId(merchantId) {
  if (!merchantId) return null
  
  try {
    const org = await prisma.$queryRaw`
      SELECT id FROM organizations WHERE square_merchant_id = ${merchantId} LIMIT 1
    `
    return org && org.length > 0 ? org[0].id : null
  } catch (error) {
    return null
  }
}

/**
 * Resolve service variation UUID from Square service variation ID
 */
async function resolveServiceVariationId(squareServiceVariationId, organizationId) {
  if (!squareServiceVariationId || !organizationId) return null
  
  try {
    // First try to find existing service variation
    const sv = await prisma.$queryRaw`
      SELECT id FROM service_variations 
      WHERE square_id = ${squareServiceVariationId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    if (sv && sv.length > 0) {
      return sv[0].id
    }
    
    // If not found, create it (upsert)
    try {
      await prisma.$executeRaw`
        INSERT INTO service_variations (
          id, organization_id, square_id, name, service_id, duration_minutes, created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          ${organizationId}::uuid,
          ${squareServiceVariationId},
          NULL,
          NULL,
          NULL,
          NOW(),
          NOW()
        )
        ON CONFLICT (organization_id, square_id) DO NOTHING
      `
      
      // Get the newly created or existing ID
      const newSv = await prisma.$queryRaw`
        SELECT id FROM service_variations 
        WHERE square_id = ${squareServiceVariationId}
          AND organization_id = ${organizationId}::uuid
        LIMIT 1
      `
      return newSv && newSv.length > 0 ? newSv[0].id : null
    } catch (error) {
      return null
    }
  } catch (error) {
    return null
  }
}

/**
 * Resolve team member UUID from Square team member ID
 */
async function resolveTeamMemberId(squareTeamMemberId, organizationId) {
  if (!squareTeamMemberId || !organizationId) return null
  
  try {
    const tm = await prisma.$queryRaw`
      SELECT id FROM team_members 
      WHERE square_team_member_id = ${squareTeamMemberId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    return tm && tm.length > 0 ? tm[0].id : null
  } catch (error) {
    return null
  }
}

/**
 * Save booking to database (simplified version of saveBookingToDatabase from webhook handler)
 */
async function saveBookingToDatabase(booking, merchantId = null, organizationId = null) {
  try {
    const baseBookingId = booking.id
    if (!baseBookingId) {
      console.warn(`   ⚠️  Booking missing ID, skipping`)
      return { success: false, reason: 'missing_id' }
    }
    
    // Extract merchant_id
    const finalMerchantId = merchantId || booking.merchantId || booking.merchant_id || null
    
    // Resolve organization_id
    let finalOrganizationId = organizationId
    if (!finalOrganizationId && finalMerchantId) {
      finalOrganizationId = await resolveOrganizationId(finalMerchantId)
    }

    // Get location ID first (we need it to resolve organization_id)
    const squareLocationId = booking.locationId || booking.location_id || booking.location?.id || null
    
    if (!squareLocationId) {
      console.warn(`   ⚠️  Booking ${baseBookingId} missing location_id`)
      return { success: false, reason: 'no_location' }
    }

    if (!finalOrganizationId) {
      const locationOrg = await prisma.$queryRaw`
        SELECT organization_id FROM locations 
        WHERE square_location_id = ${squareLocationId}
        LIMIT 1
      `
      if (locationOrg?.[0]?.organization_id) {
        finalOrganizationId = locationOrg[0].organization_id
      }
    }

    if (!finalOrganizationId) {
      const defaultOrg = await prisma.$queryRaw`
        SELECT id FROM organizations LIMIT 1
      `
      if (defaultOrg && defaultOrg.length > 0) {
        finalOrganizationId = defaultOrg[0].id
      }
    }

    if (!finalOrganizationId) {
      console.warn(`   ⚠️  Cannot resolve organization_id for booking ${baseBookingId}`)
      return { success: false, reason: 'no_organization' }
    }

    const locationUuid = await resolveLocationUuidForSquareLocationId(prisma, squareLocationId, finalOrganizationId)
    if (!locationUuid) {
      console.warn(`   ⚠️  Cannot resolve location UUID for ${squareLocationId}`)
      return { success: false, reason: 'no_location_uuid' }
    }
    
    // Get customer ID
    const customerId = booking.customerId || booking.customer_id || booking.creator_details?.customer_id || null
    
    // If customer doesn't exist, create them first (now that we have organization_id)
    if (customerId && finalOrganizationId) {
      const existingCustomer = await prisma.$queryRaw`
        SELECT square_customer_id FROM square_existing_clients 
        WHERE square_customer_id = ${customerId}
        LIMIT 1
      `
      
      if (!existingCustomer || existingCustomer.length === 0) {
        // Customer doesn't exist - create them
        try {
          // Try to fetch customer details from Square
          const customersApi = square.customersApi
          let customerData = null
          try {
            const customerResponse = await customersApi.retrieveCustomer(customerId)
            customerData = customerResponse.result?.customer
          } catch (error) {
            // Customer might not exist in Square anymore, create minimal record
          }
          
          await prisma.$executeRaw`
            INSERT INTO square_existing_clients (
              organization_id,
              square_customer_id,
              given_name,
              family_name,
              email_address,
              phone_number,
              got_signup_bonus,
              activated_as_referrer,
              created_at,
              updated_at
            ) VALUES (
              ${finalOrganizationId}::uuid,
              ${customerId},
              ${customerData?.givenName || null},
              ${customerData?.familyName || null},
              ${customerData?.emailAddress || null},
              ${customerData?.phoneNumber || null},
              FALSE,
              FALSE,
              NOW(),
              NOW()
            )
            ON CONFLICT (square_customer_id) DO NOTHING
          `
        } catch (error) {
          // If customer creation fails, we can still try to insert booking with NULL customer_id
          console.warn(`   ⚠️  Could not create customer ${customerId}: ${error.message}`)
        }
      }
    }
    
    
    const segments = booking.appointmentSegments || booking.appointment_segments || []
    const creatorDetails = booking.creatorDetails || booking.creator_details || {}
    const address = booking.address || {}
    
    // Stringify booking object first to avoid BigInt serialization issues
    const bookingJson = safeStringify(booking)
    
    let inserted = 0
    
    if (segments.length === 0) {
      // No segments, insert single booking
      const bookingId = baseBookingId
      
      // Resolve administrator UUID before the query
      const administratorUuid = await resolveTeamMemberId(
        creatorDetails.teamMemberId || creatorDetails.team_member_id, 
        finalOrganizationId
      )
      
      try {
        // Use $executeRawUnsafe for proper UUID casting
        // Use CAST with NULLIF to handle null UUIDs properly
        await prisma.$executeRawUnsafe(`
          INSERT INTO bookings (
            id, organization_id, booking_id, version, customer_id, location_id, location_type, source,
            start_at, status, all_day, transition_time_minutes,
            creator_type, creator_customer_id, administrator_id,
            address_line_1, locality, administrative_district_level_1, postal_code,
            merchant_id, created_at, updated_at, raw_json
          ) VALUES (
            gen_random_uuid(),
            $1::uuid,
            $2,
            $3,
            $4,
            $5::uuid,
            $6,
            $7,
            $8::timestamptz,
            $9,
            $10,
            $11,
            $12,
            $13,
            CAST(NULLIF($14, '') AS uuid),
            $15,
            $16,
            $17,
            $18,
            $19,
            $20::timestamptz,
            $21::timestamptz,
            $22::jsonb
          )
          ON CONFLICT (organization_id, booking_id) DO NOTHING
        `,
          finalOrganizationId,
          bookingId,
          booking.version || 0,
          customerId,
          locationUuid,
          booking.locationType || booking.location_type || null,
          booking.source || null,
          booking.startAt || booking.start_at ? new Date(booking.startAt || booking.start_at) : new Date(),
          booking.status || 'ACCEPTED',
          booking.allDay || booking.all_day || false,
          booking.transitionTimeMinutes || booking.transition_time_minutes || 0,
          creatorDetails.creatorType || creatorDetails.creator_type || null,
          creatorDetails.customerId || creatorDetails.customer_id || null,
          administratorUuid || '',
          address.addressLine1 || address.address_line_1 || null,
          address.locality || null,
          address.administrativeDistrictLevel1 || address.administrative_district_level_1 || null,
          address.postalCode || address.postal_code || null,
          finalMerchantId,
          booking.createdAt || booking.created_at ? new Date(booking.createdAt || booking.created_at) : new Date(),
          booking.updatedAt || booking.updated_at ? new Date(booking.updatedAt || booking.updated_at) : new Date(),
          bookingJson
        )
        inserted = 1
      } catch (error) {
        if (error.code === '23505') {
          // Already exists
          return { success: true, inserted: 0, reason: 'already_exists' }
        }
        throw error
      }
    } else {
      // Multiple segments, insert one booking per segment
      for (const segment of segments) {
        const squareServiceVariationId = segment.serviceVariationId || segment.service_variation_id || 'unknown'
        const bookingId = segments.length > 1 
          ? `${baseBookingId}-${squareServiceVariationId}`
          : baseBookingId
        
        // Resolve UUIDs before the query
        const serviceVariationUuid = squareServiceVariationId !== 'unknown' 
          ? await resolveServiceVariationId(squareServiceVariationId, finalOrganizationId)
          : null
        const administratorUuid = await resolveTeamMemberId(
          creatorDetails.teamMemberId || creatorDetails.team_member_id, 
          finalOrganizationId
        )
        const technicianUuid = await resolveTeamMemberId(
          segment.teamMemberId || segment.team_member_id,
          finalOrganizationId
        )
        
        try {
          // Use $executeRawUnsafe for proper UUID casting
          // Use CAST with NULLIF to handle null UUIDs properly
          await prisma.$executeRawUnsafe(`
            INSERT INTO bookings (
              id, organization_id, booking_id, version, customer_id, location_id, location_type, source,
              start_at, status, all_day, transition_time_minutes,
              creator_type, creator_customer_id, administrator_id,
              address_line_1, locality, administrative_district_level_1, postal_code,
              service_variation_id, service_variation_version, duration_minutes,
              intermission_minutes, technician_id, any_team_member,
              merchant_id, created_at, updated_at, raw_json
            ) VALUES (
              gen_random_uuid(),
              $1::uuid,
              $2,
              $3,
              $4,
              $5::uuid,
              $6,
              $7,
              $8::timestamptz,
              $9,
              $10,
              $11,
              $12,
              $13,
              CAST(NULLIF($14, '') AS uuid),
              $15,
              $16,
              $17,
              $18,
              CAST(NULLIF($19, '') AS uuid),
              $20,
              $21,
              $22,
              CAST(NULLIF($23, '') AS uuid),
              $24,
              $25,
              $26::timestamptz,
              $27::timestamptz,
              $28::jsonb
            )
            ON CONFLICT (organization_id, booking_id) DO NOTHING
          `,
            finalOrganizationId,
            bookingId,
            booking.version || 0,
            customerId,
            locationUuid,
            booking.locationType || booking.location_type || null,
            booking.source || null,
            booking.startAt || booking.start_at ? new Date(booking.startAt || booking.start_at) : new Date(),
            booking.status || 'ACCEPTED',
            booking.allDay || booking.all_day || false,
            booking.transitionTimeMinutes || booking.transition_time_minutes || 0,
            creatorDetails.creatorType || creatorDetails.creator_type || null,
            creatorDetails.customerId || creatorDetails.customer_id || null,
            administratorUuid || '',
            address.addressLine1 || address.address_line_1 || null,
            address.locality || null,
            address.administrativeDistrictLevel1 || address.administrative_district_level_1 || null,
            address.postalCode || address.postal_code || null,
            serviceVariationUuid || '',
            segment.serviceVariationVersion || segment.service_variation_version ? BigInt(segment.serviceVariationVersion || segment.service_variation_version) : null,
            segment.durationMinutes || segment.duration_minutes || null,
            segment.intermissionMinutes || segment.intermission_minutes || 0,
            technicianUuid || '',
            segment.anyTeamMember ?? segment.any_team_member ?? false,
            finalMerchantId,
            booking.createdAt || booking.created_at ? new Date(booking.createdAt || booking.created_at) : new Date(),
            booking.updatedAt || booking.updated_at ? new Date(booking.updatedAt || booking.updated_at) : new Date(),
            bookingJson
          )
          inserted++
        } catch (error) {
          if (error.code === '23505') {
            // Already exists, continue
            continue
          }
          throw error
        }
      }
    }
    
    return { success: true, inserted }
  } catch (error) {
    console.error(`   ❌ Error saving booking: ${error.message}`)
    return { success: false, error: error.message }
  }
}

async function main() {
  const filename = process.argv[2] || 'missing-bookings-2026-01-27.json'
  const filepath = path.join(process.cwd(), filename)
  
  if (!fs.existsSync(filepath)) {
    console.error(`❌ File not found: ${filepath}`)
    console.error(`   Usage: node scripts/insert-missing-bookings.js [filename.json]`)
    process.exit(1)
  }
  
  console.log(`📖 Reading missing bookings from: ${filename}\n`)
  
  const missingBookings = JSON.parse(fs.readFileSync(filepath, 'utf8'))
  console.log(`📋 Found ${missingBookings.length} missing bookings to process\n`)
  
  let successCount = 0
  let alreadyExistsCount = 0
  let errorCount = 0
  let totalInserted = 0
  
  const merchantId = process.env.SQUARE_MERCHANT_ID || null
  
  // Process in batches to avoid rate limits
  const batchSize = 10
  for (let i = 0; i < missingBookings.length; i += batchSize) {
    const batch = missingBookings.slice(i, i + batchSize)
    
    console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (${i + 1}-${Math.min(i + batchSize, missingBookings.length)} of ${missingBookings.length})...`)
    
    const results = await Promise.allSettled(
      batch.map(async (missingBooking) => {
        const bookingId = missingBooking.bookingId
        
        try {
          // Fetch booking from Square
          const response = await bookingsApi.retrieveBooking(bookingId)
          const booking = response.result?.booking
          
          if (!booking) {
            console.warn(`   ⚠️  Booking ${bookingId} not found in Square`)
            return { success: false, reason: 'not_found' }
          }
          
          // Save to database
          const result = await saveBookingToDatabase(booking, merchantId)
          
          if (result.success) {
            if (result.inserted > 0) {
              console.log(`   ✅ Inserted booking ${bookingId} (${result.inserted} record(s))`)
              return { success: true, inserted: result.inserted }
            } else if (result.reason === 'already_exists') {
              console.log(`   ℹ️  Booking ${bookingId} already exists`)
              return { success: true, inserted: 0, reason: 'already_exists' }
            }
          } else {
            console.warn(`   ⚠️  Failed to insert booking ${bookingId}: ${result.reason || result.error}`)
            return { success: false, reason: result.reason || result.error }
          }
        } catch (error) {
          if (error.statusCode === 403 || (error.errors && error.errors.some(e => e.code === 'FORBIDDEN'))) {
            console.warn(`   ⚠️  Access denied for booking ${bookingId}`)
            return { success: false, reason: 'forbidden' }
          }
          if (error.statusCode === 429) {
            console.warn(`   ⚠️  Rate limited for booking ${bookingId}, will retry`)
            throw error // Will be retried
          }
          console.error(`   ❌ Error processing booking ${bookingId}: ${error.message}`)
          return { success: false, error: error.message }
        }
      })
    )
    
    // Count results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const value = result.value
        if (value && value.success) {
          successCount++
          if (value.inserted > 0) {
            totalInserted += value.inserted
          } else if (value.reason === 'already_exists') {
            alreadyExistsCount++
          }
        } else {
          errorCount++
        }
      } else {
        errorCount++
        if (result.reason?.statusCode === 429) {
          // Rate limited, wait and retry this batch
          console.log(`   ⏳ Rate limited, waiting 2 seconds...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          i -= batchSize // Retry this batch
          continue
        }
      }
    }
    
    // Small delay between batches
    if (i + batchSize < missingBookings.length) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log('\n📊 SUMMARY:\n')
  console.log(`   ✅ Successfully processed: ${successCount}`)
  console.log(`   📝 New bookings inserted: ${totalInserted}`)
  console.log(`   ℹ️  Already existed: ${alreadyExistsCount}`)
  console.log(`   ❌ Errors: ${errorCount}`)
  console.log(`   📋 Total missing bookings: ${missingBookings.length}`)
  console.log('\n' + '='.repeat(80))
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}

module.exports = { saveBookingToDatabase }

