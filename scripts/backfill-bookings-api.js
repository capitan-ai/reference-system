#!/usr/bin/env node
/**
 * Backfill bookings from Square API (last 30 days)
 * Uses direct REST API calls instead of SDK
 * 
 * Usage: node scripts/backfill-bookings-api.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { resolveLocationUuidForSquareLocationId } = require('../lib/location-resolver');

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.trim();
const SQUARE_API_BASE = 'https://connect.squareup.com/v2';

// Helper to make Square API calls
async function squareApi(endpoint, method = 'GET', body = null) {
  const url = `${SQUARE_API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`Square API error: ${JSON.stringify(data.errors || data)}`);
  }
  
  return data;
}

// Date range: Last 30 days
const endDate = new Date();
const startDate = new Date();
startDate.setDate(startDate.getDate() - 30);

console.log('🔄 Backfill Bookings from Square API (Last 30 Days)\n');
console.log('='.repeat(60));
console.log('📅 Date Range:');
console.log(`   Start: ${startDate.toISOString()}`);
console.log(`   End:   ${endDate.toISOString()}`);
console.log('');

function safeStringify(obj) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

async function resolveOrganizationId(locationId) {
  if (locationId) {
    const loc = await prisma.$queryRaw`
      SELECT organization_id FROM locations 
      WHERE square_location_id = ${locationId}
      LIMIT 1
    `;
    if (loc && loc.length > 0) {
      return { organizationId: loc[0].organization_id };
    }
  }
  
  // Fallback
  const defaultOrg = await prisma.$queryRaw`
    SELECT id FROM organizations WHERE is_active = true ORDER BY created_at ASC LIMIT 1
  `;
  return { organizationId: defaultOrg?.[0]?.id || null };
}

async function resolveTechnicianId(squareTeamMemberId) {
  if (!squareTeamMemberId) return null;
  
  const tech = await prisma.$queryRaw`
    SELECT id FROM team_members WHERE square_team_member_id = ${squareTeamMemberId} LIMIT 1
  `;
  return tech?.[0]?.id || null;
}

async function resolveServiceVariationId(squareServiceVariationId) {
  if (!squareServiceVariationId) return null;
  
  const sv = await prisma.$queryRaw`
    SELECT uuid FROM service_variation WHERE square_variation_id = ${squareServiceVariationId} LIMIT 1
  `;
  return sv?.[0]?.uuid || null;
}

async function processBooking(booking) {
  const bookingId = booking.id;
  const locationId = booking.location_id;
  const customerId = booking.customer_id;
  const status = booking.status || 'PENDING';
  const startAt = booking.start_at ? new Date(booking.start_at) : null;
  const version = booking.version || 0;
  const source = booking.source || null;
  const locationType = booking.location_type || 'BUSINESS_LOCATION';
  const allDay = booking.all_day || false;
  
  // Get appointment segments
  const segments = booking.appointment_segments || [];
  const firstSegment = segments[0] || {};
  
  const squareServiceVariationId = firstSegment.service_variation_id || null;
  const serviceVariationVersion = firstSegment.service_variation_version ? BigInt(firstSegment.service_variation_version) : null;
  const durationMinutes = firstSegment.duration_minutes || null;
  const intermissionMinutes = firstSegment.intermission_minutes || 0;
  const squareTeamMemberId = firstSegment.team_member_id || null;
  const anyTeamMember = firstSegment.any_team_member || false;
  
  // Resolve IDs
  const { organizationId } = await resolveOrganizationId(locationId);
  if (!organizationId) {
    return { success: false, reason: 'no_org' };
  }

  const internalLocationId = await resolveLocationUuidForSquareLocationId(prisma, locationId, organizationId);
  if (!internalLocationId) {
    return { success: false, reason: 'location_not_resolved' };
  }
  
  const internalTechnicianId = await resolveTechnicianId(squareTeamMemberId);
  const internalServiceVariationId = await resolveServiceVariationId(squareServiceVariationId);
  
  // Check if exists
  const existing = await prisma.$queryRaw`
    SELECT id FROM bookings WHERE booking_id = ${bookingId} LIMIT 1
  `;
  const isNew = !existing || existing.length === 0;
  
  // Creator details (only creator_type and creator_customer_id exist in schema)
  const creatorType = booking.creator_details?.creator_type || null;
  const creatorCustomerId = booking.creator_details?.customer_id || null;
  
  // Address
  const address = booking.address || {};
  
  try {
    if (isNew) {
      // Insert new booking - use simpler approach with ON CONFLICT
      await prisma.$executeRaw`
        INSERT INTO bookings (
          id, organization_id, booking_id, location_id,
          customer_id, location_type, start_at, status, all_day, version, source,
          service_variation_id, service_variation_version, duration_minutes, intermission_minutes,
          technician_id, any_team_member,
          creator_type, creator_customer_id,
          raw_json, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), 
          ${organizationId}::uuid, 
          ${bookingId}, 
          ${internalLocationId}::uuid,
          ${customerId}, 
          ${locationType}, 
          ${startAt}, 
          ${status}, 
          ${allDay}, 
          ${version}, 
          ${source},
          ${internalServiceVariationId ? internalServiceVariationId : null}::uuid, 
          ${serviceVariationVersion}, 
          ${durationMinutes}, 
          ${intermissionMinutes},
          ${internalTechnicianId ? internalTechnicianId : null}::uuid, 
          ${anyTeamMember},
          ${creatorType}, 
          ${creatorCustomerId},
          ${safeStringify(booking)}::jsonb, 
          NOW(), 
          NOW()
        )
        ON CONFLICT (organization_id, booking_id) DO UPDATE SET
          status = EXCLUDED.status,
          version = EXCLUDED.version,
          raw_json = EXCLUDED.raw_json,
          updated_at = NOW()
      `;
    } else {
      // Update existing booking
      await prisma.$executeRaw`
        UPDATE bookings SET
          status = ${status},
          version = ${version},
          service_variation_id = COALESCE(${internalServiceVariationId ? internalServiceVariationId : null}::uuid, service_variation_id),
          service_variation_version = COALESCE(${serviceVariationVersion}, service_variation_version),
          duration_minutes = COALESCE(${durationMinutes}, duration_minutes),
          technician_id = COALESCE(${internalTechnicianId ? internalTechnicianId : null}::uuid, technician_id),
          raw_json = ${safeStringify(booking)}::jsonb,
          updated_at = NOW()
        WHERE booking_id = ${bookingId}
      `;
    }
    
    return { success: true, isNew };
  } catch (err) {
    return { success: false, reason: 'db_error', error: err.message };
  }
}

async function backfillBookings() {
  // Get locations
  console.log('📋 Step 1: Fetching locations...\n');
  const locations = await prisma.$queryRaw`
    SELECT square_location_id, name FROM locations WHERE square_location_id IS NOT NULL
  `;
  
  if (!locations || locations.length === 0) {
    console.log('❌ No locations found');
    return;
  }
  console.log(`   ✅ Found ${locations.length} location(s)\n`);
  
  let totalBookings = 0;
  let newBookings = 0;
  let updatedBookings = 0;
  let failedBookings = 0;
  
  // Fetch bookings for each location
  for (const location of locations) {
    const locationId = location.square_location_id;
    console.log(`\n📡 Fetching bookings for: ${location.name || locationId}...`);
    
    let cursor = null;
    let locationBookingCount = 0;
    let batchNum = 0;
    
    do {
      batchNum++;
      
      // Build URL with query params
      let url = `/bookings?location_id=${locationId}&start_at_min=${startDate.toISOString()}&start_at_max=${endDate.toISOString()}&limit=100`;
      if (cursor) {
        url += `&cursor=${cursor}`;
      }
      
      let result;
      try {
        result = await squareApi(url, 'GET');
      } catch (err) {
        console.log(`   ❌ API error: ${err.message.substring(0, 60)}`);
        break;
      }
      
      const bookings = result.bookings || [];
      cursor = result.cursor;
      
      console.log(`   Batch ${batchNum}: ${bookings.length} bookings`);
      locationBookingCount += bookings.length;
      totalBookings += bookings.length;
      
      for (const booking of bookings) {
        const processResult = await processBooking(booking);
        
        if (processResult.success) {
          if (processResult.isNew) newBookings++;
          else updatedBookings++;
        } else {
          failedBookings++;
        }
        
        // Rate limiting
        await new Promise(r => setTimeout(r, 30));
      }
      
      // Delay between batches
      if (cursor) {
        await new Promise(r => setTimeout(r, 200));
      }
      
    } while (cursor);
    
    console.log(`   ✅ Location complete: ${locationBookingCount} bookings`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 BOOKINGS BACKFILL SUMMARY:');
  console.log('='.repeat(60));
  console.log(`   📋 Total bookings from Square: ${totalBookings}`);
  console.log(`   ✅ New bookings added: ${newBookings}`);
  console.log(`   🔄 Existing bookings updated: ${updatedBookings}`);
  console.log(`   ❌ Failed: ${failedBookings}`);
  console.log('='.repeat(60));
  
  return { totalBookings, newBookings, updatedBookings, failedBookings };
}

// Run
backfillBookings()
  .then(() => {
    console.log('\n✅ Bookings backfill completed!');
    console.log('\n📌 Next step: Run order-booking match script:');
    console.log('   node scripts/backfill-order-booking-match.js\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });

