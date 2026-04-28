const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Window: 2026-03-28 .. 2026-04-28 (LA)\n');

  // Booking segments — Square sometimes counts service lines
  const seg = await prisma.$queryRaw`
    SELECT b.status, COUNT(*)::int AS active_seg, COUNT(*) FILTER (WHERE bs.is_active = false)::int AS inactive_seg
    FROM bookings b
    JOIN booking_segments bs ON bs.booking_id = b.id
    WHERE (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY b.status ORDER BY b.status
  `;
  console.log('Booking SEGMENTS by booking status:');
  seg.forEach((r) => console.log(`  ${r.status}: ${r.active_seg} active / ${r.inactive_seg} inactive`));

  // Active segments only, ACCEPTED+COMPLETED
  const seg_acc = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings b
    JOIN booking_segments bs ON bs.booking_id = b.id
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND bs.is_active = true
      AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`Active segments / ACCEPTED+COMPLETED: ${seg_acc[0].cnt}`);

  // Future vs past appointments — Square dashboards usually show only PAST/COMPLETED
  const past_future = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE start_at < NOW())::int AS past,
      COUNT(*) FILTER (WHERE start_at >= NOW())::int AS future,
      COUNT(*)::int AS total
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`\nACCEPTED appointments — past vs future (NOW=${new Date().toISOString()}):`);
  console.log(`  past:   ${past_future[0].past}`);
  console.log(`  future: ${past_future[0].future}`);
  console.log(`  total:  ${past_future[0].total}`);

  // Sample 10 ACCEPTED bookings whose start_at is in window but raw_json says rescheduled
  const reschedule_check = await prisma.$queryRaw`
    SELECT booking_id, start_at, updated_at,
           (raw_json->>'start_at')::timestamptz AS json_start
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND raw_json IS NOT NULL
      AND (raw_json->>'start_at')::timestamptz <> start_at
    LIMIT 10
  `;
  console.log(`\nACCEPTED bookings whose DB.start_at != raw_json.start_at (reschedule sync drift):`);
  console.log(`  found: ${reschedule_check.length} (showing up to 10)`);
  reschedule_check.forEach((r) => console.log(`  ${r.booking_id}  db=${r.start_at?.toISOString()} json=${r.json_start?.toISOString()}`));

  // How many would FALL OUT of window if we used raw_json.start_at?
  const drift_count = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND raw_json IS NOT NULL
      AND (
        ((raw_json->>'start_at')::timestamptz AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
            NOT BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      )
  `;
  console.log(`\nBookings in window per DB.start_at but raw_json.start_at puts them OUTSIDE window: ${drift_count[0].cnt}`);

  // Customer counts by location (just so we know the breadth)
  const by_loc = await prisma.$queryRaw`
    SELECT l.name, COUNT(*)::int AS cnt
    FROM bookings b
    JOIN locations l ON l.id = b.location_id
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY l.name ORDER BY cnt DESC
  `;
  console.log('\nACCEPTED bookings by location:');
  by_loc.forEach((r) => console.log(`  ${r.name}: ${r.cnt}`));

  // Check raw_json for "appointment_segments" length distribution (multi-service appts)
  const segs_per = await prisma.$queryRaw`
    SELECT seg_count, COUNT(*)::int AS bookings
    FROM (
      SELECT b.id,
             jsonb_array_length(COALESCE(b.raw_json->'appointment_segments','[]'::jsonb)) AS seg_count
      FROM bookings b
      WHERE b.status IN ('ACCEPTED','COMPLETED')
        AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    ) x
    GROUP BY seg_count ORDER BY seg_count
  `;
  console.log('\nDistribution: # of appointment_segments per booking:');
  segs_per.forEach((r) => console.log(`  ${r.seg_count} segments: ${r.bookings} bookings`));

  await prisma.$disconnect();
})();
