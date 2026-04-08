const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Is square_booking_sdk_snapshot populated at all?
  const snap = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total,
           MAX(start_at) AS latest_start
    FROM square_booking_sdk_snapshot
  `;
  console.log('square_booking_sdk_snapshot:', snap);

  // Square customer sync freshness
  const clients = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total,
           MAX(created_at) AS latest_created,
           MAX(updated_at) AS latest_updated
    FROM square_existing_clients
  `;
  console.log('square_existing_clients:', clients);

  // Total customers created today
  const today = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total
    FROM square_existing_clients
    WHERE created_at >= DATE '2026-04-08' AND created_at < DATE '2026-04-09'
  `;
  console.log('Customers created today:', today);

  // Any bookings at Union St today with customer_id that points to Pamela Odetto (GV68PEDHEVFBHN70C091RHBZXR)?
  const pam = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE customer_id = 'GV68PEDHEVFBHN70C091RHBZXR'
      AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-04-08'
  `;
  console.log('Pamela Odetto bookings today in DB:', pam);

  // What's the very latest updated_at on Pamela Odetto customer record?
  const pamClient = await prisma.$queryRaw`
    SELECT square_customer_id, created_at, updated_at
    FROM square_existing_clients
    WHERE square_customer_id = 'GV68PEDHEVFBHN70C091RHBZXR'
  `;
  console.log('Pamela Odetto customer record:', pamClient);

  await prisma.$disconnect();
})();
