require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';

const LOCATIONS = {
  'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380',
  'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchSquare(url, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Square-Version': '2026-01-22',
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Square API error ${response.status}: ${await response.text()}`);
  return response.json();
}

async function backfillTargeted() {
  console.log('🚀 Starting Targeted Backfill (Dec 2023 + Missing 2025 Details)...');

  // --- PART 1: DECEMBER 2023 ---
  console.log('\n📅 Processing December 2023...');
  const begin2023 = '2023-12-01T00:00:00Z';
  const end2023 = '2024-01-01T00:00:00Z';

  for (const [squareLocId, dbLocId] of Object.entries(LOCATIONS)) {
    const pData = await fetchSquare(`https://connect.squareup.com/v2/payments?begin_time=${begin2023}&end_time=${end2023}&location_id=${squareLocId}`);
    const payments = pData.payments || [];
    console.log(`  📍 ${squareLocId}: Found ${payments.length} payments.`);

    for (const p of payments) {
      try {
        // Square order_id is sometimes a string that looks like a UUID but isn't always.
        // In our DB, payments.order_id is UUID. We should only insert if it's a valid UUID.
        const isUuid = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
        const orderIdValue = p.order_id && isUuid(p.order_id) ? `'${p.order_id}'::uuid` : 'NULL';

        await prisma.$executeRawUnsafe(`
          INSERT INTO payments (id, organization_id, payment_id, event_type, location_id, customer_id, order_id, amount_money_amount, total_money_amount, status, created_at, updated_at)
          VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${p.id}', 'payment.created', '${dbLocId}'::uuid, ${p.customer_id ? `'${p.customer_id}'` : 'NULL'}, ${orderIdValue}, ${p.amount_money?.amount || 0}, ${p.total_money?.amount || 0}, '${p.status}', '${p.created_at}', '${p.updated_at}')
          ON CONFLICT DO NOTHING
        `);

        if (p.order_id) {
          const oData = await fetchSquare(`https://connect.squareup.com/v2/orders/${p.order_id}`);
          const o = oData.order;
          const [dbOrder] = await prisma.$queryRawUnsafe(`
            INSERT INTO orders (id, organization_id, order_id, customer_id, location_id, state, created_at, updated_at, raw_json)
            VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${o.id}', ${o.customer_id ? `'${o.customer_id}'` : 'NULL'}, '${dbLocId}'::uuid, '${o.state}', '${o.created_at}', '${o.updated_at}', '${JSON.stringify(o).replace(/'/g, "''")}'::jsonb)
            ON CONFLICT (organization_id, order_id) DO UPDATE SET state = EXCLUDED.state RETURNING id
          `);
          if (o.line_items) {
            for (const li of o.line_items) {
              await prisma.$executeRawUnsafe(`
                INSERT INTO order_line_items (id, organization_id, order_id, customer_id, uid, name, quantity, total_money_amount, item_type, order_created_at, order_state, created_at, updated_at)
                VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${dbOrder.id}'::uuid, ${o.customer_id ? `'${o.customer_id}'` : 'NULL'}, '${li.uid}', '${(li.name || 'Unknown').replace(/'/g, "''")}', '${li.quantity}', ${li.total_money?.amount || 0}, '${li.item_type || 'ITEM'}', '${o.created_at}', '${o.state}', NOW(), NOW())
                ON CONFLICT DO NOTHING
              `);
            }
          }
        }
      } catch (e) {
        console.error(`    ❌ Failed payment/order ${p.id}: ${e.message}`);
      }
    }
    const bData = await fetchSquare(`https://connect.squareup.com/v2/bookings?start_at_min=${begin2023}&start_at_max=${end2023}&location_id=${squareLocId}`);
    const bookings = bData.bookings || [];
    for (const b of bookings) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO bookings (id, organization_id, booking_id, customer_id, location_id, start_at, status, created_at, updated_at)
        VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${b.id}', ${b.customer_id ? `'${b.customer_id}'` : 'NULL'}, '${dbLocId}'::uuid, '${b.start_at}', '${b.status}', '${b.created_at}', '${b.updated_at}')
        ON CONFLICT DO NOTHING
      `);
    }
  }

  // --- PART 2: MISSING 2025 LINE ITEMS ---
  console.log('\n📅 Fixing missing 2025 Order Details...');
  const missingOrders = await prisma.$queryRaw`
    SELECT o.id, o.order_id, o.location_id, l.square_location_id
    FROM orders o
    JOIN locations l ON l.id = o.location_id
    WHERE o.created_at >= '2025-01-01' AND o.created_at < '2026-01-01'
      AND NOT EXISTS (SELECT 1 FROM order_line_items li WHERE li.order_id = o.id)
    LIMIT 200
  `;

  console.log(`  Found ${missingOrders.length} orders missing details.`);
  for (const o of missingOrders) {
    try {
      const oData = await fetchSquare(`https://connect.squareup.com/v2/orders/${o.order_id}`);
      const sqOrder = oData.order;
      if (sqOrder.line_items) {
        for (const li of sqOrder.line_items) {
          await prisma.$executeRawUnsafe(`
            INSERT INTO order_line_items (id, organization_id, order_id, customer_id, uid, name, quantity, total_money_amount, item_type, order_created_at, order_state, created_at, updated_at)
            VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${o.id}'::uuid, ${sqOrder.customer_id ? `'${sqOrder.customer_id}'` : 'NULL'}, '${li.uid}', '${(li.name || 'Unknown').replace(/'/g, "''")}', '${li.quantity}', ${li.total_money?.amount || 0}, '${li.item_type || 'ITEM'}', '${sqOrder.created_at}', '${sqOrder.state}', NOW(), NOW())
            ON CONFLICT DO NOTHING
          `);
        }
        console.log(`    ✅ Restored items for order ${o.order_id}`);
      }
      await sleep(200);
    } catch (e) {
      console.error(`    ❌ Failed order ${o.order_id}: ${e.message}`);
    }
  }

  console.log('\n✨ Targeted Backfill Complete!');
  await prisma.$disconnect();
}

backfillTargeted().catch(console.error);
