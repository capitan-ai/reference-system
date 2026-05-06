const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Find ALL columns named booking_id (or original_booking_id) referencing bookings.id (UUID)
  const colsRefBookings = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name <> 'bookings'
      AND column_name IN ('booking_id', 'original_booking_id')
      AND data_type = 'uuid'
    ORDER BY table_name, column_name
  `;
  console.log('Columns potentially referencing bookings.id (UUID):');
  colsRefBookings.forEach((c) => console.log(`  ${c.table_name}.${c.column_name} (${c.data_type})`));

  // For each: how many rows point at a SUFFIXED booking row?
  console.log('\nSuffix-pointing references per table:');
  const tablesToCheck = [
    { table: 'orders', col: 'booking_id' },
    { table: 'order_line_items', col: 'booking_id' },
    { table: 'booking_segments', col: 'booking_id' },
    { table: 'booking_snapshots', col: 'booking_id' },
    { table: 'booking_snapshots', col: 'original_booking_id' },
    { table: 'master_earnings_ledger', col: 'booking_id' },
    { table: 'payments', col: 'booking_id' },
    { table: 'master_adjustments', col: 'booking_id' },
    { table: 'master_adjustments', col: 'original_booking_id' },
    { table: 'package_usages', col: 'booking_id' },
    { table: 'admin_created_booking_facts', col: 'booking_id' },
  ];
  for (const t of tablesToCheck) {
    try {
      const r = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS cnt
        FROM ${t.table} x
        WHERE x.${t.col} IN (
          SELECT id FROM bookings
          WHERE booking_id LIKE '%-%'
            AND split_part(booking_id, '-', 1) IN (
              SELECT split_part(booking_id, '-', 1)
              FROM bookings
              GROUP BY split_part(booking_id, '-', 1)
              HAVING COUNT(*) > 1
            )
        )
      `);
      console.log(`  ${t.table}.${t.col}: ${r[0].cnt}`);
    } catch (e) {
      console.log(`  ${t.table}.${t.col}: SKIP (${e.message.split('\n')[0]})`);
    }
  }

  await prisma.$disconnect();
})();
