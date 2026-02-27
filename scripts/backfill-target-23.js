require('dotenv').config();
const prisma = require('../lib/prisma-client');
const { getOrdersApi, getLocationsApi } = require('../lib/utils/square-client');

async function backfillSpecificCustomers() {
  console.log('🚀 Starting Targeted Order Recovery for 23 Customers...');

  const targetIds = [
    "00CPF7EJ3X3N0T08PP1GYEKP4R", "03438ZG5ZX8DSQH1Z4Y0D12P8W", "0484ZFWKV2SF0A7PKV9XPZHA5G",
    "091H80E2VVBMSR7C2ZW94Z6EAC", "0B8T06ERYF4BK79DW25EKE2Z74", "0KZ8A3748SD5WDR7E880YNECH8",
    "0Q5EA4N860603ZAZBWXQPMQ4Z4", "0YCFW352C6A58EASHRFVM9ASR4", "0YXX6RTP5W02SCRX297A9593GC",
    "0ZPRTSHBBAR4J74PDVFP8M0824", "105GXW5J136Q4RS9T1D72TKJ1W", "11DDB95581FNPXNC1DJXJRTECC",
    "1E5FZ2XGYV5R1HEZ9WWBJ0792G", "1E7Z775GP84WTA4ZFDNH5SPEK4", "1GWYD72N3VT9V6RN0M6TPKG2HM",
    "1HTQCDKTHB8EJG0KQKQJ3F0C44", "1J92J0MJ11JSV6QP72ZMV8RF0G", "1MDB6ZC9VH7HBFXDX847H8V700",
    "1XRWENZK40ASNETYKMKXXBSKZ0", "1ZMA60GWVG9W4VP0ANRNE9Z3GW", "23CZWSFJJJTQN5WA65BEE2R2J8",
    "27R33YYN03NMT622GPRA5QP96R", "29XPGEQW17ZEQPGKHKB2J0JV60"
  ];

  const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
  const ordersApi = getOrdersApi();
  const locationsApi = getLocationsApi();

  const locResp = await locationsApi.listLocations();
  const locationIds = (locResp.result.locations || []).map(l => l.id);
  const dbLocs = await prisma.location.findMany({ select: { id: true, square_location_id: true } });
  const locMap = {};
  dbLocs.forEach(l => locMap[l.square_location_id] = l.id);

  let ordersCreated = 0;
  let itemsCreated = 0;

  for (const customerId of targetIds) {
    console.log(`\n🔍 Checking Square for customer: ${customerId}`);
    try {
      const resp = await ordersApi.searchOrders({
        locationIds,
        query: {
          filter: {
            customerFilter: { customerIds: [customerId] },
            stateFilter: { states: ['COMPLETED'] }
          }
        },
        limit: 10
      });

      const squareOrders = resp.result.orders || [];
      console.log(`   Found ${squareOrders.length} orders in Square.`);

      for (const o of squareOrders) {
        const dbLocId = locMap[o.locationId];
        if (!dbLocId) {
          console.warn(`   ⚠️  Skipping order ${o.id}: Location ${o.locationId} not in DB.`);
          continue;
        }

        const [dbOrder] = await prisma.$queryRawUnsafe(`
          INSERT INTO orders (id, organization_id, order_id, customer_id, location_id, state, created_at, updated_at, raw_json)
          VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${o.id}', '${customerId}', '${dbLocId}'::uuid, '${o.state}', '${o.createdAt}', '${o.updatedAt}', '${JSON.stringify(o).replace(/'/g, "''")}'::jsonb)
          ON CONFLICT (organization_id, order_id) DO UPDATE SET state = EXCLUDED.state RETURNING id
        `);

        if (o.lineItems) {
          for (const li of o.lineItems) {
            await prisma.$executeRawUnsafe(`
              INSERT INTO order_line_items (id, organization_id, order_id, customer_id, uid, name, variation_name, quantity, total_money_amount, item_type, order_created_at, order_state, created_at, updated_at)
              VALUES (gen_random_uuid(), '${ORG_ID}'::uuid, '${dbOrder.id}'::uuid, '${customerId}', '${li.uid}', '${(li.name || 'Unknown').replace(/'/g, "''")}', ${li.variationName ? `'${li.variationName.replace(/'/g, "''")}'` : 'NULL'}, '${li.quantity}', ${li.totalMoney?.amount || 0}, '${li.itemType || 'ITEM'}', '${o.createdAt}', '${o.state}', NOW(), NOW())
              ON CONFLICT (organization_id, uid) WHERE uid IS NOT NULL DO NOTHING
            `);
            itemsCreated++;
          }
        }
        ordersCreated++;
        console.log(`   ✅ Saved order ${o.id} with ${o.lineItems?.length || 0} items.`);
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`   ❌ Failed for ${customerId}: ${e.message}`);
    }
  }

  console.log(`\n✨ Done! Created ${ordersCreated} orders and ${itemsCreated} line items.`);
  await prisma.$disconnect();
}

backfillSpecificCustomers().catch(console.error);


