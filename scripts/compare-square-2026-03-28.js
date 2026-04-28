const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Square window (LA local): 2026-03-28 .. 2026-04-28 inclusive\n');

  // ===== NEW CLIENTS =====
  console.log('===== NEW CLIENTS =====');

  const ca_first_visit = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM customer_analytics
    WHERE (first_visit_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`customer_analytics.first_visit_at (any first visit): ${ca_first_visit[0].cnt}`);

  const ca_first_booking = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM customer_analytics
    WHERE (first_booking_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`customer_analytics.first_booking_at:                  ${ca_first_booking[0].cnt}`);

  const sec_first_visit = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM square_existing_clients
    WHERE (first_visit_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`square_existing_clients.first_visit_at:               ${sec_first_visit[0].cnt}`);

  // Square-style retention math (looking at appointments only).
  const retention = await prisma.$queryRaw`
    WITH in_window AS (
      SELECT DISTINCT customer_id
      FROM bookings
      WHERE customer_id IS NOT NULL
        AND status IN ('ACCEPTED','COMPLETED')
        AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    ),
    prior AS (
      SELECT DISTINCT customer_id
      FROM bookings
      WHERE customer_id IS NOT NULL
        AND status IN ('ACCEPTED','COMPLETED')
        AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
            < DATE '2026-03-28'
    )
    SELECT
      (SELECT COUNT(*) FROM in_window)::int AS total_in_window,
      (SELECT COUNT(*) FROM in_window i WHERE EXISTS (SELECT 1 FROM prior p WHERE p.customer_id = i.customer_id))::int AS returning,
      (SELECT COUNT(*) FROM in_window i WHERE NOT EXISTS (SELECT 1 FROM prior p WHERE p.customer_id = i.customer_id))::int AS new_clients
  `;
  console.log(`\nSquare-style retention math (using bookings only):`);
  console.log(`  Total clients in window: ${retention[0].total_in_window}`);
  console.log(`  Returning:               ${retention[0].returning}`);
  console.log(`  New:                     ${retention[0].new_clients}`);
  if (retention[0].total_in_window > 0) {
    const rate = (retention[0].returning / retention[0].total_in_window) * 100;
    console.log(`  Retention rate:          ${rate.toFixed(1)}%`);
  }

  // Same retention math but using ALL booking statuses (incl. CANCELLED, NO_SHOW)
  const retention_all = await prisma.$queryRaw`
    WITH in_window AS (
      SELECT DISTINCT customer_id
      FROM bookings
      WHERE customer_id IS NOT NULL
        AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    ),
    prior AS (
      SELECT DISTINCT customer_id
      FROM bookings
      WHERE customer_id IS NOT NULL
        AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
            < DATE '2026-03-28'
    )
    SELECT
      (SELECT COUNT(*) FROM in_window)::int AS total_in_window,
      (SELECT COUNT(*) FROM in_window i WHERE EXISTS (SELECT 1 FROM prior p WHERE p.customer_id = i.customer_id))::int AS returning,
      (SELECT COUNT(*) FROM in_window i WHERE NOT EXISTS (SELECT 1 FROM prior p WHERE p.customer_id = i.customer_id))::int AS new_clients
  `;
  console.log(`\nRetention math (ALL booking statuses):`);
  console.log(`  Total clients in window: ${retention_all[0].total_in_window}`);
  console.log(`  Returning:               ${retention_all[0].returning}`);
  console.log(`  New:                     ${retention_all[0].new_clients}`);
  if (retention_all[0].total_in_window > 0) {
    const rate = (retention_all[0].returning / retention_all[0].total_in_window) * 100;
    console.log(`  Retention rate:          ${rate.toFixed(1)}%`);
  }

  // ===== APPOINTMENTS =====
  console.log('\n===== APPOINTMENTS =====');

  const bk_all = await prisma.$queryRaw`
    SELECT status, COUNT(*)::int AS cnt
    FROM bookings
    WHERE (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY status ORDER BY cnt DESC
  `;
  console.log('All bookings by status (start_at in window):');
  let allTotal = 0;
  bk_all.forEach((r) => { console.log(`  ${r.status}: ${r.cnt}`); allTotal += r.cnt; });
  console.log(`  TOTAL (any status): ${allTotal}`);

  const bk_accepted = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`\nACCEPTED+COMPLETED only: ${bk_accepted[0].cnt}`);

  // Cross-check against the Square SDK staging table
  const sdk_all = await prisma.$queryRaw`
    SELECT status, COUNT(*)::int AS cnt
    FROM square_booking_sdk_snapshot
    WHERE (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY status ORDER BY cnt DESC
  `;
  console.log('\nSquare SDK staging snapshot (square_booking_sdk_snapshot):');
  let sdkTotal = 0;
  sdk_all.forEach((r) => { console.log(`  ${r.status}: ${r.cnt}`); sdkTotal += r.cnt; });
  console.log(`  TOTAL (any status): ${sdkTotal}`);

  // Bookings present in DB but not in SDK snapshot, or vice-versa
  const db_minus_sdk = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings b
    WHERE (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND NOT EXISTS (
        SELECT 1 FROM square_booking_sdk_snapshot s
        WHERE s.square_booking_id = b.booking_id
      )
  `;
  const sdk_minus_db = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM square_booking_sdk_snapshot s
    WHERE (s.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.booking_id = s.square_booking_id
      )
  `;
  console.log(`\nBookings in DB but missing from SDK snapshot: ${db_minus_sdk[0].cnt}`);
  console.log(`Bookings in SDK snapshot but missing from DB:  ${sdk_minus_db[0].cnt}`);

  // ===== PRE-BOOKING =====
  console.log('\n===== PRE-BOOKING =====');

  const creator_breakdown = await prisma.$queryRaw`
    SELECT creator_type, COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY creator_type ORDER BY cnt DESC
  `;
  console.log('Bookings by creator_type:');
  creator_breakdown.forEach((r) => console.log(`  ${r.creator_type}: ${r.cnt}`));

  // Pre-booked = booked on a different LA-day from the start
  const prebooked = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
                          > (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date)::int AS prebooked_diff_day,
      COUNT(*) FILTER (WHERE (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
                          = (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date)::int AS same_day,
      COUNT(*)::int AS total
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`\nPre-booked (created on prior LA-day vs start LA-day):`);
  console.log(`  Pre-booked: ${prebooked[0].prebooked_diff_day}`);
  console.log(`  Same-day:   ${prebooked[0].same_day}`);
  console.log(`  Total:      ${prebooked[0].total}`);
  if (prebooked[0].total > 0) {
    const rate = (prebooked[0].prebooked_diff_day / prebooked[0].total) * 100;
    console.log(`  Pre-book rate: ${rate.toFixed(1)}%`);
  }

  await prisma.$disconnect();
})();
