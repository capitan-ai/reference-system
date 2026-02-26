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

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`Square API error ${response.status}`);
      return await response.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000);
    }
  }
}

async function backfillMissingOrdersForMonth(year, month) {
  const beginTime = `${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endTime = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00Z`;

  console.log(`\n📅 Checking ${year}-${String(month).padStart(2, '0')}...`);

  // 1. Find payments in DB that have an order_id but NO corresponding order record
  const paymentsWithMissingOrders = await prisma.$queryRaw`
    SELECT p.payment_id, p.order_id::text, p.location_id::text, p.customer_id
    FROM payments p
    WHERE p.created_at >= ${new Date(beginTime)} 
      AND p.created_at < ${new Date(endTime)}
      AND p.order_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = p.order_id)
  `;

  if (paymentsWithMissingOrders.length === 0) {
    console.log('    ✅ All orders for this month are already in DB.');
    return;
  }

  console.log(`    Found ${paymentsWithMissingOrders.length} payments with missing orders.`);

  // Group by Square location ID to use batch-retrieve
  const locGroups = {};
  for (const p of paymentsWithMissingOrders) {
    // Map DB location UUID back to Square ID
    const sqLocId = Object.keys(LOCATIONS).find(key => LOCATIONS[key] === p.location_id);
    if (!sqLocId) continue;
    if (!locGroups[sqLocId]) locGroups[sqLocId] = new Set();
    locGroups[sqLocId].add(p.order_id);
  }

  let totalFixed = 0;

  for (const [sqLocId, orderIdsSet] of Object.entries(locGroups)) {
    const orderIds = Array.from(orderIdsSet);
    const dbLocId = LOCATIONS[sqLocId];

    for (let i = 0; i < orderIds.length; i += 100) {
      const batch = orderIds.slice(i, i + 100);
      try {
        const data = await fetchWithRetry(`https://connect.squareup.com/v2/orders/batch-retrieve`, {
          method: 'POST',
          headers: {
            'Square-Version': '2026-01-22',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ location_id: sqLocId, order_ids: batch })
        });

        for (const o of (data.orders || [])) {
          try {
            // Use order.id as the UUID if possible, or gen_random_uuid
            // The payments table already has the UUID in order_id column
            const [dbOrder] = await prisma.$queryRawUnsafe(`
              INSERT INTO orders (id, organization_id, order_id, customer_id, location_id, state, created_at, updated_at, raw_json)
              VALUES (
                '${o.id}'::uuid, '${ORG_ID}'::uuid, '${o.id}', 
                ${o.customer_id ? `'${o.customer_id}'` : 'NULL'},
                '${dbLocId}'::uuid, '${o.state}', '${o.created_at}', '${o.updated_at}',
                '${JSON.stringify(o).replace(/'/g, "''")}'::jsonb
              ) ON CONFLICT (organization_id, order_id) DO UPDATE SET state = EXCLUDED.state RETURNING id
            `);

            if (o.line_items) {
              for (const li of o.line_items) {
                await prisma.$executeRawUnsafe(`
                  INSERT INTO order_line_items (id, organization_id, order_id, customer_id, uid, name, variation_name, quantity, total_money_amount, item_type, order_created_at, order_state, created_at, updated_at)
                  VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${dbOrder.id}'::uuid, ${o.customer_id ? `'${o.customer_id}'` : 'NULL'}, '${li.uid}', '${(li.name || 'Unknown').replace(/'/g, "''")}', ${li.variation_name ? `'${li.variation_name.replace(/'/g, "''")}'` : 'NULL'}, '${li.quantity}', ${li.total_money?.amount || 0}, '${li.item_type || 'ITEM'}', '${o.created_at}', '${o.state}', NOW(), NOW())
                  ON CONFLICT (organization_id, uid) WHERE uid IS NOT NULL DO NOTHING
                `);
              }
            }
            totalFixed++;
          } catch (err) {
            console.error(`      ❌ Error saving order ${o.id}: ${err.message}`);
          }
        }
      } catch (e) {
        console.error(`    ❌ Batch fetch failed for ${sqLocId}: ${e.message}`);
      }
      await sleep(300);
    }
  }
  console.log(`    ✅ Fixed ${totalFixed} missing orders.`);
}

async function main() {
  const year = parseInt(process.argv[2] || 2024);
  console.log(`🚀 Repairing missing Order records for ${year}...`);
  for (let month = 1; month <= 12; month++) {
    await backfillMissingOrdersForMonth(year, month);
  }
  await prisma.$disconnect();
}

main();

