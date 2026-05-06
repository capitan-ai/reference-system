const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Hypothesis: Square dashboard was queried at time T1; our DB at T2 > T1.');
  console.log('Bookings cancelled between T1 and T2 still count as ACCEPTED in our snapshot.\n');

  // Snapshot stats now (today is 2026-04-29)
  const now = await prisma.$queryRaw`
    SELECT NOW() AS now, current_setting('TIMEZONE') AS tz
  `;
  console.log(`Now: ${now[0].now.toISOString()} (session TZ: ${now[0].tz})\n`);

  // Current count in window
  const cur = await prisma.$queryRaw`
    SELECT
      status,
      COUNT(*)::int AS cnt
    FROM bookings
    WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY status ORDER BY cnt DESC
  `;
  console.log('Current status breakdown for 3/28-4/28 window:');
  cur.forEach((r) => console.log(`  ${r.status}: ${r.cnt}`));
  const acceptedNow = cur.find((r) => r.status === 'ACCEPTED')?.cnt || 0;
  console.log(`  Total ACCEPTED now: ${acceptedNow}`);

  // Bookings whose status was changed (updated_at) AFTER 2026-04-28 18:30 UTC
  // (the approximate time we queried yesterday — Square's dashboard pull was likely earlier)
  const recentChanges = await prisma.$queryRaw`
    SELECT
      booking_id,
      status,
      start_at,
      updated_at,
      raw_json->>'status' AS json_status,
      version
    FROM bookings
    WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND updated_at >= TIMESTAMPTZ '2026-04-28 18:30:00+00'
    ORDER BY updated_at DESC
    LIMIT 50
  `;
  console.log(`\nIn-window bookings with updated_at after 2026-04-28 18:30 UTC: ${recentChanges.length}`);
  const byStatus = {};
  recentChanges.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  console.log('  Status breakdown:', byStatus);

  // Count of bookings that were ACCEPTED at our T2 snapshot (yesterday at ~18:30Z)
  // but transitioned to CANCELLED after that
  const flippedToCancel = await prisma.$queryRaw`
    SELECT
      booking_id,
      status,
      (start_at AT TIME ZONE 'America/Los_Angeles')::date AS la_date,
      updated_at,
      version
    FROM bookings
    WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND status IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SELLER')
      AND updated_at >= TIMESTAMPTZ '2026-04-28 18:30:00+00'
    ORDER BY updated_at DESC
  `;
  console.log(`\nIn-window bookings cancelled AFTER 2026-04-28 18:30 UTC: ${flippedToCancel.length}`);
  flippedToCancel.forEach((r) => console.log(`  ${r.booking_id}: status=${r.status} start_la_date=${r.la_date.toISOString().slice(0,10)} updated=${r.updated_at?.toISOString()} v${r.version}`));

  // Try multiple plausible "Square dashboard pull" times for context
  console.log('\nIf Square dashboard was pulled at various times, how many bookings cancelled since:');
  for (const cutoff of [
    '2026-04-28 12:00:00+00',
    '2026-04-28 18:00:00+00',
    '2026-04-28 23:59:00+00',
  ]) {
    const r = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM bookings
      WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
        AND status IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SELLER')
        AND updated_at >= TIMESTAMPTZ '${cutoff}'
    `);
    console.log(`  cancellations since ${cutoff}: ${r[0].cnt}`);
  }

  // Square's 1583 vs our 1593 → could 10 bookings have cancelled between Square's pull and ours?
  // Look at cancellations where the booking start_at was in window AND the cancellation
  // happened during 4/28 (Square may have queried mid-day)
  const cancelOn428 = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE updated_at::date = DATE '2026-04-28')::int AS cancelled_on_428,
      COUNT(*) FILTER (WHERE updated_at >= TIMESTAMPTZ '2026-04-28 00:00:00+00' AND updated_at < TIMESTAMPTZ '2026-04-28 12:00:00+00')::int AS cancelled_428_morning_utc,
      COUNT(*) FILTER (WHERE updated_at >= TIMESTAMPTZ '2026-04-28 12:00:00+00' AND updated_at < TIMESTAMPTZ '2026-04-29 00:00:00+00')::int AS cancelled_428_afternoon_utc
    FROM bookings
    WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND status IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SELLER')
  `;
  console.log('\nCancellations of in-window bookings, grouped by when they were marked cancelled:');
  console.log(cancelOn428[0]);

  await prisma.$disconnect();
})();
