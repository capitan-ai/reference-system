const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Window: 2026-03-28 .. 2026-04-28 (LA local)\n');
  console.log('Square dashboard: 1,583 appointments');
  console.log('Our DB count to be reconciled.\n');

  // 1. Baseline: ACCEPTED+COMPLETED in window
  const baseline = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`1) ACCEPTED+COMPLETED, start_at LA-day in window: ${baseline[0].cnt}`);

  // 2. Strip bookings with no customer_id (internal blocks / test)
  const no_customer = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND customer_id IS NULL
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`2) ...with NULL customer_id (would Square exclude?): ${no_customer[0].cnt}`);

  // 3. Bookings whose customer was deleted/missing in square_existing_clients
  const missing_customer = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings b
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND b.customer_id IS NOT NULL
      AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND NOT EXISTS (
        SELECT 1 FROM square_existing_clients c
        WHERE c.square_customer_id = b.customer_id
          AND c.organization_id = b.organization_id
      )
  `;
  console.log(`3) ...whose customer is NOT in square_existing_clients: ${missing_customer[0].cnt}`);

  // 4. By location — does Square include all locations? Maybe one is excluded
  const by_loc = await prisma.$queryRaw`
    SELECT l.name, l.square_location_id, COUNT(*)::int AS cnt
    FROM bookings b
    JOIN locations l ON l.id = b.location_id
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY l.name, l.square_location_id ORDER BY cnt DESC
  `;
  console.log('\n4) By location:');
  by_loc.forEach((r) => console.log(`   ${r.name} (${r.square_location_id}): ${r.cnt}`));

  // 5. Check: bookings whose raw_json status differs from DB status
  // (e.g., we wrote ACCEPTED but Square is now CANCELLED)
  const status_drift = await prisma.$queryRaw`
    SELECT booking_id, status AS db_status, raw_json->>'status' AS json_status, updated_at
    FROM bookings b
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND b.raw_json IS NOT NULL
      AND b.raw_json->>'status' IS NOT NULL
      AND b.raw_json->>'status' <> b.status
    ORDER BY updated_at DESC
    LIMIT 10
  `;
  console.log(`\n5) Status drift (DB.status != raw_json.status): ${status_drift.length} (showing up to 10)`);
  status_drift.forEach((r) => console.log(`   ${r.booking_id}: db=${r.db_status} json=${r.json_status} updated=${r.updated_at?.toISOString()}`));

  // 6. Bookings created in window but for visits that are actually OUTSIDE — sanity
  const created_window = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (created_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`\n6) Bookings CREATED in window (any future start): ${created_window[0].cnt}`);

  // 7. Distinct customers in window
  const distinct_cust = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT customer_id)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND customer_id IS NOT NULL
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`\n7) Distinct customers in window: ${distinct_cust[0].cnt}  (Square showed 1,203)`);

  // 8. Did anyone have multiple booking rows for the same Square booking id?
  // (versioned booking_id with -SUFFIX duplication)
  const dup_booking_ids = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND booking_id LIKE '%-%'
  `;
  console.log(`\n8) Versioned booking_id rows (booking_id has '-SUFFIX'): ${dup_booking_ids[0].cnt}`);

  // 9. Multiple ACCEPTED rows for same canonical Square booking_id
  const dup_canonical = await prisma.$queryRaw`
    SELECT split_part(booking_id, '-', 1) AS canonical, COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY split_part(booking_id, '-', 1)
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 10
  `;
  console.log(`\n9) Same canonical booking_id appearing multiple times in window: ${dup_canonical.length}`);
  dup_canonical.forEach((r) => console.log(`   ${r.canonical}: ${r.cnt} rows`));

  // 10. Bookings whose start_at LA-day is right at the boundary (3/28 or 4/28)
  // Square may use a different cutoff or inclusive/exclusive end
  const boundary = await prisma.$queryRaw`
    SELECT (start_at AT TIME ZONE 'America/Los_Angeles')::date AS la_day, COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date IN (DATE '2026-03-27', DATE '2026-03-28', DATE '2026-04-28', DATE '2026-04-29')
    GROUP BY la_day ORDER BY la_day
  `;
  console.log('\n10) Boundary days:');
  boundary.forEach((r) => console.log(`   ${r.la_day.toISOString().slice(0,10)}: ${r.cnt}`));

  // 11. Bookings without any active segments
  const no_segs = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings b
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND NOT EXISTS (
        SELECT 1 FROM booking_segments bs WHERE bs.booking_id = b.id AND bs.is_active = true
      )
  `;
  console.log(`\n11) Bookings with NO active booking_segments: ${no_segs[0].cnt}`);

  // 12. Also: 0 segments in raw_json appointment_segments
  const zero_payload_segs = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND COALESCE(jsonb_array_length(raw_json->'appointment_segments'), 0) = 0
  `;
  console.log(`12) Bookings with EMPTY raw_json.appointment_segments: ${zero_payload_segs[0].cnt}`);

  // 13. Source breakdown
  const src = await prisma.$queryRaw`
    SELECT source, COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY source ORDER BY cnt DESC
  `;
  console.log('\n13) By source:');
  src.forEach((r) => console.log(`   ${r.source ?? 'NULL'}: ${r.cnt}`));

  await prisma.$disconnect();
})();
