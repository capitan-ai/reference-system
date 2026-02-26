require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getOrdersApi, getLocationsApi } = require('../lib/utils/square-client');

/**
 * RECOVERY PLAN B: Direct Order Retrieval
 * 
 * 1. Find all payments that have a square order_id but NO corresponding order in our DB.
 * 2. Use batchRetrieveOrders to fetch them directly by ID.
 * 3. Save them to the database.
 */
async function recoverMissingOrders() {
  console.log('\n' + '='.repeat(80));
  console.log('  🚀 RECOVERY PLAN B: DIRECT ORDER RETRIEVAL');
  console.log('='.repeat(80));

  const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
  const ordersApi = getOrdersApi();
  const locationsApi = getLocationsApi();

  // 1. Get location mapping
  const locResp = await locationsApi.listLocations();
  const locationIds = (locResp.result.locations || []).map(l => l.id);
  const dbLocs = await prisma.location.findMany({ select: { id: true, square_location_id: true } });
  const locMap = {};
  dbLocs.forEach(l => locMap[l.square_location_id] = l.id);

  // 2. Find payments with missing orders
  // We need to find the Square Order ID. In our payments table, order_id is a UUID.
  // However, we found that some payments were imported without a proper link.
  // Let's look for payments where we can find the Square Order ID in raw_json or other fields.
  
  console.log('🔍 Identifying payments with missing orders...');
  
  // We'll look for payments that have an order_id (UUID) that doesn't exist in orders table
  const missing = await prisma.$queryRaw`
    SELECT p.id as payment_uuid, p.payment_id, p.order_id::text as order_uuid, p.location_id, p.customer_id
    FROM payments p
    LEFT JOIN orders o ON o.id = p.order_id
    WHERE p.status = 'COMPLETED'
      AND p.order_id IS NOT NULL
      AND o.id IS NULL
    LIMIT 500
  `;

  if (missing.length === 0) {
    console.log('✅ No missing orders found via UUID link.');
    return;
  }

  console.log(`🔍 Found ${missing.length} payments missing their orders. Retrieving Square IDs...`);

  // We need the Square Order ID (the string like 'ZKCKRis...')
  // Since the link is broken, we'll try to find the Square ID from the payments we just found.
  // We might need to fetch the payment from Square to get its order_id string.
  
  let ordersRecovered = 0;
  let itemsRecovered = 0;

  for (const m of missing) {
    try {
      // Fetch payment from Square to get the real order_id string
      const { getPaymentsApi } = require('../lib/utils/square-client');
      const pResp = await getPaymentsApi().getPayment(m.payment_id);
      const squareOrderId = pResp.result.payment.orderId;

      if (!squareOrderId) {
        console.log(`   - Payment ${m.payment_id}: No orderId in Square.`);
        continue;
      }

      console.log(`   - Recovering Order ${squareOrderId} for Payment ${m.payment_id}...`);

      // Retrieve the order
      const oResp = await ordersApi.retrieveOrder(squareOrderId);
      const o = oResp.result.order;

      if (o) {
        const dbLocId = locMap[o.locationId] || m.location_id;
        
        // Save Order
        const [dbOrder] = await prisma.$queryRawUnsafe(`
          INSERT INTO orders (id, organization_id, order_id, customer_id, location_id, state, created_at, updated_at, raw_json)
          VALUES ('${m.order_uuid}'::uuid, '${ORG_ID}'::uuid, '${o.id}', '${o.customerId || m.customer_id}', '${dbLocId}'::uuid, '${o.state}', '${o.createdAt}', '${o.updatedAt}', '${JSON.stringify(o).replace(/'/g, "''")}'::jsonb)
          ON CONFLICT (organization_id, order_id) DO UPDATE SET state = EXCLUDED.state RETURNING id
        `);

        // Save Line Items
        if (o.lineItems) {
          for (const li of o.lineItems) {
            await prisma.$executeRawUnsafe(`
              INSERT INTO order_line_items (id, organization_id, order_id, customer_id, uid, name, variation_name, quantity, total_money_amount, item_type, order_created_at, order_state, created_at, updated_at)
              VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${dbOrder.id}'::uuid, '${o.customerId || m.customer_id}', '${li.uid}', '${(li.name || 'Unknown').replace(/'/g, "''")}', ${li.variationName ? `'${li.variationName.replace(/'/g, "''")}'` : 'NULL'}, '${li.quantity}', ${li.totalMoney?.amount || 0}, '${li.itemType || 'ITEM'}', '${o.createdAt}', '${o.state}', NOW(), NOW())
              ON CONFLICT (organization_id, uid) WHERE uid IS NOT NULL DO NOTHING
            `);
            itemsRecovered++;
          }
        }
        ordersRecovered++;
        console.log(`     ✅ Recovered!`);
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));

    } catch (e) {
      console.error(`   ❌ Failed for payment ${m.payment_id}: ${e.message}`);
    }
  }

  console.log(`\n✨ Recovery Complete!`);
  console.log(`   Orders recovered:     ${ordersRecovered}`);
  console.log(`   Line items recovered: ${itemsRecovered}`);
  console.log('='.repeat(80) + '\n');

  await prisma.$disconnect();
}

recoverMissingOrders().catch(console.error);

