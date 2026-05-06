const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Print as text directly to avoid JS Date interpretation
  const r = await prisma.$queryRaw`
    SELECT
      '2026-03-27T17:00:00Z'::timestamptz AS test_utc,
      ('2026-03-27T17:00:00Z'::timestamptz AT TIME ZONE 'America/Los_Angeles')::text AS test_la,
      ('2026-03-27T17:00:00Z'::timestamptz AT TIME ZONE 'America/Los_Angeles')::date AS test_la_date,
      ('2026-03-27T17:00:00Z'::timestamptz AT TIME ZONE 'UTC')::text AS test_utc_repr
  `;
  console.log('Postgres conversion sanity check:');
  console.log(r[0]);

  // Now check actual DB row using text format
  const actual = await prisma.$queryRaw`
    SELECT
      booking_id,
      start_at::text AS db_start_text,
      (start_at AT TIME ZONE 'America/Los_Angeles')::text AS la_text,
      (start_at AT TIME ZONE 'America/Los_Angeles')::date::text AS la_date_text
    FROM bookings
    WHERE booking_id IN ('16080zwhrqpscb','25fc9rc5ugz36j','7sa73hmz4mfa8c')
  `;
  console.log('\nActual DB rows (text format):');
  actual.forEach((r) => console.log(`  ${r.booking_id}: db_start="${r.db_start_text}"  la="${r.la_text}"  la_date="${r.la_date_text}"`));

  // Also: what is the session timezone?
  const tz = await prisma.$queryRaw`SHOW TimeZone`;
  console.log(`\nSession timezone: ${JSON.stringify(tz[0])}`);

  // Test with the explicit query the migration uses
  const sample = await prisma.$queryRaw`
    SELECT
      booking_id,
      start_at::text AS db_start,
      (start_at AT TIME ZONE 'America/Los_Angeles')::date::text AS la_date_v1,
      ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles')::date::text AS la_date_v2
    FROM bookings
    WHERE booking_id IN ('16080zwhrqpscb','jvg84gxntuu273')
  `;
  console.log('\nv1 (single AT TZ) vs v2 (double AT TZ — the views use this):');
  sample.forEach((r) => console.log(`  ${r.booking_id}: db="${r.db_start}"  v1=${r.la_date_v1}  v2=${r.la_date_v2}`));

  await prisma.$disconnect();
})();
