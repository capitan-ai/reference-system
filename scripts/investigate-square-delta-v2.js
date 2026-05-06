const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Window: 2026-03-28 .. 2026-04-28 (LA local)');
  console.log('Square dashboard: 1,583 appointments\n');

  // Raw count
  const raw = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log(`Raw rows in window: ${raw[0].cnt}`);

  // Dedupe by canonical booking_id
  const dedup = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM (
      SELECT split_part(booking_id, '-', 1) AS canonical
      FROM bookings
      WHERE status IN ('ACCEPTED','COMPLETED')
        AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      GROUP BY split_part(booking_id, '-', 1)
    ) x
  `;
  console.log(`Distinct canonical booking_ids: ${dedup[0].cnt}`);

  // Look at one of the 3x canonical groups to understand the structure
  const dupSample = await prisma.$queryRaw`
    SELECT booking_id, status, start_at, version, customer_id, updated_at
    FROM bookings
    WHERE booking_id IN ('qit3za69iefcxg','qit3za69iefcxg-Y5ADBO3LEEC3VHGRUSJLTEPO','qit3za69iefcxg-RIIVWFTC2J3CW4XPEU5JRACIA4')
       OR booking_id LIKE 'qit3za69iefcxg-%'
    ORDER BY booking_id
  `;
  console.log('\nSample 3x group (qit3za69iefcxg):');
  dupSample.forEach((r) => console.log(`  ${r.booking_id}: status=${r.status} start=${r.start_at?.toISOString()} v${r.version} cust=${r.customer_id}`));

  // Are versioned rows always for same customer/start?
  const groupAnalysis = await prisma.$queryRaw`
    WITH groups AS (
      SELECT split_part(booking_id, '-', 1) AS canonical,
             COUNT(*) AS rows,
             COUNT(DISTINCT start_at) AS distinct_starts,
             COUNT(DISTINCT customer_id) AS distinct_customers,
             array_agg(DISTINCT status) AS statuses
      FROM bookings
      WHERE status IN ('ACCEPTED','COMPLETED')
        AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      GROUP BY split_part(booking_id, '-', 1)
      HAVING COUNT(*) > 1
    )
    SELECT
      COUNT(*)::int AS groups,
      SUM(rows)::int AS total_rows,
      SUM(rows - 1)::int AS extra_rows,
      COUNT(*) FILTER (WHERE distinct_starts > 1)::int AS groups_with_multiple_starts,
      COUNT(*) FILTER (WHERE distinct_customers > 1)::int AS groups_with_multiple_customers
    FROM groups
  `;
  console.log('\nDuplicate groups summary:');
  console.log(groupAnalysis[0]);

  // Bookings with no active segments — maybe Square excludes
  const noSegs = await prisma.$queryRaw`
    SELECT b.booking_id, b.status, b.start_at, b.customer_id, b.duration_minutes,
           jsonb_array_length(COALESCE(b.raw_json->'appointment_segments','[]'::jsonb)) AS payload_seg_count
    FROM bookings b
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND NOT EXISTS (
        SELECT 1 FROM booking_segments bs WHERE bs.booking_id = b.id AND bs.is_active = true
      )
    ORDER BY b.start_at
    LIMIT 10
  `;
  console.log('\nNo-active-segments bookings (sample 10):');
  noSegs.forEach((r) => console.log(`  ${r.booking_id}: ${r.start_at?.toISOString()} customer=${r.customer_id} dur=${r.duration_minutes} payload_segs=${r.payload_seg_count}`));

  // What we'd expect Square to show: dedupe + drop empty-segments?
  const proposed = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM (
      SELECT DISTINCT ON (split_part(b.booking_id, '-', 1)) b.id
      FROM bookings b
      WHERE b.status IN ('ACCEPTED','COMPLETED')
        AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
        AND EXISTS (
          SELECT 1 FROM booking_segments bs WHERE bs.booking_id = b.id AND bs.is_active = true
        )
      ORDER BY split_part(b.booking_id, '-', 1), b.version DESC, b.updated_at DESC
    ) x
  `;
  console.log(`\nDedup canonical + has-active-segments: ${proposed[0].cnt}`);

  // Just dedup canonical, don't filter segments
  const dedupOnly = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM (
      SELECT DISTINCT ON (split_part(b.booking_id, '-', 1)) b.id
      FROM bookings b
      WHERE b.status IN ('ACCEPTED','COMPLETED')
        AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      ORDER BY split_part(b.booking_id, '-', 1), b.version DESC, b.updated_at DESC
    ) x
  `;
  console.log(`Dedup canonical only:                 ${dedupOnly[0].cnt}`);

  await prisma.$disconnect();
})();
