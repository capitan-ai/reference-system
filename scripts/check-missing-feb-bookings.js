require('dotenv').config();
const { Client, Environment } = require('square');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN.trim(),
  environment: Environment.Production,
});

async function checkMissingBookings() {
  console.log('🔍 Checking for missing bookings in February 2026...\n');

  const startAt = '2026-02-01T00:00:00Z';
  const endAt = '2026-03-01T00:00:00Z';

  try {
    // 1. Fetch all bookings from Square for February
    console.log(`📡 Fetching bookings from Square (${startAt} to ${endAt})...`);
    let squareBookings = [];
    let cursor = null;
    let page = 1;

    do {
      console.log(`   Fetching page ${page}...`);
      const response = await client.bookingsApi.searchBookings({
        cursor: cursor || undefined,
        query: {
          filter: {
            startAtRange: {
              startAt,
              endAt
            }
          }
        }
      });

      const pageBookings = response.result.bookings || [];
      squareBookings = squareBookings.concat(pageBookings);
      cursor = response.result.cursor;
      console.log(`   ✅ Page ${page} received: ${pageBookings.length} bookings.`);
      page++;
    } while (cursor);

    console.log(`✅ Total found ${squareBookings.length} bookings in Square for February.`);

    if (squareBookings.length === 0) {
      console.log('No bookings found in Square for this period.');
      return;
    }

    // 2. Get all booking IDs from our database for February
    const dbBookings = await prisma.booking.findMany({
      where: {
        start_at: {
          gte: new Date(startAt),
          lt: new Date(endAt)
        }
      },
      select: {
        booking_id: true
      }
    });

    const dbBookingIds = new Set(dbBookings.map(b => b.booking_id));
    console.log(`✅ Found ${dbBookingIds.size} bookings in our database for February.`);

    // 3. Compare and find missing
    const missingBookings = squareBookings.filter(sb => !dbBookingIds.has(sb.id));

    if (missingBookings.length > 0) {
      console.log(`\n🚨 Found ${missingBookings.length} MISSING bookings!`);
      console.log('--------------------------------------------------');
      missingBookings.forEach((b, i) => {
        console.log(`${i + 1}. ID: ${b.id}`);
        console.log(`   Status: ${b.status}`);
        console.log(`   Start At: ${b.startAt}`);
        console.log(`   Customer ID: ${b.customerId}`);
        console.log(`   Created At: ${b.createdAt}`);
        const creator = b.creatorDetails?.teamMemberId || b.creatorDetails?.customerId || 'Unknown';
        console.log(`   Creator: ${creator} (${b.creatorDetails?.creatorType})`);
        console.log('---');
      });
    } else {
      console.log('\n✅ All Square bookings for February are present in our database.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.errors) {
      console.error(JSON.stringify(error.errors, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

checkMissingBookings();

