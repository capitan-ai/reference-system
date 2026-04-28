const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Window matches the Square comparison
  const drift = await prisma.$queryRaw`
    SELECT
      b.booking_id,
      b.start_at AS db_start,
      (b.raw_json->>'start_at')::timestamptz AS json_start,
      b.version AS db_version,
      (b.raw_json->>'version')::int AS json_version,
      b.status AS db_status,
      (b.raw_json->>'status') AS json_status,
      b.updated_at AS db_updated,
      (b.raw_json->>'updated_at')::timestamptz AS json_updated,
      b.created_at,
      jsonb_array_length(COALESCE(b.raw_json->'appointment_segments','[]'::jsonb)) AS seg_count
    FROM bookings b
    WHERE b.status IN ('ACCEPTED','COMPLETED')
      AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
      AND b.raw_json IS NOT NULL
      AND ((b.raw_json->>'start_at')::timestamptz AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          NOT BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
    ORDER BY b.updated_at DESC
    LIMIT 20
  `;

  console.log(`Found drifted rows; showing up to 20:\n`);
  drift.forEach((r, i) => {
    console.log(`${i + 1}. ${r.booking_id}`);
    console.log(`   db.start_at=${r.db_start.toISOString()}  json.start_at=${r.json_start?.toISOString()}`);
    console.log(`   db.status=${r.db_status}  json.status=${r.json_status}`);
    console.log(`   db.version=${r.db_version}  json.version=${r.json_version}`);
    console.log(`   db.updated_at=${r.db_updated?.toISOString()}  json.updated_at=${r.json_updated?.toISOString()}`);
    console.log(`   created_at=${r.created_at?.toISOString()}  segs=${r.seg_count}`);
    console.log();
  });

  // Also: how many drifted total?
  const totals = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE
        (b.raw_json->>'start_at')::timestamptz <> b.start_at
      )::int AS drift_any,
      COUNT(*) FILTER (WHERE
        (b.raw_json->>'start_at')::timestamptz IS NOT NULL
        AND ((b.raw_json->>'start_at')::timestamptz AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
            <> (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
      )::int AS drift_la_day,
      COUNT(*) FILTER (WHERE (b.raw_json->>'version')::int <> b.version)::int AS version_drift,
      COUNT(*) FILTER (WHERE (b.raw_json->>'status') <> b.status)::int AS status_drift,
      COUNT(*)::int AS total
    FROM bookings b
    WHERE b.raw_json IS NOT NULL
  `;
  console.log('Whole-table drift counts:');
  console.log(totals[0]);

  await prisma.$disconnect();
})();
