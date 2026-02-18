require('dotenv').config();
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const token = process.env.SQUARE_ACCESS_TOKEN.trim();

function fetchBookings(start, end) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'connect.squareup.com',
      port: 443,
      path: `/v2/bookings?start_at_min=${start}&start_at_max=${end}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Square-Version': '2026-01-22',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.bookings || []);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const startAt = '2026-02-13T00:00:00Z';
  const endAt = '2026-02-14T00:00:00Z';

  console.log(`🔍 Checking bookings for ${startAt}...`);

  try {
    const squareBookings = await fetchBookings(startAt, endAt);
    console.log(`✅ Square API returned ${squareBookings.length} bookings.`);

    const dbBookings = await prisma.booking.findMany({
      where: {
        start_at: {
          gte: new Date(startAt),
          lt: new Date(endAt)
        }
      },
      select: { booking_id: true }
    });

    const dbBookingIds = new Set(dbBookings.map(b => b.booking_id));
    console.log(`✅ Database has ${dbBookingIds.size} bookings.`);

    const missing = squareBookings.filter(sb => !dbBookingIds.has(sb.id));

    if (missing.length > 0) {
      console.log(`\n🚨 Found ${missing.length} MISSING bookings:`);
      missing.forEach((b, i) => {
        console.log(`${i+1}. ID: ${b.id}, Status: ${b.status}, Start: ${b.startAt}`);
      });
    } else {
      console.log('\n✅ All bookings are present in DB.');
    }
  } catch (e) {
    console.error('❌ Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();

