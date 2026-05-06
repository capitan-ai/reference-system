const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Confirm column type
  const colType = await prisma.$queryRaw`
    SELECT data_type, datetime_precision
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings' AND column_name='start_at'
  `;
  console.log('bookings.start_at column type:', colType[0]);

  // CORRECT conversion: start_at is stored as wall-clock UTC without TZ.
  // To get LA-local date: stamp as UTC first, then convert to LA wall-clock.
  const correct = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`\nACCEPTED+COMPLETED in 3/28-4/28 LA window (CORRECT double AT TZ): ${correct[0].cnt}`);

  // The previous (wrong) form
  const wrong = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`Same query, WRONG single AT TZ form (what I used earlier): ${wrong[0].cnt}`);

  // What does the analytics view say?
  const view = await prisma.$queryRaw`
    SELECT SUM(accepted_appointments)::int AS sum_accepted
    FROM analytics_appointments_by_location_daily
    WHERE date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`analytics_appointments_by_location_daily SUM(accepted_appointments): ${view[0].sum_accepted}  (note: this counts staff slots, not bookings)`);

  // View raw booking count without staff-slot multiplier — recompute
  const viewCorrected = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings b
    WHERE b.status = 'ACCEPTED'
      AND ((b.start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`Raw distinct ACCEPTED bookings (correct TZ): ${viewCorrected[0].cnt}`);

  // Status breakdown
  const breakdown = await prisma.$queryRaw`
    SELECT status, COUNT(*)::int AS cnt
    FROM bookings
    WHERE ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    GROUP BY status ORDER BY cnt DESC
  `;
  console.log('\nStatus breakdown (correct TZ):');
  let total = 0;
  breakdown.forEach((r) => { console.log(`  ${r.status}: ${r.cnt}`); total += r.cnt; });
  console.log(`  Total: ${total}`);

  // Distinct customers
  const dc = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT customer_id)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND customer_id IS NOT NULL
      AND ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`\nDistinct customers in window (correct TZ): ${dc[0].cnt}  (Square showed 1,203)`);

  // New / returning split with correct TZ
  const ret = await prisma.$queryRaw`
    WITH in_window AS (
      SELECT DISTINCT customer_id
      FROM bookings
      WHERE customer_id IS NOT NULL
        AND status IN ('ACCEPTED','COMPLETED')
        AND ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    ),
    prior AS (
      SELECT DISTINCT customer_id
      FROM bookings
      WHERE customer_id IS NOT NULL
        AND status IN ('ACCEPTED','COMPLETED')
        AND ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date
            < DATE '2026-03-28'
    )
    SELECT
      (SELECT COUNT(*) FROM in_window)::int AS total,
      (SELECT COUNT(*) FROM in_window i WHERE EXISTS (SELECT 1 FROM prior p WHERE p.customer_id = i.customer_id))::int AS returning,
      (SELECT COUNT(*) FROM in_window i WHERE NOT EXISTS (SELECT 1 FROM prior p WHERE p.customer_id = i.customer_id))::int AS new_clients
  `;
  console.log(`\nClient retention (correct TZ): total=${ret[0].total} returning=${ret[0].returning} new=${ret[0].new_clients}`);
  if (ret[0].total > 0) {
    console.log(`  Retention rate: ${(ret[0].returning / ret[0].total * 100).toFixed(1)}%`);
  }

  await prisma.$disconnect();
})();
