const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Find all timestamp columns and their types
  const cols = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type, datetime_precision
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
    ORDER BY data_type, table_name, column_name
  `;

  const wrong = cols.filter((c) => c.data_type === 'timestamp without time zone');
  const right = cols.filter((c) => c.data_type === 'timestamp with time zone');

  console.log(`timestamp WITHOUT time zone (potentially wrong): ${wrong.length}`);
  wrong.forEach((c) => console.log(`  ${c.table_name}.${c.column_name}`));

  console.log(`\ntimestamp WITH time zone (correct): ${right.length}`);
  right.forEach((c) => console.log(`  ${c.table_name}.${c.column_name}`));

  // Find all views referencing the wrong-typed columns of `bookings`
  const wrongOnBookings = wrong.filter((c) => c.table_name === 'bookings');
  console.log(`\nbookings table — timestamp_without_tz columns: ${wrongOnBookings.length}`);
  wrongOnBookings.forEach((c) => console.log(`  ${c.column_name}`));

  // Views that reference bookings.start_at specifically
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
  console.log(`\nViews referencing bookings (need to be updated if we change start_at type): ${views.length}`);
  views.forEach((v) => console.log(`  ${v.view_name}`));

  // Find all view definitions that contain the double-AT-TZ chain on start_at
  // (these will break after migration)
  const viewsWithDoubleAtTz = await prisma.$queryRaw`
    SELECT c.relname AS view_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v'
      AND n.nspname = 'public'
      AND pg_get_viewdef(c.oid, true) ~ 'start_at[^,]*AT TIME ZONE ''UTC''[^,]*AT TIME ZONE ''America/Los_Angeles'''
    ORDER BY c.relname
  `;
  console.log(`\nViews using ((start_at AT TIME ZONE 'UTC') AT TIME ZONE 'LA'): ${viewsWithDoubleAtTz.length}`);
  viewsWithDoubleAtTz.forEach((v) => console.log(`  ${v.view_name}`));

  // Indexes on start_at — would need to be recreated when column type changes
  const indexes = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'bookings'
      AND indexdef ILIKE '%start_at%'
  `;
  console.log(`\nIndexes on bookings.start_at: ${indexes.length}`);
  indexes.forEach((i) => console.log(`  ${i.indexname}: ${i.indexdef}`));

  // Check if any FK or generated column depends on start_at — those need handling
  const generated = await prisma.$queryRaw`
    SELECT table_name, column_name, generation_expression
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND generation_expression IS NOT NULL
      AND generation_expression ILIKE '%start_at%'
  `;
  console.log(`\nGenerated columns referencing start_at: ${generated.length}`);
  generated.forEach((g) => console.log(`  ${g.table_name}.${g.column_name}: ${g.generation_expression}`));

  await prisma.$disconnect();
})();
