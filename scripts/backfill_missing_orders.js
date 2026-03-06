require('dotenv').config();
const prisma = require('../lib/prisma-client');
const axios = require('axios');

async function backfillOrdersAndItems() {
  console.log('🚀 Starting backfill for missing orders and line items...');
  
  let accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (accessToken) {
    accessToken = accessToken.trim();
    if (accessToken.startsWith('Bearer ')) {
      accessToken = accessToken.slice(7);
    }
  }
  const env = process.env.SQUARE_ENVIRONMENT || 'production';
  const baseUrl = env === 'sandbox' 
    ? 'https://connect.squareupsandbox.com/v2' 
    : 'https://connect.squareup.com/v2';

  const orderIds = [
    'xgxTXUGpxHYqUf2ajY2mK8VlCM8YY',
    'LnGlwHSoVzcnfsRtuAR3Bcjpl7SZY'
  ];

  const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278';
  const locationMap = {
    'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380', // Union St
    'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'  // Pacific Ave
  };

  for (const orderId of orderIds) {
    try {
      console.log(`\nFetching order ${orderId} from Square...`);
      const response = await axios.get(`${baseUrl}/orders/${orderId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Square-Version': '2025-02-20',
          'Accept': 'application/json'
        }
      });
      
      const order = response.data.order;
      const locationUuid = locationMap[order.location_id];

      console.log(`Upserting order ${orderId} into DB...`);
      
      await prisma.$executeRaw`
        INSERT INTO orders (
          order_id, organization_id, location_id, customer_id, state, version,
          created_at, updated_at, total_money_amount, total_money_currency, raw_json
        ) VALUES (
          ${orderId}, ${organizationId}::uuid, ${locationUuid}::uuid, ${order.customer_id},
          ${order.state}, ${order.version}, ${order.created_at}::timestamptz,
          ${order.updated_at}::timestamptz, ${order.total_money?.amount || 0},
          ${order.total_money?.currency || 'USD'}, ${order}
        )
        ON CONFLICT (organization_id, order_id) DO UPDATE SET
          state = EXCLUDED.state,
          version = EXCLUDED.version,
          updated_at = EXCLUDED.updated_at,
          total_money_amount = EXCLUDED.total_money_amount,
          raw_json = EXCLUDED.raw_json
      `;

      const dbOrder = await prisma.order.findFirst({
        where: { order_id: orderId, organization_id: organizationId }
      });

      if (order.line_items) {
        console.log(`Processing ${order.line_items.length} line items for order ${orderId}...`);
        for (const item of order.line_items) {
          const existingItem = await prisma.orderLineItem.findFirst({
            where: { organization_id: organizationId, uid: item.uid }
          });

          if (existingItem) {
            console.log(`  Updating existing line item ${item.uid} to link to order ${dbOrder.id}`);
            await prisma.orderLineItem.update({
              where: { id: existingItem.id },
              data: {
                order_id: dbOrder.id, // Ensure it points to the correct order version
                name: item.name,
                quantity: item.quantity,
                total_money_amount: item.total_money?.amount,
                updated_at: new Date(order.updated_at),
                raw_json: item
              }
            });
          } else {
            console.log(`  Creating new line item ${item.uid}`);
            await prisma.orderLineItem.create({
              data: {
                organization_id: organizationId,
                order_id: dbOrder.id,
                location_id: locationUuid,
                customer_id: order.customer_id,
                uid: item.uid,
                name: item.name,
                quantity: item.quantity,
                item_type: item.item_type,
                total_money_amount: item.total_money?.amount,
                total_money_currency: item.total_money?.currency,
                created_at: new Date(order.created_at),
                updated_at: new Date(order.updated_at),
                raw_json: item
              }
            });
          }
        }
        console.log(`✅ Successfully backfilled line items for ${orderId}`);
      }
      
      console.log(`✅ Successfully backfilled order ${orderId}`);
    } catch (err) {
      console.error(`❌ Failed to backfill order ${orderId}:`, err.message);
    }
  }

  console.log('\n✨ Order and line item backfill completed.');
  await prisma.$disconnect();
}

backfillOrdersAndItems();
