const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Functions referencing start_at (skip aggregates which can't be introspected this way)
  const fns = await prisma.$queryRaw`
    SELECT n.nspname AS schema, p.proname AS function_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind = 'f'
      AND n.nspname = 'public'
      AND pg_get_functiondef(p.oid) ILIKE '%bookings%'
      AND pg_get_functiondef(p.oid) ILIKE '%start_at%'
  `;
  console.log(`Functions referencing bookings.start_at: ${fns.length}`);
  fns.forEach((f) => console.log(`  ${f.schema}.${f.function_name}`));

  // Triggers on bookings
  const trigs = await prisma.$queryRaw`
    SELECT t.tgname, c.relname AS table_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
      AND c.relname = 'bookings'
  `;
  console.log(`\nTriggers on bookings table: ${trigs.length}`);
  trigs.forEach((t) => console.log(`  ${t.tgname}`));

  // Materialized views referencing bookings (those would fail if dropped naively)
  const matviews = await prisma.$queryRaw`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'm'
      AND n.nspname = 'public'
      AND pg_get_viewdef(c.oid, true) ILIKE '%bookings%'
  `;
  console.log(`\nMaterialized views referencing bookings: ${matviews.length}`);
  matviews.forEach((m) => console.log(`  ${m.relname}`));

  // RLS policies on bookings
  const rls = await prisma.$queryRaw`
    SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
    FROM pg_policy
    WHERE polrelid = 'public.bookings'::regclass
  `;
  console.log(`\nRLS policies on bookings: ${rls.length}`);
  rls.forEach((r) => console.log(`  ${r.polname}: ${r.using_expr}`));

  // Pre-migration baseline counts (using CORRECT current double-AT-TZ form for timestamp_no_tz)
  const baselines = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total_bookings,
      COUNT(*) FILTER (WHERE status IN ('ACCEPTED','COMPLETED'))::int AS accepted,
      COUNT(*) FILTER (
        WHERE status IN ('ACCEPTED','COMPLETED')
          AND ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date
              BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      )::int AS accepted_in_window,
      COUNT(DISTINCT customer_id) FILTER (
        WHERE status IN ('ACCEPTED','COMPLETED')
          AND customer_id IS NOT NULL
          AND ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date
              BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      )::int AS distinct_customers_in_window
    FROM bookings
  `;
  console.log('\nPre-migration baseline (double AT TZ on timestamp_no_tz — correct now):');
  console.log(baselines[0]);

  // Same calc with single AT TZ — what it WOULD be after migration
  const post = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (
        WHERE status IN ('ACCEPTED','COMPLETED')
          AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
              BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      )::int AS accepted_in_window_simulated_post_migration
    FROM bookings
  `;
  console.log('Same query with SINGLE AT TZ (this would be wrong now, correct post-migration):');
  console.log(post[0]);
  console.log('\n^ These two MUST match after the migration runs (1597 vs 1597 expected).');

  await prisma.$disconnect();
})();
