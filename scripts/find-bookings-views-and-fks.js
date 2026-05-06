const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // 1. Find every view that references the bookings table in live DB
  const views = await prisma.$queryRaw`
    SELECT n.nspname AS schema, c.relname AS view_name,
           CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' END AS kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('v','m')
      AND n.nspname = 'public'
      AND pg_get_viewdef(c.oid, true) ILIKE '%bookings%'
    ORDER BY c.relname
  `;
  console.log(`Views/matviews referencing 'bookings' (${views.length}):`);
  views.forEach((v) => console.log(`  ${v.schema}.${v.view_name} [${v.kind}]`));

  // 2. FK references to bookings.id (UUID PK)
  const fks = await prisma.$queryRaw`
    SELECT
      tc.table_name AS dependent_table,
      kcu.column_name AS dependent_column,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'bookings'
      AND ccu.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name
  `;
  console.log(`\nForeign keys pointing AT bookings (${fks.length}):`);
  fks.forEach((f) => console.log(`  ${f.dependent_table}.${f.dependent_column} -> bookings.${f.referenced_column}  (on delete: ${f.delete_rule})`));

  // 3. For each duplicate canonical group: what is in dependent tables for the duplicate (-SUFFIX) rows?
  const dupRows = await prisma.$queryRaw`
    SELECT
      split_part(b.booking_id, '-', 1) AS canonical,
      b.id AS row_uuid,
      b.booking_id,
      b.version,
      b.updated_at,
      (SELECT COUNT(*) FROM order_line_items oli WHERE oli.booking_id = b.id)::int AS oli_count,
      (SELECT COUNT(*) FROM orders o WHERE o.booking_id = b.id)::int AS order_count,
      (SELECT COUNT(*) FROM master_earnings_ledger mel WHERE mel.booking_id = b.id)::int AS mel_count,
      (SELECT COUNT(*) FROM booking_segments bs WHERE bs.booking_id = b.id)::int AS seg_count,
      (SELECT COUNT(*) FROM booking_snapshots bsn WHERE bsn.booking_id = b.id)::int AS snap_count
    FROM bookings b
    WHERE split_part(b.booking_id, '-', 1) IN (
      SELECT split_part(booking_id, '-', 1)
      FROM bookings
      WHERE status IN ('ACCEPTED','COMPLETED')
        AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      GROUP BY split_part(booking_id, '-', 1)
      HAVING COUNT(*) > 1
    )
    ORDER BY canonical, b.booking_id
  `;
  console.log(`\nDependent-row counts for the 26 duplicate groups (showing all ${dupRows.length} rows):`);
  let lastCanonical = null;
  dupRows.forEach((r) => {
    if (r.canonical !== lastCanonical) {
      console.log(`\n  [${r.canonical}]`);
      lastCanonical = r.canonical;
    }
    console.log(`    ${r.booking_id.padEnd(60)}  v${r.version} oli=${r.oli_count} ord=${r.order_count} mel=${r.mel_count} seg=${r.seg_count} snap=${r.snap_count}`);
  });

  await prisma.$disconnect();
})();
