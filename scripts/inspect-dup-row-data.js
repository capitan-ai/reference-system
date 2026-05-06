const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Compare core fields across all rows in each duplicate group
  const allDups = await prisma.$queryRaw`
    WITH dup_canonicals AS (
      SELECT split_part(booking_id, '-', 1) AS canonical
      FROM bookings
      WHERE status IN ('ACCEPTED','COMPLETED')
        AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      GROUP BY split_part(booking_id, '-', 1)
      HAVING COUNT(*) > 1
    )
    SELECT
      split_part(b.booking_id, '-', 1) AS canonical,
      b.booking_id,
      b.id::text AS row_uuid,
      b.start_at,
      b.status,
      b.version,
      b.customer_id,
      b.location_id::text AS location_id,
      b.created_at,
      b.updated_at,
      b.duration_minutes
    FROM bookings b
    WHERE split_part(b.booking_id, '-', 1) IN (SELECT canonical FROM dup_canonicals)
    ORDER BY canonical, length(b.booking_id), b.booking_id
  `;

  // Group rows by canonical and check whether canonical-id row matches the others
  const groups = new Map();
  allDups.forEach((r) => {
    if (!groups.has(r.canonical)) groups.set(r.canonical, []);
    groups.get(r.canonical).push(r);
  });

  console.log(`Total duplicate groups: ${groups.size}`);

  const anomalies = [];
  let allGood = 0;
  groups.forEach((rows, canonical) => {
    const canonicalRow = rows.find((r) => r.booking_id === canonical);
    if (!canonicalRow) {
      anomalies.push({ canonical, issue: 'no canonical-id row in group', rows });
      return;
    }
    const others = rows.filter((r) => r !== canonicalRow);
    for (const o of others) {
      const mismatches = [];
      if (o.start_at?.getTime() !== canonicalRow.start_at?.getTime()) mismatches.push('start_at');
      if (o.status !== canonicalRow.status) mismatches.push('status');
      if (o.customer_id !== canonicalRow.customer_id) mismatches.push('customer_id');
      if (o.location_id !== canonicalRow.location_id) mismatches.push('location_id');
      if (o.version !== canonicalRow.version) mismatches.push(`version(${o.version} vs ${canonicalRow.version})`);
      if (mismatches.length > 0) {
        anomalies.push({ canonical, suffix_id: o.booking_id, mismatches, canonical_row: canonicalRow, suffix_row: o });
      }
    }
    if (others.every((o) =>
      o.start_at?.getTime() === canonicalRow.start_at?.getTime()
      && o.status === canonicalRow.status
      && o.customer_id === canonicalRow.customer_id
      && o.location_id === canonicalRow.location_id
    )) {
      allGood++;
    }
  });

  console.log(`Groups where canonical-id matches all suffixed rows on (start_at, status, customer, location): ${allGood}`);
  console.log(`Anomalies: ${anomalies.length}`);
  anomalies.forEach((a) => {
    console.log(`\n  [${a.canonical}]`);
    if (a.issue) console.log(`    issue: ${a.issue}`);
    if (a.mismatches) {
      console.log(`    suffix=${a.suffix_id} mismatches: ${a.mismatches.join(', ')}`);
      console.log(`      canonical: start=${a.canonical_row.start_at?.toISOString()} status=${a.canonical_row.status} v${a.canonical_row.version} cust=${a.canonical_row.customer_id}`);
      console.log(`      suffix:    start=${a.suffix_row.start_at?.toISOString()} status=${a.suffix_row.status} v${a.suffix_row.version} cust=${a.suffix_row.customer_id}`);
    }
  });

  // Also: across the WHOLE table (not just the window), how many duplicate canonical groups exist?
  const wholeTable = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS dup_groups,
      SUM(rows_in_group - 1)::int AS extra_rows
    FROM (
      SELECT split_part(booking_id, '-', 1) AS canonical, COUNT(*)::int AS rows_in_group
      FROM bookings
      GROUP BY split_part(booking_id, '-', 1)
      HAVING COUNT(*) > 1
    ) x
  `;
  console.log(`\nWhole-table impact:`);
  console.log(`  Duplicate canonical groups: ${wholeTable[0].dup_groups}`);
  console.log(`  Extra (suffixed) rows that would be removed: ${wholeTable[0].extra_rows}`);

  // Whole-table dependents on the SUFFIXED rows specifically (these are the rows we'd delete)
  const dependentsOnSuffix = await prisma.$queryRaw`
    WITH suffix_rows AS (
      SELECT id
      FROM bookings
      WHERE booking_id LIKE '%-%'
        AND split_part(booking_id, '-', 1) IN (
          SELECT split_part(booking_id, '-', 1)
          FROM bookings
          GROUP BY split_part(booking_id, '-', 1)
          HAVING COUNT(*) > 1
        )
    )
    SELECT
      (SELECT COUNT(*) FROM order_line_items oli WHERE oli.booking_id IN (SELECT id FROM suffix_rows))::int AS oli_on_suffix,
      (SELECT COUNT(*) FROM orders o WHERE o.booking_id IN (SELECT id FROM suffix_rows))::int AS orders_on_suffix,
      (SELECT COUNT(*) FROM master_earnings_ledger mel WHERE mel.booking_id IN (SELECT id FROM suffix_rows))::int AS mel_on_suffix,
      (SELECT COUNT(*) FROM booking_segments bs WHERE bs.booking_id IN (SELECT id FROM suffix_rows))::int AS seg_on_suffix,
      (SELECT COUNT(*) FROM booking_snapshots bsn WHERE bsn.booking_id IN (SELECT id FROM suffix_rows))::int AS snap_on_suffix
  `;
  console.log(`  Dependents pointing AT to-be-deleted suffix rows (whole table):`);
  console.log(dependentsOnSuffix[0]);

  await prisma.$disconnect();
})();
