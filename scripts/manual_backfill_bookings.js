require('dotenv').config();
const prisma = require('../lib/prisma-client');
const axios = require('axios');

async function manualBackfill() {
  console.log('🚀 Starting manual backfill for 15 missing bookings...');
  
  let accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (accessToken) {
    accessToken = accessToken.trim();
    if (accessToken.startsWith('Bearer ')) {
      accessToken = accessToken.slice(7);
    }
  }
  const env = process.env.SQUARE_ENVIRONMENT || 'production';
  const baseUrl = env === 'sandbox' 
    ? 'https://connect.squareupsandbox.com/v2' 
    : 'https://connect.squareup.com/v2';

  const missingIds = [
    'w29wf3i5tnqgdt', 'yx6dt3pk1zaw79', 'ce9rm52iy8kt83', 'sb6h4uxjg4oaon',
    'tb7q8822tctulv', 'v5wiirqgzfb0wv', 'w4euovb4o71bl4', 'ln1l6o9zh0stc7',
    '1ht95isq2ha119', '47lwry1b9bsput', 'nej9a2jzf6i08e', '1joi2v1esxlyfb',
    'mpvc36wx40v9ct', '33mho2wk3jemcb', '5silrq2sk24rkry'
  ];

  // Actual mappings from DB
  const locationMap = {
    'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380', // Union St
    'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'  // Pacific Ave
  };
  const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278';

  for (const id of missingIds) {
    try {
      console.log(`\nFetching booking ${id}...`);
      const response = await axios.get(`${baseUrl}/bookings/${id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Square-Version': '2025-02-20',
          'Accept': 'application/json'
        }
      });
      
      const booking = response.data.booking;
      const locationUuid = locationMap[booking.location_id];
      
      if (!locationUuid) {
        console.error(`❌ Unknown Square location ID: ${booking.location_id} for booking ${id}`);
        continue;
      }

      // Resolve technician_id and service_variation_id from segments
      const segment = booking.appointment_segments?.[0] || {};
      const sqTechnicianId = segment.team_member_id;
      const sqServiceVariationId = segment.service_variation_id;
      
      let technicianUuid = null;
      if (sqTechnicianId) {
        const tm = await prisma.teamMember.findFirst({
          where: { square_team_member_id: sqTechnicianId, organization_id: organizationId }
        });
        technicianUuid = tm?.id;
      }

      let serviceVariationUuid = null;
      if (sqServiceVariationId) {
        const sv = await prisma.serviceVariation.findFirst({
          where: { square_variation_id: sqServiceVariationId, organization_id: organizationId }
        });
        serviceVariationUuid = sv?.uuid;
      }

      console.log(`Upserting booking ${id} into DB...`);
      
      await prisma.$executeRaw`
        INSERT INTO bookings (
          booking_id, version, customer_id, location_id, start_at, status, 
          created_at, updated_at, organization_id, technician_id, service_variation_id,
          duration_minutes
        ) VALUES (
          ${booking.id}, 
          ${booking.version || 0}, 
          ${booking.customer_id}, 
          ${locationUuid}::uuid, 
          ${booking.start_at}::timestamptz, 
          ${booking.status}, 
          ${booking.created_at}::timestamptz, 
          ${booking.updated_at}::timestamptz,
          ${organizationId}::uuid,
          ${technicianUuid}::uuid,
          ${serviceVariationUuid}::uuid,
          ${segment.duration_minutes || 60}
        )
        ON CONFLICT (organization_id, booking_id) DO UPDATE SET
          version = EXCLUDED.version,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          technician_id = EXCLUDED.technician_id,
          service_variation_id = EXCLUDED.service_variation_id,
          duration_minutes = EXCLUDED.duration_minutes
      `;
      
      console.log(`✅ Successfully backfilled ${id}`);
    } catch (err) {
      console.error(`❌ Failed to backfill ${id}:`, err.message);
    }
  }

  console.log('\n✨ Manual backfill completed.');
  await prisma.$disconnect();
}

manualBackfill();
