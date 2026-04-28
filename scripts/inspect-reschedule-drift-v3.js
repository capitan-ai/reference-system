const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const drifted = await prisma.$queryRaw`
    SELECT
      booking_id,
      start_at AS db_start,
      (raw_json->>'start_at')::timestamptz AS json_start,
      raw_json->>'start_at' AS json_start_text,
      status,
      version,
      updated_at,
      created_at,
      (start_at AT TIME ZONE 'America/Los_Angeles')::date AS db_la_date,
      ((raw_json->>'start_at')::timestamptz AT TIME ZONE 'America/Los_Angeles')::date AS json_la_date
    FROM bookings
    WHERE raw_json IS NOT NULL
      AND (raw_json->>'start_at')::timestamptz <> start_at
  `;
  console.log(`Truly drifted rows in DB: ${drifted.length}`);
  drifted.forEach((r) => {
    console.log(`  ${r.booking_id}: db=${r.db_start.toISOString()}  json=${r.json_start.toISOString()}`);
    console.log(`    status=${r.status}  version=${r.version}  updated=${r.updated_at?.toISOString()}  created=${r.created_at?.toISOString()}`);
    console.log(`    db_la_date=${r.db_la_date}  json_la_date=${r.json_la_date}`);
  });

  // Also: verify Square-comparison-window appointment count is the same with corrected TZ
  const counts = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('ACCEPTED','COMPLETED'))::int AS accepted,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('ACCEPTED','COMPLETED') AND start_at < NOW())::int AS past_accepted
    FROM bookings
    WHERE (start_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-28' AND DATE '2026-04-28'
  `;
  console.log('\n3/28-4/28 LA-window counts (CORRECTED conversion):');
  console.log(counts[0]);

  await prisma.$disconnect();
})();
