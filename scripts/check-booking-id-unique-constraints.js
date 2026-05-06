const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Find unique constraints / PKs that include booking_id or original_booking_id
  const uniques = await prisma.$queryRaw`
    SELECT
      tc.table_name,
      tc.constraint_type,
      tc.constraint_name,
      string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS cols
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
      AND tc.table_schema = 'public'
      AND EXISTS (
        SELECT 1 FROM information_schema.key_column_usage kcu2
        WHERE kcu2.constraint_name = tc.constraint_name
          AND kcu2.table_schema = tc.table_schema
          AND kcu2.column_name IN ('booking_id','original_booking_id')
      )
    GROUP BY tc.table_name, tc.constraint_type, tc.constraint_name
    ORDER BY tc.table_name
  `;
  console.log('Unique/PK constraints involving booking_id:');
  uniques.forEach((u) => console.log(`  ${u.table_name}.${u.constraint_name} (${u.constraint_type}): ${u.cols}`));

  // For each duplicate group, identify if BOTH canonical and suffix have rows
  // in admin_created_booking_facts (or any table where booking_id is unique)
  const conflictCheck = await prisma.$queryRaw`
    WITH dup_groups AS (
      SELECT split_part(booking_id, '-', 1) AS canonical
      FROM bookings
      GROUP BY split_part(booking_id, '-', 1)
      HAVING COUNT(*) > 1
    ),
    canonical_rows AS (
      SELECT b.id AS canonical_id, b.booking_id AS canonical
      FROM bookings b
      JOIN dup_groups dg ON dg.canonical = b.booking_id
    ),
    suffix_rows AS (
      SELECT b.id AS suffix_id, split_part(b.booking_id, '-', 1) AS canonical
      FROM bookings b
      WHERE b.booking_id LIKE '%-%'
        AND split_part(b.booking_id, '-', 1) IN (SELECT canonical FROM dup_groups)
    )
    SELECT
      'admin_created_booking_facts' AS table_name,
      COUNT(*) FILTER (WHERE canon_has IS NOT NULL AND suffix_has > 0)::int AS both_have,
      COUNT(*) FILTER (WHERE canon_has IS NULL AND suffix_has > 0)::int AS only_suffix_has,
      COUNT(*) FILTER (WHERE canon_has IS NOT NULL AND suffix_has = 0)::int AS only_canon_has
    FROM (
      SELECT
        cr.canonical_id,
        cr.canonical,
        (SELECT COUNT(*) FROM admin_created_booking_facts a WHERE a.booking_id = cr.canonical_id) AS canon_has_count,
        (SELECT cr.canonical_id FROM admin_created_booking_facts a WHERE a.booking_id = cr.canonical_id LIMIT 1) AS canon_has,
        (SELECT COUNT(*) FROM admin_created_booking_facts a WHERE a.booking_id IN (SELECT suffix_id FROM suffix_rows sr WHERE sr.canonical = cr.canonical))::int AS suffix_has
      FROM canonical_rows cr
    ) x
  `;
  console.log('\nadmin_created_booking_facts conflict matrix:');
  console.log(conflictCheck[0]);

  await prisma.$disconnect();
})();
