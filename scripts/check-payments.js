const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Count payments with stale booking_id
  const stale = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM payments
    WHERE booking_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = payments.booking_id)
  `;
  console.log('Payments with STALE booking_id:', Number(stale[0].count));

  // Check order metadata for bookingId
  const orderBookingRef = await prisma.$queryRaw`
    SELECT o.order_id, o.raw_json->'metadata'->>'bookingId' as meta_booking_id
    FROM orders o
    WHERE o.raw_json->'metadata'->>'bookingId' IS NOT NULL
    LIMIT 5
  `;
  console.log('\nOrders with bookingId in metadata:', orderBookingRef.length);
  orderBookingRef.forEach(o => console.log(JSON.stringify(o)));

  // Total orders with bookingId in metadata
  const totalOrdersWithMetaBooking = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM orders o
    WHERE o.raw_json->'metadata'->>'bookingId' IS NOT NULL
  `;
  console.log('Total orders with bookingId in metadata:', Number(totalOrdersWithMetaBooking[0].count));

  // Match those metadata booking IDs to bookings.booking_id (Square ID)
  const metaMatch = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM orders o
    JOIN bookings b ON o.raw_json->'metadata'->>'bookingId' = b.booking_id
    WHERE o.raw_json->'metadata'->>'bookingId' IS NOT NULL
    AND o.booking_id IS NULL
  `;
  console.log('Unlinked orders matchable via metadata bookingId:', Number(metaMatch[0].count));

  // Already linked orders via metadata
  const alreadyLinked = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM orders o
    JOIN bookings b ON o.raw_json->'metadata'->>'bookingId' = b.booking_id
    WHERE o.raw_json->'metadata'->>'bookingId' IS NOT NULL
    AND o.booking_id IS NOT NULL
  `;
  console.log('Already linked orders with metadata bookingId:', Number(alreadyLinked[0].count));

  // Check fulfillments for booking references
  const hasFulfillments = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM orders
    WHERE raw_json::text LIKE '%fulfillment%'
  `;
  console.log('\nOrders with fulfillment data:', Number(hasFulfillments[0].count));

  // Sample fulfillment data
  const sampleFulfillment = await prisma.$queryRaw`
    SELECT order_id, raw_json->'fulfillments'->0->>'type' as fulfill_type,
      raw_json->'fulfillments'->0->'metadata'->>'bookingId' as fulfill_booking_id
    FROM orders
    WHERE raw_json->'fulfillments' IS NOT NULL
    AND jsonb_array_length(COALESCE(raw_json->'fulfillments', '[]'::jsonb)) > 0
    LIMIT 5
  `;
  console.log('Sample fulfillments:');
  sampleFulfillment.forEach(o => console.log(JSON.stringify(o)));

  // Orders with reference_id
  const refCount = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM orders WHERE reference_id IS NOT NULL
  `;
  console.log('\nOrders with reference_id:', Number(refCount[0].count));

  // Check matching by customer_id + location + close time to booking start_at
  const timeMatch = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT o.id) as count
    FROM orders o
    JOIN bookings b ON o.customer_id = b.customer_id
      AND o.location_id = b.location_id
    WHERE o.booking_id IS NULL
    AND o.customer_id IS NOT NULL
    AND b.start_at IS NOT NULL
    AND o.closed_at IS NOT NULL
    AND ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at))) < 7200
  `;
  console.log('Orders matchable to bookings (customer+location, closed_at within 2h of start_at):', Number(timeMatch[0].count));

  await prisma.$disconnect();
})();
