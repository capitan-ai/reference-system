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

async function backfillMonth(year, month) {
  const beginTime = `${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endTime = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00Z`;

  console.log(`\n📅 Processing ${year}-${String(month).padStart(2, '0')}...`);

  for (const [squareLocId, dbLocId] of Object.entries(LOCATIONS)) {
    console.log(`  📍 Location: ${squareLocId}`);
    
    // 1. Fetch all COMPLETED payments for the month
    let cursor = null;
    const allPayments = [];
    const orderIdsToFetch = new Set();

    try {
      while (true) {
        let url = `https://connect.squareup.com/v2/payments?begin_time=${beginTime}&end_time=${endTime}&location_id=${squareLocId}&limit=100`;
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

        const data = await fetchWithRetry(url, {
          headers: {
            'Square-Version': '2026-01-22',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        
        const payments = (data.payments || []).filter(p => p.status === 'COMPLETED');
        allPayments.push(...payments);
        payments.forEach(p => { if (p.order_id) orderIdsToFetch.add(p.order_id); });

        if (data.cursor) {
          cursor = data.cursor;
          await sleep(100);
        } else {
          break;
        }
      }
    } catch (e) {
      console.error(`    ❌ Failed to fetch payments: ${e.message}`);
      continue;
    }

    if (allPayments.length === 0) {
      console.log(`    No completed payments found.`);
      continue;
    }

    console.log(`    Found ${allPayments.length} completed payments and ${orderIdsToFetch.size} unique orders.`);

    // 2. Fetch and Save Orders
    const orderIds = Array.from(orderIdsToFetch);
    const orderMapping = {}; // square_id -> db_uuid

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
          body: JSON.stringify({ location_id: squareLocId, order_ids: batch })
        });
        
        for (const o of (data.orders || [])) {
          try {
            const [dbOrder] = await prisma.$queryRawUnsafe(`
              INSERT INTO orders (id, organization_id, order_id, customer_id, location_id, state, created_at, updated_at, raw_json)
              VALUES ('${o.id}'::uuid, '${ORG_ID}'::uuid, '${o.id}', ${o.customer_id ? `'${o.customer_id}'` : 'NULL'}, '${dbLocId}'::uuid, '${o.state}', '${o.created_at}', '${o.updated_at}', '${JSON.stringify(o).replace(/'/g, "''")}'::jsonb)
              ON CONFLICT (organization_id, order_id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at, raw_json = EXCLUDED.raw_json
              RETURNING id
            `);
            orderMapping[o.id] = dbOrder.id;

            if (o.line_items) {
              for (const li of o.line_items) {
                await prisma.$executeRawUnsafe(`
                  INSERT INTO order_line_items (id, organization_id, order_id, customer_id, uid, name, variation_name, quantity, total_money_amount, item_type, order_created_at, order_state, created_at, updated_at)
                  VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${dbOrder.id}'::uuid, ${o.customer_id ? `'${o.customer_id}'` : 'NULL'}, '${li.uid}', '${(li.name || 'Unknown').replace(/'/g, "''")}', ${li.variation_name ? `'${li.variation_name.replace(/'/g, "''")}'` : 'NULL'}, '${li.quantity}', ${li.total_money?.amount || 0}, '${li.item_type || 'ITEM'}', '${o.created_at}', '${o.state}', NOW(), NOW())
                  ON CONFLICT (organization_id, uid) WHERE uid IS NOT NULL DO UPDATE SET order_state = EXCLUDED.order_state, total_money_amount = EXCLUDED.total_money_amount, updated_at = NOW()
                `);
              }
            }
          } catch (e) {
            console.error(`      ❌ Failed to save order ${o.id}: ${e.message}`);
          }
        }
      } catch (e) {
        console.error(`    ❌ Batch fetch failed: ${e.message}`);
      }
      await sleep(200);
    }

    // 3. Save Payments
    let savedPayments = 0;
    for (const p of allPayments) {
      try {
        const orderUuid = p.order_id ? orderMapping[p.order_id] : null;
        await prisma.$executeRawUnsafe(`
          INSERT INTO payments (id, organization_id, payment_id, event_type, location_id, customer_id, order_id, amount_money_amount, amount_money_currency, total_money_amount, total_money_currency, status, source_type, created_at, updated_at)
          VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${p.id}', 'payment.created', '${dbLocId}'::uuid, ${p.customer_id ? `'${p.customer_id}'` : 'NULL'}, ${orderUuid ? `'${orderUuid}'::uuid` : 'NULL'}, ${p.amount_money?.amount || 0}, 'USD', ${p.total_money?.amount || p.amount_money?.amount || 0}, 'USD', '${p.status}', ${p.source_type ? `'${p.source_type}'` : 'NULL'}, '${p.created_at}', '${p.updated_at || p.created_at}')
          ON CONFLICT (organization_id, payment_id) DO UPDATE SET status = EXCLUDED.status, order_id = COALESCE(payments.order_id, EXCLUDED.order_id), updated_at = EXCLUDED.updated_at
        `);
        savedPayments++;
      } catch (e) {
        console.error(`    ❌ Failed to save payment ${p.id}: ${e.message}`);
      }
    }
    console.log(`    ✅ Saved ${savedPayments} payments.`);
  }
}

async function main() {
  const startMonth = parseInt(process.argv[2] || 1);
  const endMonth = parseInt(process.argv[3] || 12);
  console.log(`🚀 Starting 2024 Backfill (Months ${startMonth} to ${endMonth})...`);
  for (let m = startMonth; m <= endMonth; m++) {
    await backfillMonth(2024, m);
    await sleep(1000);
  }
  console.log('\n✨ All done!');
  await prisma.$disconnect();
}

main();

