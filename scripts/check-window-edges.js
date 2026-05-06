const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // 1. All locations we have, and their booking counts in window
  const locs = await prisma.$queryRaw`
    SELECT l.name, l.id::text AS id, l.square_location_id,
           COUNT(b.*)::int AS bookings_in_window,
           COUNT(b.*) FILTER (WHERE b.status IN ('ACCEPTED','COMPLETED'))::int AS accepted_in_window
    FROM locations l
    LEFT JOIN bookings b
      ON b.location_id = l.id
     AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
         BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY l.name, l.id, l.square_location_id
    ORDER BY accepted_in_window DESC NULLS LAST
  `;
  console.log('All locations, in-window booking counts:');
  locs.forEach((l) => console.log(`  ${l.name}  square_id=${l.square_location_id}  total=${l.bookings_in_window}  accepted=${l.accepted_in_window}`));

  // 2. Window edge — first hour of LA 3/28 and last hour of LA 4/28
  const edges = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (
        WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-03-28'
          AND (start_at AT TIME ZONE 'America/Los_Angeles')::time < TIME '06:00'
      )::int AS la_328_pre6am,
      COUNT(*) FILTER (
        WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-04-28'
          AND (start_at AT TIME ZONE 'America/Los_Angeles')::time >= TIME '20:00'
      )::int AS la_428_post8pm,
      COUNT(*) FILTER (
        WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-04-28'
      )::int AS la_428_total,
      COUNT(*) FILTER (
        WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-03-28'
      )::int AS la_328_total
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
  `;
  console.log('\nBoundary-day distribution (LA local):');
  console.log(edges[0]);

  // 3. UTC-vs-LA boundary check — are there bookings between LA-3/28 00:00 and UTC-3/28 00:00?
  //    These would be IN window per LA but might be excluded if Square uses UTC.
  const tzBoundary = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (
        WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
          AND (start_at AT TIME ZONE 'UTC')::date NOT BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      )::int AS la_in_utc_out,
      COUNT(*) FILTER (
        WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date NOT BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
          AND (start_at AT TIME ZONE 'UTC')::date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      )::int AS utc_in_la_out
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
  `;
  console.log('\nLA-window vs UTC-window mismatch (could indicate timezone interpretation difference):');
  console.log(tzBoundary[0]);

  // 4. A different angle: bookings whose customer was deleted/merged. Square may exclude bookings
  // for merged customers; we don't.
  const mergedCust = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings b
    JOIN square_existing_clients c
      ON c.square_customer_id = b.customer_id
     AND c.organization_id = b.organization_id
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND (c.creation_source = 'MERGE' OR c.merged_from_customer_id IS NOT NULL)
  `;
  console.log(`\nIn-window bookings whose customer was MERGE-created or has merged_from_customer_id: ${mergedCust[0].cnt}`);

  // 5. Bookings created by API source (could be self-bookings or test)
  const sourceBreakdown = await prisma.$queryRaw`
    SELECT source, creator_type, COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY source, creator_type
    ORDER BY cnt DESC
  `;
  console.log('\nIn-window bookings by source × creator_type:');
  sourceBreakdown.forEach((r) => console.log(`  source=${r.source ?? 'NULL'}  creator=${r.creator_type ?? 'NULL'}: ${r.cnt}`));

  // 6. Try simulated counts: what if we excluded the 41 future-time bookings that hadn't started yet at Square's pull time?
  // (Yesterday at 18:30 UTC = 11:30 LA)
  const futureAtPull = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND start_at >= TIMESTAMPTZ '2026-04-28 18:30:00+00'
  `;
  console.log(`\nIn-window bookings whose start_at was AFTER 2026-04-28 18:30 UTC (11:30 LA): ${futureAtPull[0].cnt}`);
  console.log('(These were "future" at our snapshot time but may also be "future" from Square dashboard\'s perspective — depending on when it was pulled.)');

  await prisma.$disconnect();
})();
