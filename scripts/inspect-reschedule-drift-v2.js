const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Check the three named examples from the memory
  const named = await prisma.$queryRaw`
    SELECT
      booking_id,
      start_at,
      raw_json->>'start_at' AS json_start_str,
      version,
      raw_json->>'version' AS json_version_str,
      status,
      updated_at
    FROM bookings
    WHERE booking_id IN ('h27zy4xkvrsrrd','s1lli90jdof4ep','9y9ybgcmz7xq0v')
       OR booking_id LIKE 'h27zy4xkvrsrrd-%'
       OR booking_id LIKE 's1lli90jdof4ep-%'
       OR booking_id LIKE '9y9ybgcmz7xq0v-%'
    ORDER BY booking_id, start_at
  `;
  console.log('Memory-cited bookings (now):');
  named.forEach((r) => {
    console.log(`  ${r.booking_id}`);
    console.log(`    db.start_at=${r.start_at?.toISOString()}  json.start_at_str=${r.json_start_str}`);
    console.log(`    version=${r.version} (json=${r.json_version_str}) status=${r.status} updated=${r.updated_at?.toISOString()}`);
  });

  // Sample raw JSON strings to understand the format
  const sample = await prisma.$queryRaw`
    SELECT
      booking_id,
      start_at::text AS db_start_text,
      raw_json->>'start_at' AS json_start_str
    FROM bookings
    WHERE raw_json IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 5
  `;
  console.log('\nRecent rows (string-form comparison):');
  sample.forEach((r) => {
    console.log(`  ${r.booking_id}: db="${r.db_start_text}"  json="${r.json_start_str}"`);
  });

  // Re-run drift query the CORRECT way
  // Key fix: use AT TIME ZONE 'America/Los_Angeles' once on a timestamptz to get LA local timestamp
  const totalsCorrect = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE
        (b.raw_json->>'start_at')::timestamptz <> b.start_at
      )::int AS exact_drift,
      COUNT(*) FILTER (WHERE
        (b.raw_json->>'start_at')::timestamptz IS NOT NULL
        AND ((b.raw_json->>'start_at')::timestamptz AT TIME ZONE 'America/Los_Angeles')::date
            <> (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
      )::int AS la_day_drift,
      COUNT(*)::int AS total_with_json
    FROM bookings b
    WHERE b.raw_json IS NOT NULL
  `;
  console.log('\nDrift counts (CORRECTED conversion):');
  console.log(totalsCorrect[0]);

  // Drift LIMITED to bookings that are still ACCEPTED/COMPLETED with start in our 30-day window
  const windowDrift = await prisma.$queryRaw`
    SELECT
      booking_id,
      start_at AS db_start,
      (raw_json->>'start_at')::timestamptz AS json_start,
      version,
      updated_at
    FROM bookings b
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND (b.start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND b.raw_json IS NOT NULL
      AND (b.raw_json->>'start_at')::timestamptz <> b.start_at
    ORDER BY b.updated_at DESC
    LIMIT 30
  `;
  console.log(`\nIn-window ACCEPTED bookings whose start_at != raw_json.start_at: ${windowDrift.length}`);
  windowDrift.forEach((r) => {
    console.log(`  ${r.booking_id}: db=${r.db_start.toISOString()}  json=${r.json_start.toISOString()}  v${r.version}`);
  });

  await prisma.$disconnect();
})();
