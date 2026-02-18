require('dotenv').config();
const { Client, Environment } = require('square');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();
const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN.trim(),
  environment: Environment.Production,
});

// Helper to resolve organization_id from merchant_id
async function resolveOrganizationId(merchantId) {
  if (!merchantId) return null;
  const org = await prisma.$queryRaw`SELECT id FROM organizations WHERE square_merchant_id = ${merchantId} LIMIT 1`;
  return org && org.length > 0 ? org[0].id : null;
}

// Helper to resolve technician UUID
async function resolveTeamMemberUuid(squareTeamMemberId, organizationId) {
  if (!squareTeamMemberId || !organizationId) return null;
  const tm = await prisma.$queryRaw`SELECT id FROM team_members WHERE square_team_member_id = ${squareTeamMemberId} AND organization_id = ${organizationId}::uuid LIMIT 1`;
  return tm && tm.length > 0 ? tm[0].id : null;
}

// Helper to resolve service variation UUID
async function resolveServiceVariationUuid(squareId, organizationId) {
  if (!squareId || !organizationId) return null;
  const sv = await prisma.$queryRaw`SELECT id FROM service_variation WHERE square_id = ${squareId} AND organization_id = ${organizationId}::uuid LIMIT 1`;
  return sv && sv.length > 0 ? sv[0].id : null;
}

// Helper to resolve location UUID
async function resolveLocationUuid(squareLocationId, organizationId) {
  if (!squareLocationId || !organizationId) return null;
  const loc = await prisma.$queryRaw`SELECT id FROM locations WHERE square_location_id = ${squareLocationId} AND organization_id = ${organizationId}::uuid LIMIT 1`;
  return loc && loc.length > 0 ? loc[0].id : null;
}

async function backfillBookings(bookingIds) {
  console.log(`🚀 Starting backfill for ${bookingIds.length} bookings...`);
  let successCount = 0;
  let failCount = 0;

  for (const bookingId of bookingIds) {
    try {
      process.stdout.write(`📦 [${successCount + failCount + 1}/${bookingIds.length}] Processing ${bookingId}... `);
      
      // 1. Fetch from Square
      const response = await client.bookingsApi.retrieveBooking(bookingId);
      const b = response.result.booking;
      
      if (!b) {
        console.log(`❌ Not found in Square`);
        failCount++;
        continue;
      }

      // 2. Resolve IDs
      const organizationId = await resolveOrganizationId(b.merchantId);
      if (!organizationId) {
        console.log(`❌ No Org for ${b.merchantId}`);
        failCount++;
        continue;
      }

      const locationUuid = await resolveLocationUuid(b.locationId, organizationId);
      if (!locationUuid) {
        console.log(`❌ No Loc ${b.locationId}`);
        failCount++;
        continue;
      }

      const segment = b.appointmentSegments?.[0];
      const technicianId = await resolveTeamMemberUuid(segment?.teamMemberId, organizationId);
      const serviceVariationId = await resolveServiceVariationUuid(segment?.serviceVariationId, organizationId);

      // 3. Insert into DB
      await prisma.$executeRaw`
        INSERT INTO bookings (
          id, organization_id, booking_id, location_id, customer_id, 
          status, start_at, created_at, updated_at, version,
          service_variation_id, technician_id, duration_minutes,
          raw_json
        ) VALUES (
          ${crypto.randomUUID()},
          ${organizationId}::uuid,
          ${b.id},
          ${locationUuid}::uuid,
          ${b.customerId},
          ${b.status},
          ${new Date(b.startAt)},
          ${new Date(b.createdAt)},
          ${new Date(b.updatedAt)},
          ${b.version || 0},
          ${serviceVariationId},
          ${technicianId},
          ${segment?.durationMinutes || 0},
          ${JSON.stringify(b)}::jsonb
        )
        ON CONFLICT (organization_id, booking_id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          version = EXCLUDED.version,
          raw_json = EXCLUDED.raw_json
      `;

      console.log(`✅ Saved`);
      successCount++;
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      failCount++;
    }
  }

  console.log(`\n🏁 Backfill completed!`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
}

// List of missing IDs from previous check
const missingIds = [
  'algy5853ihl2j5', 'vvz3d1vbo2qget', 'mwuvnn4fq89094', '8iiefh8qmf6e43', 'd99elfary5j32q',
  '3ql8jjuitiwe2u', 'dae5spi05mhvks', 'nleehd7h1k2ecd', '6gr5yi53qx780h', '1tlbi4woo6t8ni',
  'j07qx5e9x10edi', 'n6a61mwhggap1p', 'v5emkkxztm29q0', 'gf58hq0ysfa8be', 'gq6zfga1m6fmzl',
  'nkok13qmryybxc', '6xhnltpwzgw38w', '73m8inh9mv8500', 'jqqhwetcbzci3e', 'skxnnd40ov95bn',
  'qblcsl8o4jzfpz', 'kee6iideq2xmiv', 'ht6qvj46hc128b', 'hkz00o8xf6p3l6', '95s3ordcxmbcrs',
  'swd757uyzln1pn', '1u1znw8y2qc9vo', '49mceg6z6qovxu', 'wof8bjkjn18me2', 'ge4yh81g88jcq2',
  'gqy06dncwc7f6n', '8mw5174kmdwgho', '2fdc3eumbidpy5', 'oywpou2s1fzxow', 'jpkybu22bmzaex',
  'df5ymfri0gas9r', 'ez01tebao6l7mp', '4s3jjog3r91vtc', 'o6i8f1fda27fol', 'uhazurdhj0mpgt',
  'uw9n9y72zrmwjl', 'ri0kbdwkmw460r', 'gb2c2hdlkqguo4', 'iwli575mhxgm52', 'vzejulu824jllv',
  'p39aru5zifcszn', '4v7as4ck5iknms', 'bnoctdygz4o896', 'qhig490z9zv6wf'
];

backfillBookings(missingIds)
  .catch(console.error)
  .finally(() => prisma.$disconnect());

