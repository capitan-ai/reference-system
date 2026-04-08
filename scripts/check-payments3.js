const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Check for 1:1 vs ambiguous matches (customer+location+time)
  // An ambiguous match = one order matches multiple bookings
  const ambiguous = await prisma.$queryRaw`
    SELECT o.id as order_id, COUNT(DISTINCT b.id) as booking_matches
    FROM orders o
    JOIN bookings b ON o.customer_id = b.customer_id
      AND o.location_id = b.location_id
    WHERE o.booking_id IS NULL
    AND o.customer_id IS NOT NULL
    AND b.start_at IS NOT NULL
    AND o.closed_at IS NOT NULL
    AND ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at))) < 7200
    GROUP BY o.id
    HAVING COUNT(DISTINCT b.id) > 1
  `;
  console.log('Orders with AMBIGUOUS booking matches (>1):', ambiguous.length);

  const unambiguous = await prisma.$queryRaw`
    WITH matches AS (
      SELECT o.id as order_id, COUNT(DISTINCT b.id) as booking_matches
      FROM orders o
      JOIN bookings b ON o.customer_id = b.customer_id
        AND o.location_id = b.location_id
      WHERE o.booking_id IS NULL
      AND o.customer_id IS NOT NULL
      AND b.start_at IS NOT NULL
      AND o.closed_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at))) < 7200
      GROUP BY o.id
    )
    SELECT
      COUNT(*) FILTER (WHERE booking_matches = 1) as exact_match,
      COUNT(*) FILTER (WHERE booking_matches > 1) as ambiguous_match,
      COUNT(*) as total
    FROM matches
  `;
  console.log('\nMatch quality:');
  console.log('  Exact 1:1 matches:', Number(unambiguous[0].exact_match));
  console.log('  Ambiguous matches:', Number(unambiguous[0].ambiguous_match));
  console.log('  Total matchable:', Number(unambiguous[0].total));

  // For ambiguous matches, can we narrow using service variation?
  const ambiguousWithService = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT o.id) as count
    FROM orders o
    JOIN bookings b ON o.customer_id = b.customer_id
      AND o.location_id = b.location_id
    JOIN order_line_items li ON li.order_id = o.id
    WHERE o.booking_id IS NULL
    AND o.customer_id IS NOT NULL
    AND b.start_at IS NOT NULL
    AND o.closed_at IS NOT NULL
    AND ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at))) < 7200
    AND li.catalog_object_id = b.service_variation_id
  `;
  console.log('\nOrders matching with service variation confirmation:', Number(ambiguousWithService[0].count));

  // For the closest-time match approach (pick closest booking):
  const closestMatch = await prisma.$queryRaw`
    WITH ranked AS (
      SELECT o.id as order_id, b.id as booking_id,
        ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at))) as time_diff,
        ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at)))) as rn
      FROM orders o
      JOIN bookings b ON o.customer_id = b.customer_id
        AND o.location_id = b.location_id
      WHERE o.booking_id IS NULL
      AND o.customer_id IS NOT NULL
      AND b.start_at IS NOT NULL
      AND o.closed_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at))) < 7200
    )
    SELECT COUNT(*) as count,
      AVG(time_diff) as avg_time_diff,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_diff) as median_time_diff
    FROM ranked WHERE rn = 1
  `;
  console.log('\nClosest-match approach (pick nearest booking):');
  console.log('  Total orders matchable:', Number(closestMatch[0].count));
  console.log('  Avg time diff (seconds):', Math.round(Number(closestMatch[0].avg_time_diff)));
  console.log('  Median time diff (seconds):', Math.round(Number(closestMatch[0].median_time_diff)));

  // Orders without customer_id (can't match)
  const noCustomer = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM orders WHERE customer_id IS NULL AND booking_id IS NULL
  `;
  console.log('\nOrders without customer_id (unlinkable):', Number(noCustomer[0].count));

  // Orders with customer but no matching booking at all
  const noBookingMatch = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM orders o
    WHERE o.booking_id IS NULL
    AND o.customer_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.customer_id = o.customer_id AND b.location_id = o.location_id
    )
  `;
  console.log('Orders with customer but NO booking for that customer+location:', Number(noBookingMatch[0].count));

  await prisma.$disconnect();
})();
