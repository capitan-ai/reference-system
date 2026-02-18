console.log('Script started...');
require('dotenv').config();
console.log('Dotenv loaded.');
const { Client, Environment } = require('square');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

console.log('Initializing Prisma...');
const prisma = new PrismaClient();
console.log('Initializing Square...');
const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN.trim(),
  environment: Environment.Production,
});

async function run() {
  console.log('Run function started...');
  const ids = [
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

  console.log(`🚀 Starting backfill for ${ids.length} bookings...`);

  // Cache for orgs and locations to avoid repeated queries
  const orgCache = {};
  const locCache = {};

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    try {
      process.stdout.write(`[${i+1}/${ids.length}] ${id}... `);
      
      const resp = await client.bookingsApi.retrieveBooking(id);
      const b = resp.result.booking;
      
      if (!orgCache[b.merchantId]) {
        const orgs = await prisma.$queryRaw`SELECT id FROM organizations WHERE square_merchant_id = ${b.merchantId} LIMIT 1`;
        orgCache[b.merchantId] = orgs[0]?.id;
      }
      const org = orgCache[b.merchantId];

      const locKey = `${b.locationId}_${org}`;
      if (!locCache[locKey]) {
        const locs = await prisma.$queryRaw`SELECT id FROM locations WHERE square_location_id = ${b.locationId} AND organization_id = ${org}::uuid LIMIT 1`;
        locCache[locKey] = locs[0]?.id;
      }
      const loc = locCache[locKey];

      await prisma.$executeRawUnsafe(`
        INSERT INTO bookings (id, organization_id, booking_id, location_id, customer_id, status, start_at, created_at, updated_at, version, raw_json)
        VALUES ('${crypto.randomUUID()}', '${org}', '${b.id}', '${loc}', '${b.customerId}', '${b.status}', '${b.startAt}', '${b.createdAt}', '${b.updatedAt}', ${b.version}, '${JSON.stringify(b).replace(/'/g, "''")}')
        ON CONFLICT (organization_id, booking_id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          version = EXCLUDED.version,
          raw_json = EXCLUDED.raw_json
      `);
      
      process.stdout.write(`✅\n`);
    } catch (e) {
      process.stdout.write(`❌ ${e.message}\n`);
    }
  }

  console.log('\n✅ Done!');
  await prisma.$disconnect();
}

run();

