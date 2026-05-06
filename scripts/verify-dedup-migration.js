const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // 1. Verify the unique index exists
  const idx = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'bookings' AND indexname = 'bookings_org_canonical_unique'
  `;
  console.log('Unique index check:');
  idx.forEach((i) => console.log(`  ${i.indexname}: ${i.indexdef}`));

  // 2. Verify each updated view now contains the canonical_bookings CTE
  const views = [
    'analytics_customer_segments',
    'analytics_master_performance_daily',
    'analytics_service_performance_daily',
    'analytics_overview_daily',
    'v_master_salary_monthly',
  ];
  console.log('\nView dedup-CTE check:');
  for (const v of views) {
    const def = await prisma.$queryRawUnsafe(
      `SELECT pg_get_viewdef('public.${v}'::regclass, true) AS def`
    );
    const hasCte = def[0].def.includes('canonical_bookings');
    console.log(`  ${v}: ${hasCte ? '✅ has canonical_bookings CTE' : '❌ missing!'}`);
  }

  // 3. Re-run appointment count to confirm post-cleanup numbers
  const counts = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total_in_window,
      COUNT(*) FILTER (WHERE status IN ('ACCEPTED','COMPLETED'))::int AS accepted,
      COUNT(*) FILTER (WHERE start_at < NOW() AND status IN ('ACCEPTED','COMPLETED'))::int AS past_accepted
    FROM bookings
    WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log('\nPost-cleanup counts in 3/28-4/28 window:');
  console.log(counts[0]);

  // 4. Confirm zero duplicates remain
  const dups = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS dup_groups
    FROM (
      SELECT split_part(booking_id, '-', 1)
      FROM bookings
      GROUP BY split_part(booking_id, '-', 1)
      HAVING COUNT(*) > 1
    ) x
  `;
  console.log(`\nDuplicate canonical groups remaining: ${dups[0].dup_groups}`);

  // 5. Confirm appointment view returns the same window count
  const viewCount = await prisma.$queryRaw`
    SELECT SUM(accepted_appointments)::int AS total
    FROM analytics_appointments_by_location_daily
    WHERE date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`analytics_appointments_by_location_daily SUM(accepted) for window: ${viewCount[0].total}`);

  await prisma.$disconnect();
})();
