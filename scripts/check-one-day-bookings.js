require('dotenv').config();
const { Client, Environment } = require('square');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN.trim(),
  environment: Environment.Production,
});

async function checkOneDayBookings() {
  // Проверяем 13 февраля, так как там были "неизвестные" админы
  const startAt = '2026-02-13T00:00:00Z';
  const endAt = '2026-02-14T00:00:00Z';

  console.log(`🔍 Checking bookings for ONE DAY: ${startAt}...\n`);

  try {
    console.log(`📡 Calling Square ListBookings API...`);
    const response = await client.bookingsApi.listBookings(
      undefined, // limit
      undefined, // cursor
      undefined, // customer_id
      undefined, // location_id
      startAt,
      endAt
    );

    const squareBookings = response.result.bookings || [];
    console.log(`✅ Square API returned ${squareBookings.length} bookings for this day.`);

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
    console.log(`✅ Database has ${dbBookingIds.size} bookings for this day.`);

    const missing = squareBookings.filter(sb => !dbBookingIds.has(sb.id));

    if (missing.length > 0) {
      console.log(`\n🚨 Found ${missing.length} MISSING bookings in DB:`);
      missing.forEach((b, i) => {
        console.log(`${i+1}. ID: ${b.id}, Status: ${b.status}, Customer: ${b.customerId}`);
      });
    } else {
      console.log('\n✅ No missing bookings for this day.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.errors) console.error(JSON.stringify(error.errors, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

checkOneDayBookings();


