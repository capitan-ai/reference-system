const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // 1. Confirm column types changed
  const colTypes = await prisma.$queryRaw`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings'
      AND column_name IN ('start_at','created_at','updated_at')
    ORDER BY column_name
  `;
  console.log('bookings column types:');
  colTypes.forEach((c) => console.log(`  ${c.column_name}: ${c.data_type}`));

  // 2. Counts using single AT TZ (now correct)
  const single = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`\nACCEPTED+COMPLETED in window using SINGLE AT TZ (correct now): ${single[0].cnt}`);

  // 3. Counts using double AT TZ (now wrong)
  const double = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`Same query using DOUBLE AT TZ (wrong now): ${double[0].cnt}`);

  // 4. Sample row to verify the conversion produced expected UTC instants
  const sample = await prisma.$queryRaw`
    SELECT booking_id,
           start_at::text AS start_at_text,
           (start_at AT TIME ZONE 'America/Los_Angeles')::text AS la_text,
           (start_at AT TIME ZONE 'America/Los_Angeles')::date::text AS la_date
    FROM bookings
    WHERE booking_id = '16080zwhrqpscb'
  `;
  console.log('\nSample booking 16080zwhrqpscb (the one that exposed the bug):');
  console.log(`  start_at (UTC): ${sample[0].start_at_text}`);
  console.log(`  LA wall-clock:  ${sample[0].la_text}`);
  console.log(`  LA date:        ${sample[0].la_date}  (should be 2026-03-27, not 03-28)`);

  // 5. Each updated view returns reasonable counts
  const checks = [
    { name: 'analytics_appointments_by_location_daily', q: `SELECT SUM(accepted_appointments)::int AS v FROM analytics_appointments_by_location_daily WHERE date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'` },
    { name: 'analytics_overview_daily',                 q: `SELECT SUM(appointments_count)::int AS v FROM analytics_overview_daily WHERE date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'` },
    { name: 'analytics_master_performance_daily',       q: `SELECT SUM(appointments_count)::int AS v FROM analytics_master_performance_daily WHERE date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'` },
    { name: 'analytics_service_performance_daily',      q: `SELECT SUM(appointments_count)::int AS v FROM analytics_service_performance_daily WHERE date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'` },
    { name: 'analytics_customer_segments',              q: `SELECT SUM(returning_customers)::int AS v FROM analytics_customer_segments` },
    { name: 'v_master_salary_monthly',                  q: `SELECT COUNT(*)::int AS v FROM v_master_salary_monthly WHERE period = '2026-04'` },
    { name: 'model.fact_bookings_core',                 q: `SELECT COUNT(*)::int AS v FROM model.fact_bookings_core WHERE service_date_pacific BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'` },
    { name: 'analytics.analytics_overview_daily',       q: `SELECT SUM(bookings_count)::int AS v FROM analytics.analytics_overview_daily WHERE date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'` },
    { name: 'analytics.analytics_revenue_by_location_daily', q: `SELECT SUM(revenue_cents)::bigint AS v FROM analytics.analytics_revenue_by_location_daily WHERE date BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'` },
  ];
  console.log('\nView spot-checks (3/28-4/28 LA):');
  for (const c of checks) {
    try {
      const r = await prisma.$queryRawUnsafe(c.q);
      console.log(`  ${c.name}: ${r[0].v}`);
    } catch (e) {
      console.log(`  ${c.name}: ERROR — ${e.message.split('\n')[0]}`);
    }
  }

  await prisma.$disconnect();
})();
