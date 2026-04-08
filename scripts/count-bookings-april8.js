const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNION_ID = '9dc99ffe-8904-4f9b-895f-f1f006d0d380';
const PACIFIC_ID = '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc';

(async () => {
  for (const [label, locId] of [
    ['Union St', UNION_ID],
    ['Pacific Ave', PACIFIC_ID],
  ]) {
    console.log(`\n=== ${label} ===`);

    // Bookings on April 8 LA
    const bk = await prisma.$queryRaw`
      SELECT status, COUNT(*)::int AS cnt
      FROM bookings
      WHERE location_id = ${locId}::uuid
        AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-04-08'
      GROUP BY status ORDER BY status
    `;
    console.log('bookings by status:');
    bk.forEach((r) => console.log(`  ${r.status}: ${r.cnt}`));

    // Count active booking_segments for those bookings (Square dashboard likely counts service lines)
    const segs = await prisma.$queryRaw`
      SELECT b.status, COUNT(*)::int AS cnt
      FROM booking_segments bs
      JOIN bookings b ON b.id = bs.booking_id
      WHERE b.location_id = ${locId}::uuid
        AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-04-08'
        AND bs.is_active = true
      GROUP BY b.status ORDER BY b.status
    `;
    console.log('active booking_segments by booking status:');
    segs.forEach((r) => console.log(`  ${r.status}: ${r.cnt}`));

    // All segments (including inactive)
    const allSegs = await prisma.$queryRaw`
      SELECT b.status, COUNT(*)::int AS cnt
      FROM booking_segments bs
      JOIN bookings b ON b.id = bs.booking_id
      WHERE b.location_id = ${locId}::uuid
        AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-04-08'
      GROUP BY b.status ORDER BY b.status
    `;
    console.log('ALL booking_segments (including inactive) by booking status:');
    allSegs.forEach((r) => console.log(`  ${r.status}: ${r.cnt}`));
  }

  // Latest sync time — when was the most recent booking for April 8 updated?
  const latest = await prisma.$queryRaw`
    SELECT MAX(updated_at) AS last_update, COUNT(*)::int AS cnt
    FROM bookings
    WHERE (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-04-08'
  `;
  console.log('\nLatest bookings.updated_at for April 8:', latest[0]);

  await prisma.$disconnect();
})();
