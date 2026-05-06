require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const ORG_ID = process.argv[2] || 'd0e24178-2f94-4033-bc91-41f22df58278';

// Map DB location UUIDs to Square location IDs
async function getLocationMap() {
  const locations = await prisma.$queryRawUnsafe(`
    SELECT id, square_location_id FROM locations WHERE organization_id = $1::uuid
  `, ORG_ID);
  const dbToSquare = new Map();
  const squareToDb = new Map();
  for (const loc of locations) {
    dbToSquare.set(loc.id, loc.square_location_id);
    squareToDb.set(loc.square_location_id, loc.id);
  }
  return { dbToSquare, squareToDb };
}

async function searchSquareOrders(squareLocationId, customerId, startAt) {
  // Search for orders by customer + location + date window (±6 hours)
  const beginTime = new Date(startAt.getTime() - 6 * 3600 * 1000).toISOString();
  const endTime = new Date(startAt.getTime() + 6 * 3600 * 1000).toISOString();

  const body = {
    location_ids: [squareLocationId],
    query: {
      filter: {
        date_time_filter: {
          closed_at: { start_at: beginTime, end_at: endTime }
        },
        state_filter: { states: ['COMPLETED'] },
        ...(customerId ? { customer_filter: { customer_ids: [customerId] } } : {})
      },
      sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' }
    }
  };

  const response = await fetch('https://connect.squareup.com/v2/orders/search', {
    method: 'POST',
    headers: {
      'Square-Version': '2026-01-22',
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Square API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.orders || [];
}

async function main() {
  console.log('🔍 Searching Square for missing orders for stuck March bookings...\n');

  const { dbToSquare, squareToDb } = await getLocationMap();

  // Get stuck March bookings without orders
  const bookings = await prisma.$queryRawUnsafe(`
    SELECT b.id, b.booking_id AS square_booking_id, b.start_at,
           b.customer_id, b.location_id, b.technician_id,
           bs.price_snapshot_amount
    FROM booking_snapshots bs
    JOIN bookings b ON b.id = bs.booking_id
    LEFT JOIN orders o ON o.booking_id = b.id
    WHERE bs.organization_id = $1::uuid
      AND bs.base_processed = false
      AND bs.status = 'ACCEPTED'
      AND bs.price_snapshot_amount > 0
      AND b.start_at >= '2026-03-01'
      AND b.start_at < '2026-04-01'
      AND o.id IS NULL
    ORDER BY b.start_at
  `, ORG_ID);

  console.log(`Found ${bookings.length} stuck bookings\n`);

  let found = 0;
  let notFound = 0;
  let alreadyInDb = 0;
  const ordersToImport = [];

  for (const b of bookings) {
    const squareLocId = dbToSquare.get(b.location_id);
    if (!squareLocId) {
      console.log(`⚠️  ${b.id.substring(0,8)} - no Square location mapping`);
      notFound++;
      continue;
    }

    try {
      // booking.customer_id IS the Square customer ID directly
    const orders = await searchSquareOrders(squareLocId, b.customer_id, b.start_at);

      if (orders.length === 0) {
        console.log(`❌ ${b.id.substring(0,8)} ${b.start_at.toISOString().substring(0,16)} price=${Number(b.price_snapshot_amount)} - no Square order found`);
        notFound++;
        continue;
      }

      // Find the best match (closest to booking start_at) that is unlinked
      let bestOrder = null;
      let bestInDb = false;
      for (const order of orders) {
        const existing = await prisma.$queryRawUnsafe(`
          SELECT id, booking_id FROM orders WHERE order_id = $1 LIMIT 1
        `, order.id);

        if (existing.length > 0) {
          if (!existing[0].booking_id) {
            // Unlinked order in DB — best candidate
            bestOrder = order;
            bestInDb = true;
            break;
          }
          // Already linked to another booking — skip
        } else {
          // Not in DB at all — candidate for import
          if (!bestOrder) {
            bestOrder = order;
            bestInDb = false;
          }
        }
      }

      if (bestOrder && bestInDb) {
        console.log(`🔗 ${b.id.substring(0,8)} → order ${bestOrder.id.substring(0,12)} already in DB (unlinked). Linking...`);
        await prisma.$executeRawUnsafe(`
          UPDATE orders SET booking_id = $1::uuid WHERE order_id = $2 AND booking_id IS NULL
        `, b.id, bestOrder.id);

        // Cascade to payments
        await prisma.$executeRawUnsafe(`
          UPDATE payments SET booking_id = $1::uuid
          WHERE order_id = (SELECT id FROM orders WHERE order_id = $2 LIMIT 1)
            AND booking_id IS NULL
        `, b.id, bestOrder.id);

        alreadyInDb++;
        found++;
      } else if (bestOrder && !bestInDb) {
        console.log(`📦 ${b.id.substring(0,8)} → order ${bestOrder.id.substring(0,12)} found in Square (NOT in DB). Will import.`);
        ordersToImport.push({ booking: b, order: bestOrder });
        found++;
      } else if (orders.length > 0) {
        console.log(`⚠️  ${b.id.substring(0,8)} → ${orders.length} orders found but all linked to other bookings`);
        notFound++;
      }
    } catch (err) {
      console.error(`⚠️  ${b.id.substring(0,8)} - API error: ${err.message}`);
      notFound++;
    }

    // Rate limit: Square allows 20 req/sec
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results:`);
  console.log(`  Found in Square: ${found}`);
  console.log(`  Already in DB (linked now): ${alreadyInDb}`);
  console.log(`  Need import: ${ordersToImport.length}`);
  console.log(`  No order in Square: ${notFound}`);
  console.log(`${'='.repeat(60)}`);

  if (ordersToImport.length > 0) {
    console.log(`\n⚠️  ${ordersToImport.length} orders need to be imported from Square. Run with --import to import them.`);

    if (process.argv.includes('--import')) {
      console.log('\nImporting orders...');
      for (const { booking, order } of ordersToImport) {
        try {
          const locationUuid = squareToDb.get(order.location_id) || booking.location_id;
          const totalMoney = order.total_money?.amount || 0;
          const tipMoney = order.total_tip_money?.amount || 0;
          const taxMoney = order.total_tax_money?.amount || 0;
          const discountMoney = order.total_discount_money?.amount || 0;
          const serviceChargeMoney = order.total_service_charge_money?.amount || 0;

          await prisma.$executeRawUnsafe(`
            INSERT INTO orders (
              order_id, organization_id, location_id, customer_id, booking_id,
              state, total_money_amount, total_tip_money_amount, total_tax_money_amount,
              total_discount_money_amount, total_service_charge_money_amount,
              closed_at, created_at, updated_at, raw_json
            ) VALUES (
              $1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
              $6, $7, $8, $9, $10, $11,
              $12::timestamp, NOW(), NOW(), $13::jsonb
            )
            ON CONFLICT (order_id) DO UPDATE SET
              booking_id = COALESCE(orders.booking_id, EXCLUDED.booking_id),
              updated_at = NOW()
          `,
            order.id, ORG_ID, locationUuid, booking.customer_id, booking.id,
            order.state || 'COMPLETED', totalMoney, tipMoney, taxMoney,
            discountMoney, serviceChargeMoney,
            order.closed_at ? new Date(order.closed_at) : new Date(),
            JSON.stringify(order)
          );
          console.log(`  ✅ Imported order ${order.id.substring(0,12)} → booking ${booking.id.substring(0,8)}`);
        } catch (err) {
          console.error(`  ❌ Failed to import order ${order.id.substring(0,12)}: ${err.message}`);
        }
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
