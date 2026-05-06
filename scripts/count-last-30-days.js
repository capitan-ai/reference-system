const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Window (LA local): 2026-03-29 .. 2026-04-28 inclusive (30 days)\n');

  const newClientsCA = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM customer_analytics
    WHERE (first_visit_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-29' AND DATE '2026-04-28'
  `;
  console.log('New clients — customer_analytics.first_visit_at (any visit type):', newClientsCA[0].cnt);

  const newClientsCABooking = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM customer_analytics
    WHERE (first_booking_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-29' AND DATE '2026-04-28'
  `;
  console.log('New clients — customer_analytics.first_booking_at (first booking):', newClientsCABooking[0].cnt);

  const newClientsSEC = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM square_existing_clients
    WHERE (first_visit_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-29' AND DATE '2026-04-28'
  `;
  console.log('New clients — square_existing_clients.first_visit_at:', newClientsSEC[0].cnt);

  // Breakdown of customer_type for the CA new-clients window
  const breakdown = await prisma.$queryRaw`
    SELECT customer_type, COUNT(*)::int AS cnt
    FROM customer_analytics
    WHERE (first_visit_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-29' AND DATE '2026-04-28'
    GROUP BY customer_type ORDER BY cnt DESC
  `;
  console.log('\nNew clients customer_type breakdown (CA.first_visit_at window):');
  breakdown.forEach((r) => console.log(`  ${r.customer_type}: ${r.cnt}`));

  // Visit-type breakdown of those new clients
  const visitTypeBreakdown = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(booking_visits,0) > 0)::int   AS had_booking,
      COUNT(*) FILTER (WHERE COALESCE(service_order_visits,0) > 0)::int AS had_service_order,
      COUNT(*) FILTER (WHERE COALESCE(retail_visits,0) > 0)::int    AS had_retail,
      COUNT(*) FILTER (WHERE COALESCE(training_visits,0) > 0)::int  AS had_training
    FROM customer_analytics
    WHERE (first_visit_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-29' AND DATE '2026-04-28'
  `;
  console.log('\nVisit composition of those 30-day new clients (counts overlap):');
  console.log(visitTypeBreakdown[0]);

  // Bookings count
  const bk = await prisma.$queryRaw`
    SELECT status, COUNT(*)::int AS cnt
    FROM bookings
    WHERE status IN ('ACCEPTED','COMPLETED')
      AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN DATE '2026-03-29' AND DATE '2026-04-28'
    GROUP BY status ORDER BY status
  `;
  let total = 0;
  console.log('\nBookings by status (start_at within window):');
  bk.forEach((r) => { console.log(`  ${r.status}: ${r.cnt}`); total += r.cnt; });
  console.log(`  TOTAL ACCEPTED+COMPLETED: ${total}`);

  await prisma.$disconnect();
})();
