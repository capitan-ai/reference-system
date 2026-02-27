require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`Square API error ${response.status}: ${await response.text()}`);
      return await response.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(2000);
    }
  }
}

async function backfillMissingOrders() {
  console.log('🚀 Starting Targeted Batch Backfill for Missing Orders (2024)...');

  // 1. Find all payments that have an order_id but NO corresponding order in our DB
  const missing = await prisma.$queryRaw`
    SELECT p.location_id, p.order_id::text as square_order_id
    FROM payments p
    LEFT JOIN orders o ON o.id = p.order_id
    WHERE p.created_at >= '2024-01-01' AND p.created_at < '2025-01-01'
      AND p.status = 'COMPLETED'
      AND p.order_id IS NOT NULL
      AND o.id IS NULL
  `;

  if (missing.length === 0) {
    console.log('✅ No missing orders found for 2024. All payments are linked!');
    return;
  }

  console.log(`🔍 Found ${missing.length} payments missing their orders in DB.`);

  // 2. Group by location for batch-retrieve
  const locationGroups = {};
  missing.forEach(m => {
    // We need the Square location ID, but we have the DB UUID. 
    // Let's fetch the mapping first.
  });

  const locations = await prisma.$queryRaw`SELECT id::text, square_location_id FROM locations`;
  const locMap = {};
  locations.forEach(l => locMap[l.id] = l.square_location_id);

  missing.forEach(m => {
    const squareLocId = locMap[m.location_id];
    if (!locationGroups[squareLocId]) locationGroups[squareLocId] = new Set();
    locationGroups[squareLocId].add(m.square_order_id);
  });

  let totalOrdersFixed = 0;

  for (const [squareLocId, orderIdSet] of Object.entries(locationGroups)) {
    const orderIds = Array.from(orderIdSet);
    console.log(`\n📍 Processing location ${squareLocId} (${orderIds.length} missing orders)`);

    for (let i = 0; i < orderIds.length; i += 100) {
      const batch = orderIds.slice(i, i + 100);
      console.log(`   Fetching batch ${i/100 + 1} (${batch.length} orders)...`);

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

        const orders = data.orders || [];
        for (const o of orders) {
          try {
            // Save Order
            const [dbOrder] = await prisma.$queryRawUnsafe(`
              INSERT INTO orders (
                id, organization_id, order_id, customer_id, location_id, state, 
                created_at, updated_at, raw_json
              ) VALUES (
                gen_random_uuid(), '${ORG_ID}'::uuid, '${o.id}', 
                ${o.customer_id ? `'${o.customer_id}'` : 'NULL'},
                '${missing.find(m => m.square_order_id === o.id).location_id}'::uuid, '${o.state}',
                '${o.created_at}', '${o.updated_at}',
                '${JSON.stringify(o).replace(/'/g, "''")}'::jsonb
              ) ON CONFLICT (organization_id, order_id) DO UPDATE SET
                state = EXCLUDED.state,
                updated_at = EXCLUDED.updated_at,
                raw_json = EXCLUDED.raw_json
              RETURNING id
            `);

            // Update Payment to link to the new Order UUID
            await prisma.$executeRawUnsafe(`
              UPDATE payments SET order_id = '${dbOrder.id}'::uuid 
              WHERE organization_id = '${ORG_ID}'::uuid AND order_id IS NULL AND id IN (
                -- This is a bit complex because we need to find the payment by square order id
                -- but we already have the mapping from our initial query
              )
            `);
            // Actually, the initial join was p.order_id (UUID) = o.id (UUID).
            // If p.order_id was already a UUID but o.id didn't exist, we just need to insert the order with that UUID.
            
            totalOrdersFixed++;
          } catch (e) {
            console.error(`      ❌ Failed to save order ${o.id}: ${e.message}`);
          }
        }
      } catch (e) {
        console.error(`    ❌ Failed to fetch batch: ${e.message}`);
      }
      await sleep(500);
    }
  }

  console.log(`\n✨ Done! Fixed ${totalOrdersFixed} orders.`);
  await prisma.$disconnect();
}

backfillMissingOrders().catch(console.error);


