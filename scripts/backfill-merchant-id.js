#!/usr/bin/env node
/**
 * Backfill merchant_id for tables that need it
 * Uses location_id to fetch merchant_id from Square API
 * 
 * Tables to update:
 * - bookings (merchant_id column)
 * - payments (merchant_id column)
 * - orders (merchant_id column)
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
const locationsApi = square.locationsApi
const bookingsApi = square.bookingsApi

console.log(`🔑 Using Square ${envName} environment`)

// Copy saveBookingToDatabase implementation from backfill-missed-bookings.js
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

async function saveBookingToDatabase(bookingData, segment, customerId, merchantId, organizationId) {
  try {
    const baseBookingId = bookingData.id || bookingData.bookingId
    const bookingId = segment 
      ? `${baseBookingId}-${segment.service_variation_id || segment.serviceVariationId || 'unknown'}`
      : baseBookingId
    
    // Resolve UUIDs
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
    
    const address = bookingData.address || {}
    const squareLocationId = bookingData.location_id || bookingData.locationId
    
    if (!squareLocationId) {
      console.error(`   ❌ Booking ${bookingId} missing location_id`)
      return false
    }
    
    // Resolve location UUID
    let locationUuid = null
    try {
      const locationResponse = await locationsApi.retrieveLocation(squareLocationId)
      const location = locationResponse.result?.location
      // Square API returns merchantId (camelCase), not merchant_id
      const locationMerchantId = location?.merchantId || location?.merchant_id || null
      const locationName = location?.name || `Location ${squareLocationId.substring(0, 8)}...`
      
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
        ${JSON.stringify(bookingData, (key, value) => typeof value === 'bigint' ? value.toString() : value)}::jsonb
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

// Helper: Resolve organization_id from location_id (same as in backfill script)
async function resolveOrganizationIdFromLocationId(squareLocationId) {
  if (!squareLocationId) return null
  
  try {
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
    return null
  }
}

// Cache for location merchant_id lookups
const locationMerchantIdCache = new Map()

async function getMerchantIdFromLocation(squareLocationId) {
  if (!squareLocationId) return null
  
  // Check cache first
  if (locationMerchantIdCache.has(squareLocationId)) {
    return locationMerchantIdCache.get(squareLocationId)
  }
  
  try {
    // Check database first
    const location = await prisma.$queryRaw`
      SELECT square_merchant_id
      FROM locations
      WHERE square_location_id = ${squareLocationId}
      LIMIT 1
    `
    
    if (location && location.length > 0 && location[0].square_merchant_id) {
      locationMerchantIdCache.set(squareLocationId, location[0].square_merchant_id)
      return location[0].square_merchant_id
    }
    
    // Fetch from Square API
    console.log(`   📡 Fetching merchant_id for location ${squareLocationId} from Square API...`)
    const response = await locationsApi.retrieveLocation(squareLocationId)
    const locationData = response.result?.location
    
    if (!locationData) {
      console.log(`   ⚠️  Location ${squareLocationId} not found in Square API response`)
      return null
    }
    
    // Square API returns merchantId (camelCase), not merchant_id
    const merchantId = locationData.merchantId || locationData.merchant_id || null
    
    if (merchantId) {
      console.log(`   ✅ Found merchant_id: ${merchantId.substring(0, 16)}...`)
      
      // Update location in database
      await prisma.$executeRaw`
        UPDATE locations
        SET square_merchant_id = ${merchantId},
            updated_at = NOW()
        WHERE square_location_id = ${squareLocationId}
      `
      
      locationMerchantIdCache.set(squareLocationId, merchantId)
      return merchantId
    } else {
      console.log(`   ⚠️  Location ${squareLocationId} missing merchantId in Square API response`)
      return null
    }
    
  } catch (error) {
    console.error(`   ❌ Error fetching location ${squareLocationId}: ${error.message}`)
    if (error.statusCode) {
      console.error(`      Status code: ${error.statusCode}`)
    }
    if (error.errors) {
      console.error(`      Square errors: ${JSON.stringify(error.errors)}`)
    }
    return null
  }
}

async function backfillBookingsMerchantId() {
  console.log('\n📅 Backfilling merchant_id for bookings...\n')
  
  const bookings = await prisma.$queryRaw`
    SELECT 
      b.id,
      b.booking_id,
      b.merchant_id,
      l.square_location_id
    FROM bookings b
    INNER JOIN locations l ON b.location_id = l.id
    WHERE b.merchant_id IS NULL
      AND l.square_location_id IS NOT NULL
    LIMIT 100
  `
  
  console.log(`   Found ${bookings.length} bookings missing merchant_id`)
  
  let updated = 0
  let skipped = 0
  
  for (const booking of bookings) {
    const merchantId = await getMerchantIdFromLocation(booking.square_location_id)
    if (merchantId) {
      await prisma.$executeRaw`
        UPDATE bookings
        SET merchant_id = ${merchantId},
            updated_at = NOW()
        WHERE id = ${booking.id}::uuid
      `
      updated++
    } else {
      skipped++
      if (skipped <= 3) {
        console.log(`   ⚠️  Could not get merchant_id for location: ${booking.square_location_id}`)
      }
    }
    
    // Small delay to avoid rate limiting
    if (updated % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  
  console.log(`   ✅ Updated ${updated} bookings`)
  if (skipped > 0) {
    console.log(`   ⚠️  Skipped ${skipped} bookings (could not resolve merchant_id)`)
  }
  return updated
}

async function backfillPaymentsMerchantId() {
  console.log('\n💳 Backfilling merchant_id for payments...\n')
  
  const payments = await prisma.$queryRaw`
    SELECT 
      p.id,
      p.payment_id,
      p.merchant_id,
      l.square_location_id
    FROM payments p
    INNER JOIN locations l ON p.location_id = l.id
    WHERE p.merchant_id IS NULL
      AND l.square_location_id IS NOT NULL
    LIMIT 100
  `
  
  console.log(`   Found ${payments.length} payments missing merchant_id`)
  
  let updated = 0
  let skipped = 0
  
  for (const payment of payments) {
    const merchantId = await getMerchantIdFromLocation(payment.square_location_id)
    if (merchantId) {
      await prisma.$executeRaw`
        UPDATE payments
        SET merchant_id = ${merchantId},
            updated_at = NOW()
        WHERE id = ${payment.id}::uuid
      `
      updated++
    } else {
      skipped++
    }
    
    // Small delay to avoid rate limiting
    if (updated % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  
  console.log(`   ✅ Updated ${updated} payments`)
  if (skipped > 0) {
    console.log(`   ⚠️  Skipped ${skipped} payments (could not resolve merchant_id)`)
  }
  return updated
}

async function backfillOrdersMerchantId() {
  console.log('\n📦 Backfilling merchant_id for orders...\n')
  
  // Check if orders table has merchant_id column
  const hasMerchantId = await prisma.$queryRaw`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'orders' 
      AND column_name = 'merchant_id'
    LIMIT 1
  `
  
  if (!hasMerchantId || hasMerchantId.length === 0) {
    console.log(`   ⚠️  Orders table doesn't have merchant_id column, skipping`)
    return 0
  }
  
  const orders = await prisma.$queryRaw`
    SELECT 
      o.id,
      o.order_id,
      o.merchant_id,
      l.square_location_id
    FROM orders o
    INNER JOIN locations l ON o.location_id = l.id
    WHERE o.merchant_id IS NULL
      AND l.square_location_id IS NOT NULL
    LIMIT 100
  `
  
  console.log(`   Found ${orders.length} orders missing merchant_id`)
  
  let updated = 0
  for (const order of orders) {
    const merchantId = await getMerchantIdFromLocation(order.square_location_id)
    if (merchantId) {
      await prisma.$executeRaw`
        UPDATE orders
        SET merchant_id = ${merchantId},
            updated_at = NOW()
        WHERE id = ${order.id}::uuid
      `
      updated++
    }
  }
  
  console.log(`   ✅ Updated ${updated} orders`)
  return updated
}

async function findBookingGb2c2hdlkqguo() {
  console.log('\n🔍 Searching for booking gb2c2hdlkqguo4...\n')
  
  // Try exact match and variations
  const searchTerms = ['gb2c2hdlkqguo4', 'gb2c2hdlkqguo', 'gb2c2hdlkqgu']
  
  for (const term of searchTerms) {
    const exact = await prisma.$queryRaw`
      SELECT id, booking_id, customer_id, organization_id, merchant_id, created_at
      FROM bookings
      WHERE booking_id = ${term}
         OR booking_id LIKE ${`${term}%`}
      LIMIT 5
    `
    
    if (exact.length > 0) {
      console.log(`   ✅ Found ${exact.length} booking(s) with term "${term}":`)
      exact.forEach(b => {
        console.log(`      - ${b.booking_id} (ID: ${b.id})`)
        console.log(`        Customer: ${b.customer_id || 'N/A'}`)
        console.log(`        Merchant: ${b.merchant_id || 'N/A'}`)
        console.log(`        Created: ${b.created_at}`)
      })
      return exact
    }
  }
  
  // Check webhook logs
  console.log(`   ⚠️  Not found in bookings table, checking webhook logs...`)
  const webhooks = await prisma.$queryRaw`
    SELECT 
      id,
      correlation_id,
      trigger_type,
      resource_id,
      status,
      context,
      payload,
      created_at
    FROM giftcard_runs
    WHERE resource_id LIKE 'gb2c2hdlkqgu%'
       OR context::text LIKE '%gb2c2hdlkqgu%'
       OR payload::text LIKE '%gb2c2hdlkqgu%'
    ORDER BY created_at DESC
    LIMIT 10
  `
  
  if (webhooks.length > 0) {
    console.log(`   📋 Found ${webhooks.length} webhook event(s):`)
    webhooks.forEach(w => {
      console.log(`\n      - ${w.trigger_type} (${w.status})`)
      console.log(`        Correlation ID: ${w.correlation_id}`)
      console.log(`        Resource ID: ${w.resource_id || 'N/A'}`)
      console.log(`        Created: ${w.created_at}`)
      if (w.context) {
        const ctxStr = JSON.stringify(w.context)
        if (ctxStr.includes('gb2c2hdlkqgu')) {
          console.log(`        Context: ${ctxStr.substring(0, 300)}`)
        }
      }
      if (w.payload) {
        const payloadStr = JSON.stringify(w.payload)
        if (payloadStr.includes('gb2c2hdlkqgu')) {
          console.log(`        Payload: ${payloadStr.substring(0, 300)}`)
        }
      }
    })
    
    // Try to fetch from Square API
    console.log(`\n   📡 Attempting to fetch from Square API...`)
    try {
      const bookingsApi = square.bookingsApi
      const response = await bookingsApi.retrieveBooking('gb2c2hdlkqguo4')
      const booking = response.result?.booking
      
      if (booking) {
        console.log(`   ✅ Found in Square API!`)
        console.log(`      Booking ID: ${booking.id}`)
        console.log(`      Location ID: ${booking.location_id || 'N/A'}`)
        console.log(`      Customer ID: ${booking.customer_id || 'N/A'}`)
        console.log(`      Status: ${booking.status || 'N/A'}`)
        console.log(`      Start: ${booking.start_at || 'N/A'}`)
        console.log(`      Merchant ID: ${booking.merchant_id || 'N/A'}`)
        
        // Try to save it using the backfill function
        const squareLocationId = booking.location_id || booking.locationId
        if (squareLocationId) {
          console.log(`\n   💾 Attempting to save booking using location_id resolution...`)
          const organizationId = await resolveOrganizationIdFromLocationId(squareLocationId)
          
          if (organizationId) {
            console.log(`      ✅ Resolved organization_id: ${organizationId}`)
            // Use the saveBookingToDatabase from backfill script
            const customerId = booking.customer_id || booking.customerId
            const merchantId = booking.merchant_id || null
            const segments = booking.appointment_segments || booking.appointmentSegments || []
            
            if (segments.length === 0) {
              const saved = await saveBookingToDatabase(booking, null, customerId, merchantId, organizationId)
              if (saved) {
                console.log(`      ✅ Successfully saved booking!`)
              }
            } else {
              let allSaved = true
              for (const segment of segments) {
                const saved = await saveBookingToDatabase(booking, segment, customerId, merchantId, organizationId)
                if (!saved) allSaved = false
              }
              if (allSaved) {
                console.log(`      ✅ Successfully saved ${segments.length} booking record(s)!`)
              }
            }
          } else {
            console.log(`      ❌ Could not resolve organization_id`)
          }
        }
      } else {
        console.log(`   ❌ Not found in Square API either`)
      }
    } catch (apiError) {
      console.log(`   ❌ Error fetching from Square API: ${apiError.message}`)
      if (apiError.errors) {
        console.log(`      Square errors: ${JSON.stringify(apiError.errors)}`)
      }
    }
  } else {
    console.log(`   ❌ Not found in webhook logs either`)
  }
  
  return null
}

async function main() {
  console.log('🔄 Backfilling merchant_id for All Tables\n')
  console.log('=' .repeat(60))
  
  try {
    // Backfill each table
    const bookingsUpdated = await backfillBookingsMerchantId()
    const paymentsUpdated = await backfillPaymentsMerchantId()
    const ordersUpdated = await backfillOrdersMerchantId()
    
    // Search for specific booking
    await findBookingGb2c2hdlkqguo()
    
    console.log('\n' + '=' .repeat(60))
    console.log('\n📊 Summary:')
    console.log(`   ✅ Bookings updated: ${bookingsUpdated}`)
    console.log(`   ✅ Payments updated: ${paymentsUpdated}`)
    console.log(`   ✅ Orders updated: ${ordersUpdated}`)
    console.log(`   📋 Total records updated: ${bookingsUpdated + paymentsUpdated + ordersUpdated}`)
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

