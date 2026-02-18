require('dotenv').config();
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const token = process.env.SQUARE_ACCESS_TOKEN.trim();

async function fetchAllSquareBookings(start, end) {
  let allBookings = [];
  let cursor = null;
  let page = 1;

  console.log(`📡 Fetching ALL bookings from Square for February...`);

  do {
    const path = `/v2/bookings?start_at_min=${start}&start_at_max=${end}${cursor ? `&cursor=${cursor}` : ''}`;
    
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'connect.squareup.com',
        port: 443,
        path: path,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Square-Version': '2024-10-17', // Using a more stable version
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              console.error(`   ❌ Square API returned ${res.statusCode}: ${data}`);
            }
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse Square response: ${data}`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (result.errors && result.errors.length > 0) {
      console.error('Full Square Result:', JSON.stringify(result, null, 2));
      throw new Error(`Square API Error: ${JSON.stringify(result.errors)}`);
    }

    const pageBookings = result.bookings || [];
    allBookings = allBookings.concat(pageBookings);
    cursor = result.cursor;
    
    console.log(`   Page ${page}: received ${pageBookings.length} bookings (Total so far: ${allBookings.length})`);
    page++;
  } while (cursor);

  return allBookings;
}

async function run() {
  const startAt = '2026-02-01T00:00:00Z';
  const endAt = '2026-03-01T00:00:00Z';

  try {
    // 1. Get all bookings from Square
    const squareBookings = await fetchAllSquareBookings(startAt, endAt);
    console.log(`\n✅ Total Square bookings for February: ${squareBookings.length}`);

    // 2. Get all booking IDs from DB
    const dbBookings = await prisma.booking.findMany({
      select: { booking_id: true }
    });
    const dbBookingIds = new Set(dbBookings.map(b => b.booking_id));
    console.log(`✅ Total unique booking IDs in DB: ${dbBookingIds.size}`);

    // 3. Find missing
    const missing = squareBookings.filter(sb => !dbBookingIds.has(sb.id));

    if (missing.length > 0) {
      console.log(`\n🚨 FOUND ${missing.length} MISSING BOOKINGS IN DATABASE!`);
      console.log('='.repeat(60));
      
      missing.forEach((b, i) => {
        console.log(`${i + 1}. ID: ${b.id}`);
        console.log(`   Status: ${b.status}`);
        console.log(`   Start At: ${b.startAt}`);
        console.log(`   Customer ID: ${b.customerId}`);
        console.log(`   Created At: ${b.createdAt}`);
        console.log(`   Creator: ${b.creatorDetails?.teamMemberId || b.creatorDetails?.customerId} (${b.creatorDetails?.creatorType})`);
        console.log('-'.repeat(30));
      });
      
      console.log(`\n💡 To fix this, we need to run a backfill for these ${missing.length} IDs.`);
    } else {
      console.log('\n✅ All February bookings from Square are already in your database.');
    }

  } catch (e) {
    console.error('\n❌ Fatal Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();

