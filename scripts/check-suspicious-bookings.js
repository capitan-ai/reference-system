const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // 1. The 35 pre-6am LA bookings on 3/28 — what time exactly, and what raw_json.start_at says
  const earlyBookings = await prisma.$queryRaw`
    SELECT booking_id,
           start_at,
           (start_at AT TIME ZONE 'America/Los_Angeles') AS la_time,
           raw_json->>'start_at' AS json_start_text,
           customer_id, source, creator_type, status
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-03-28'
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::time < TIME '06:00'
    ORDER BY start_at
    LIMIT 20
  `;
  console.log(`Pre-6am LA bookings on 3/28 (showing up to 20):`);
  earlyBookings.forEach((r) => {
    console.log(`  ${r.booking_id}: db=${r.start_at?.toISOString()} la=${r.la_time?.toISOString()}  source=${r.source} status=${r.status}`);
    console.log(`    raw_json.start_at_text="${r.json_start_text}"`);
  });

  // Wait — does any booking actually start before 6am? Or is this a timezone artifact?
  const distribution = await prisma.$queryRaw`
    SELECT
      EXTRACT(HOUR FROM (start_at AT TIME ZONE 'America/Los_Angeles'))::int AS la_hour,
      COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'America/Los_Angeles')::date = DATE '2026-03-28'
    GROUP BY la_hour ORDER BY la_hour
  `;
  console.log(`\n3/28 hour-of-day distribution (LA):`);
  distribution.forEach((r) => console.log(`  ${String(r.la_hour).padStart(2,'0')}:00 — ${r.cnt}`));

  // 2. Double-check: this is normal for nail salons, OR the data is wrong
  // Look at ALL days, what's the typical earliest-booking distribution?
  const earliestPerDay = await prisma.$queryRaw`
    SELECT
      la_date,
      MIN(la_time) AS earliest_start,
      COUNT(*) FILTER (WHERE la_time < TIME '08:00')::int AS pre_8am,
      COUNT(*)::int AS total
    FROM (
      SELECT (start_at AT TIME ZONE 'America/Los_Angeles')::date AS la_date,
             (start_at AT TIME ZONE 'America/Los_Angeles')::time AS la_time
      FROM bookings
      WHERE status IN ('ACCEPTED','COMPLETED')
        AND (start_at AT TIME ZONE 'America/Los_Angeles')::date
            BETWEEN DATE '2026-03-25' AND DATE '2026-04-05'
    ) x
    GROUP BY la_date
    ORDER BY la_date
  `;
  console.log(`\nEarliest start time per day (3/25-4/5):`);
  earliestPerDay.forEach((r) => console.log(`  ${r.la_date.toISOString().slice(0,10)}: earliest=${r.earliest_start} pre_8am=${r.pre_8am}/${r.total}`));

  await prisma.$disconnect();
})();
