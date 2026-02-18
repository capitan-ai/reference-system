require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const fetch = global.fetch || require('cross-fetch');

const prisma = new PrismaClient();
let token = process.env.SQUARE_ACCESS_TOKEN || '';
token = token.trim().replace(/^"|"$/g, '').replace(/\\n/g, '');

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function comprehensiveBackfill() {
  console.log('🚀 Starting Comprehensive Booking Backfill (Jan & Feb 2026)...');

  // Split into 30-day chunks to avoid Square API limit
  const ranges = [
      { start: '2026-01-01T00:00:00Z', end: '2026-01-31T23:59:59Z' },
      { start: '2026-02-01T00:00:00Z', end: '2026-03-01T00:00:00Z' }
  ];

  try {
    // 0. Pre-fetch mappings
    console.log('Loading metadata mappings...');
    
    const locations = await prisma.location.findMany({ where: { organization_id: ORG_ID } });
    const locationMap = new Map();
    locations.forEach(l => locationMap.set(l.square_location_id, l.id));

    const teamMembers = await prisma.teamMember.findMany({ where: { organization_id: ORG_ID } });
    const teamMemberMap = new Map();
    teamMembers.forEach(t => teamMemberMap.set(t.square_team_member_id, t.id));

    let allSquareBookings = [];

    // 1. Fetch from Square (Chunked)
    for (const range of ranges) {
        console.log(`📡 Fetching bookings from Square (${range.start} to ${range.end})...`);
        let cursor = null;
        let page = 1;

        do {
            const url = new URL('https://connect.squareup.com/v2/bookings');
            url.searchParams.append('limit', '100');
            if (cursor) url.searchParams.append('cursor', cursor);
            url.searchParams.append('start_at_min', range.start);
            url.searchParams.append('start_at_max', range.end);

            const response = await fetch(url.toString(), {
                headers: {
                    'Square-Version': '2026-01-22',
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Square API Error (${response.status}): ${text}`);
            }
            const data = await response.json();
            const bookings = data.bookings || [];
            allSquareBookings = allSquareBookings.concat(bookings);
            cursor = data.cursor;
            process.stdout.write('.');
            page++;
        } while (cursor);
        console.log('\n   Chunk complete.');
    }
    
    console.log(`\n✅ Total Square Bookings Found: ${allSquareBookings.length}`);

    // 2. Upsert into Database
    console.log('💾 Syncing to Database...');
    let updatedCount = 0;
    let errorCount = 0;

    for (const b of allSquareBookings) {
      try {
        const internalLocationId = locationMap.get(b.location_id);
        if (!internalLocationId) {
          // console.warn(`⚠️ Skipping ${b.id}: Unknown location ${b.location_id}`);
          continue;
        }

        // Prepare data object
        const bookingData = {
            organization_id: ORG_ID,
            booking_id: b.id,
            location_id: internalLocationId,
            customer_id: b.customer_id,
            start_at: new Date(b.start_at),
            status: b.status,
            all_day: b.all_day || false,
            version: b.version || 0,
            source: b.source || null,
            location_type: b.location_type || null,
            creator_type: b.creator_details?.creator_type || null,
            creator_customer_id: b.creator_details?.customer_id || null,
            transition_time_minutes: b.transition_time_minutes || 0,
            customer_note: b.customer_note || null,
            seller_note: b.seller_note || null,
            created_at: new Date(b.created_at), // Ensure this matches Square
            updated_at: new Date(b.updated_at),
            raw_json: b // Store full dump
        };

        // Add address if present
        if (b.address) {
            bookingData.address_line_1 = b.address.address_line_1 || null;
            bookingData.locality = b.address.locality || null;
            bookingData.administrative_district_level_1 = b.address.administrative_district_level_1 || null;
            bookingData.postal_code = b.address.postal_code || null;
        }

        // Upsert
        const result = await prisma.booking.upsert({
            where: {
                organization_id_booking_id: {
                    organization_id: ORG_ID,
                    booking_id: b.id
                }
            },
            update: bookingData, // Update ALL fields including created_at
            create: bookingData
        });

        const internalBookingId = result.id;

        // Handle Segments
        if (b.appointment_segments) {
            // Delete existing segments to ensure clean slate (avoids index conflicts)
            await prisma.bookingSegment.deleteMany({ where: { booking_id: internalBookingId } });
            
            const segmentsData = b.appointment_segments.map((s, index) => {
                const internalTeamMemberId = teamMemberMap.get(s.team_member_id);
                return {
                    booking_id: internalBookingId,
                    segment_index: index,
                    duration_minutes: s.duration_minutes || 0,
                    service_variation_id: null, // We don't have a reliable map for this yet, keeping null
                    square_service_variation_id: s.service_variation_id,
                    technician_id: internalTeamMemberId || null,
                    square_team_member_id: s.team_member_id,
                    service_variation_version: s.service_variation_version ? BigInt(s.service_variation_version) : null,
                    booking_version: b.version || 0,
                    is_active: true
                };
            });

            if (segmentsData.length > 0) {
                await prisma.bookingSegment.createMany({ data: segmentsData });
            }
        }
        updatedCount++;
      } catch (err) {
        console.error(`❌ Error processing ${b.id}: ${err.message}`);
        errorCount++;
      }
      
      if (updatedCount % 100 === 0) process.stdout.write('*');
    }

    console.log(`\n\n✅ Sync Complete.`);
    console.log(`Processed: ${updatedCount}`);
    console.log(`Errors: ${errorCount}`);

    // 3. Verify Counts
    // Note: DB count might be slightly higher if there are bookings outside the exact chunk boundaries but within the day
    // or if there are bookings from other sources (unlikely for this org).
    const dbCount = await prisma.booking.count({
        where: {
            start_at: { gte: new Date('2026-01-01T00:00:00Z'), lt: new Date('2026-03-01T00:00:00Z') },
            organization_id: ORG_ID
        }
    });

    console.log(`\n📊 Verification (Jan 1 - Mar 1):`);
    console.log(`Square Count: ${allSquareBookings.length}`);
    console.log(`DB Count:     ${dbCount}`);
    
    if (allSquareBookings.length === dbCount) {
        console.log('🎉 MATCH!');
    } else {
        console.log(`⚠️ Mismatch of ${Math.abs(allSquareBookings.length - dbCount)}.`);
        console.log('Note: If DB count is higher, run the cleanup script to remove composite/stale IDs.');
    }

  } catch (error) {
    console.error('❌ Fatal Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

comprehensiveBackfill();
