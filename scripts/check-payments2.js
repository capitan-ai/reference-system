const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Bookings have order references in raw_json?
  const bookingOrderRef = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM bookings
    WHERE raw_json::text LIKE '%orderId%' OR raw_json::text LIKE '%order_id%'
  `;
  console.log('Bookings with order reference in raw_json:', Number(bookingOrderRef[0].count));

  // Sample booking raw_json to find the order link
  const sampleBookingRaw = await prisma.$queryRaw`
    SELECT booking_id,
      raw_json->>'orderId' as order_id_1,
      raw_json->'appointmentSegments'->0->>'orderId' as segment_order_id
    FROM bookings
    WHERE raw_json::text LIKE '%orderId%'
    LIMIT 5
  `;
  console.log('\nSample booking order references:');
  sampleBookingRaw.forEach(b => console.log(JSON.stringify(b)));

  // How many bookings have orderId at top level?
  const topLevelOrder = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM bookings
    WHERE raw_json->>'orderId' IS NOT NULL
  `;
  console.log('\nBookings with top-level orderId:', Number(topLevelOrder[0].count));

  // Match bookings to orders via orderId in raw_json
  const bookingToOrder = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM bookings b
    JOIN orders o ON b.raw_json->>'orderId' = o.order_id
    WHERE b.raw_json->>'orderId' IS NOT NULL
  `;
  console.log('Bookings matched to orders via raw_json orderId:', Number(bookingToOrder[0].count));

  // Full chain: booking -> order -> payment via booking raw_json orderId
  const fullChain = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT p.id) as count FROM bookings b
    JOIN orders o ON b.raw_json->>'orderId' = o.order_id
    JOIN payments p ON p.order_id = o.id
    WHERE b.raw_json->>'orderId' IS NOT NULL
  `;
  console.log('Payments linkable via booking->order chain:', Number(fullChain[0].count));

  // How many unique bookings have a matching order?
  const uniqueBookingsMatched = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT b.id) as count FROM bookings b
    JOIN orders o ON b.raw_json->>'orderId' = o.order_id
    WHERE b.raw_json->>'orderId' IS NOT NULL
  `;
  console.log('Unique bookings with matching order:', Number(uniqueBookingsMatched[0].count));

  // Summary: what we can link
  console.log('\n=== LINKING OPPORTUNITY SUMMARY ===');

  // 1. Orders linkable to bookings via booking raw_json
  const ordersLinkable = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT o.id) as count FROM orders o
    JOIN bookings b ON b.raw_json->>'orderId' = o.order_id
    WHERE o.booking_id IS NULL
  `;
  console.log('Orders linkable to bookings (via booking.raw_json.orderId):', Number(ordersLinkable[0].count));

  // 2. Payments where we can fix booking_id via order -> booking chain
  const paymentsFixable = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT p.id) as count FROM payments p
    JOIN orders o ON p.order_id = o.id
    JOIN bookings b ON b.raw_json->>'orderId' = o.order_id
    WHERE (p.booking_id IS NULL OR NOT EXISTS (SELECT 1 FROM bookings b2 WHERE b2.id = p.booking_id))
  `;
  console.log('Payments fixable via order->booking link:', Number(paymentsFixable[0].count));

  // 3. Line items linkable
  const lineItemsLinkable = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT li.id) as count FROM order_line_items li
    JOIN orders o ON li.order_id = o.id
    JOIN bookings b ON b.raw_json->>'orderId' = o.order_id
    WHERE li.booking_id IS NULL
  `;
  console.log('Line items linkable to bookings:', Number(lineItemsLinkable[0].count));

  await prisma.$disconnect();
})();
