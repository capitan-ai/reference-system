const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function backfillFromRawJson() {
  console.log('--- Starting Local Backfill from raw_json ---');

  // Find orders that have raw_json but no line items
  const orders = await prisma.$queryRaw`
    SELECT o.id, o.order_id, o.organization_id, o.customer_id, o.raw_json, o.created_at, o.state
    FROM orders o
    WHERE NOT EXISTS (SELECT 1 FROM order_line_items li WHERE li.order_id = o.id)
      AND o.raw_json IS NOT NULL
  `;

  console.log(`Found ${orders.length} orders to process.`);

  let totalItemsCreated = 0;

  for (const order of orders) {
    const json = order.raw_json;
    const items = json?.line_items || json?.lineItems || [];

    if (items.length > 0) {
      console.log(`Processing Order ${order.order_id} (${order.id}): Found ${items.length} items.`);
      
      for (const item of items) {
        const itemTotal = Number(item.total_money?.amount || item.totalMoney?.amount || 0);
        
        try {
          // Use Prisma to handle timestamps and UUIDs properly
          await prisma.orderLineItem.create({
            data: {
              organization_id: order.organization_id,
              order_id: order.id,
              customer_id: order.customer_id,
              uid: item.uid,
              name: item.name || 'Unknown',
              variation_name: item.variation_name || item.variationName || null,
              quantity: item.quantity?.toString() || '1',
              total_money_amount: itemTotal,
              item_type: item.item_type || item.itemType,
              order_created_at: order.created_at,
              order_state: order.state
            }
          });
          totalItemsCreated++;
        } catch (err) {
          if (err.code === 'P2002') {
            console.log(`  Item ${item.uid || 'no-uid'} already exists, skipping.`);
          } else {
            console.error(`  Error inserting item ${item.uid || 'no-uid'} for order ${order.order_id}:`, err.message);
          }
        }
      }
    }
  }

  console.log(`\nBackfill complete. Created ${totalItemsCreated} line items.`);
  await prisma.$disconnect();
}

backfillFromRawJson().catch(console.error);
