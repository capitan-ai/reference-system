#!/usr/bin/env node
/**
 * Backfill orders from today using Square REST API directly (no SDK)
 * 
 * Usage: node scripts/backfill-today-orders-api.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.trim();
const SQUARE_API_BASE = 'https://connect.squareup.com/v2';

// Helper to make Square API calls
async function squareApi(endpoint, method = 'GET', body = null) {
  const url = `${SQUARE_API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`Square API error: ${JSON.stringify(data.errors || data)}`);
  }
  
  return data;
}

// Date range: Today
const startDate = new Date();
startDate.setHours(0, 0, 0, 0);
const endDate = new Date();
endDate.setHours(23, 59, 59, 999);

console.log('🔄 Backfilling Orders from TODAY (using Square API)\n');
console.log('='.repeat(60));
console.log('📅 Date Range:');
console.log(`   Start: ${startDate.toISOString()}`);
console.log(`   End:   ${endDate.toISOString()}`);
console.log('');

function convertBigIntToString(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(convertBigIntToString);
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertBigIntToString(value);
    }
    return result;
  }
  return obj;
}

async function resolveOrganizationId(locationId) {
  if (locationId) {
    const loc = await prisma.$queryRaw`
      SELECT organization_id FROM locations 
      WHERE square_location_id = ${locationId}
      LIMIT 1
    `;
    if (loc && loc.length > 0) {
      return loc[0].organization_id;
    }
  }
  
  // Fallback to first active organization
  const defaultOrg = await prisma.$queryRaw`
    SELECT id FROM organizations 
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return defaultOrg?.[0]?.id || null;
}

async function processOrder(orderId, locationId) {
  // Fetch full order details
  let order;
  try {
    const response = await squareApi(`/orders/${orderId}`);
    order = response.order;
    if (!order) {
      console.log(`   ❌ Order not found`);
      return { success: false, reason: 'not_found' };
    }
  } catch (err) {
    console.log(`   ❌ API error: ${err.message}`);
    return { success: false, reason: 'api_error' };
  }

  const customerId = order.customer_id || null;
  const lineItems = order.line_items || [];
  const orderState = order.state || 'OPEN';

  // Check if exists
  const existing = await prisma.$queryRaw`
    SELECT order_id FROM orders WHERE order_id = ${orderId} LIMIT 1
  `;
  const isNew = !existing || existing.length === 0;

  // Resolve organization_id
  const organizationId = await resolveOrganizationId(locationId);
  if (!organizationId) {
    console.log(`   ❌ No organization found`);
    return { success: false, reason: 'no_org' };
  }

  console.log(`   📍 ${lineItems.length} items | ${isNew ? 'NEW' : 'UPDATE'}`);

  // Verify location exists
  let locationIdForOrder = null;
  if (locationId) {
    const locRecord = await prisma.$queryRaw`
      SELECT square_location_id FROM locations WHERE square_location_id = ${locationId} LIMIT 1
    `;
    if (locRecord && locRecord.length > 0) {
      locationIdForOrder = locationId;
    }
  }

  // Save order
  try {
    const orderJson = convertBigIntToString(order);
    
    await prisma.$executeRaw`
      INSERT INTO orders (
        id, organization_id, order_id, location_id, customer_id, state, version, reference_id,
        created_at, updated_at, raw_json
      ) VALUES (
        gen_random_uuid(), ${organizationId}::uuid, ${orderId}, ${locationIdForOrder || null},
        ${customerId || null}, ${orderState},
        ${order.version ? Number(order.version) : null},
        ${order.reference_id || null},
        ${order.created_at ? new Date(order.created_at) : new Date()},
        ${order.updated_at ? new Date(order.updated_at) : new Date()},
        ${JSON.stringify(orderJson)}::jsonb
      )
      ON CONFLICT (organization_id, order_id) DO UPDATE SET
        location_id = COALESCE(EXCLUDED.location_id, orders.location_id),
        customer_id = COALESCE(EXCLUDED.customer_id, orders.customer_id),
        state = EXCLUDED.state,
        version = COALESCE(EXCLUDED.version, orders.version),
        updated_at = EXCLUDED.updated_at,
        raw_json = COALESCE(EXCLUDED.raw_json, orders.raw_json)
    `;
  } catch (err) {
    console.log(`   ❌ Order save error: ${err.message}`);
    return { success: false, reason: 'save_error' };
  }

  // Get order UUID
  const orderRecord = await prisma.$queryRaw`
    SELECT id FROM orders WHERE order_id = ${orderId} AND organization_id = ${organizationId}::uuid LIMIT 1
  `;
  const orderUuid = orderRecord?.[0]?.id;
  if (!orderUuid) {
    return { success: false, reason: 'no_uuid' };
  }

  // Save line items
  let lineItemsSaved = 0;
  for (const item of lineItems) {
    const itemUid = item.uid;
    if (!itemUid) continue;

    try {
      const basePriceMoney = item.base_price_money || {};
      const totalMoney = item.total_money || {};
      const grossSalesMoney = item.gross_sales_money || {};
      
      const lineItemData = {
        order_id: orderUuid,
        organization_id: organizationId,
        location_id: locationIdForOrder,
        customer_id: customerId,
        uid: itemUid,
        service_variation_id: item.catalog_object_id || null,
        catalog_version: item.catalog_version ? BigInt(item.catalog_version) : null,
        quantity: item.quantity ? String(item.quantity) : null,
        name: item.name || null,
        variation_name: item.variation_name || null,
        item_type: item.item_type || null,
        base_price_money_amount: basePriceMoney.amount ? Number(basePriceMoney.amount) : null,
        base_price_money_currency: basePriceMoney.currency || 'USD',
        gross_sales_money_amount: grossSalesMoney.amount ? Number(grossSalesMoney.amount) : null,
        gross_sales_money_currency: grossSalesMoney.currency || 'USD',
        total_money_amount: totalMoney.amount ? Number(totalMoney.amount) : null,
        total_money_currency: totalMoney.currency || 'USD',
        order_state: orderState,
        order_version: order.version ? Number(order.version) : null,
        order_created_at: order.created_at ? new Date(order.created_at) : null,
        order_updated_at: order.updated_at ? new Date(order.updated_at) : null,
        order_closed_at: order.closed_at ? new Date(order.closed_at) : null,
        raw_json: convertBigIntToString(item),
      };

      // Try update first
      const updateResult = await prisma.$executeRaw`
        UPDATE order_line_items SET
          order_id = ${lineItemData.order_id}::uuid,
          name = ${lineItemData.name},
          quantity = ${lineItemData.quantity},
          total_money_amount = ${lineItemData.total_money_amount},
          order_state = ${lineItemData.order_state},
          order_created_at = ${lineItemData.order_created_at},
          order_updated_at = ${lineItemData.order_updated_at},
          updated_at = NOW()
        WHERE organization_id = ${organizationId}::uuid AND uid = ${itemUid}
      `;

      if (updateResult === 0) {
        await prisma.$executeRaw`
          INSERT INTO order_line_items (
            id, order_id, organization_id, location_id, customer_id, uid,
            service_variation_id, catalog_version, quantity, name, variation_name, item_type,
            base_price_money_amount, base_price_money_currency,
            gross_sales_money_amount, gross_sales_money_currency,
            total_money_amount, total_money_currency,
            order_state, order_version, order_created_at, order_updated_at, order_closed_at,
            raw_json, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${lineItemData.order_id}::uuid, ${lineItemData.organization_id}::uuid,
            ${lineItemData.location_id}, ${lineItemData.customer_id}, ${lineItemData.uid},
            ${lineItemData.service_variation_id}, ${lineItemData.catalog_version},
            ${lineItemData.quantity}, ${lineItemData.name}, ${lineItemData.variation_name}, ${lineItemData.item_type},
            ${lineItemData.base_price_money_amount}, ${lineItemData.base_price_money_currency},
            ${lineItemData.gross_sales_money_amount}, ${lineItemData.gross_sales_money_currency},
            ${lineItemData.total_money_amount}, ${lineItemData.total_money_currency},
            ${lineItemData.order_state}, ${lineItemData.order_version},
            ${lineItemData.order_created_at}, ${lineItemData.order_updated_at}, ${lineItemData.order_closed_at},
            ${JSON.stringify(lineItemData.raw_json)}::jsonb, NOW(), NOW()
          )
        `;
      }
      lineItemsSaved++;
    } catch (itemErr) {
      console.log(`   ⚠️ Line item error: ${itemErr.message}`);
    }
  }

  return { success: true, isNew, lineItemsSaved };
}

async function backfillTodayOrders() {
  // Get locations from DB
  console.log('📋 Step 1: Fetching locations from database...');
  const locations = await prisma.$queryRaw`
    SELECT square_location_id, name FROM locations WHERE square_location_id IS NOT NULL
  `;
  
  if (!locations || locations.length === 0) {
    console.log('❌ No locations found');
    return;
  }
  console.log(`   ✅ Found ${locations.length} location(s)`);

  let totalOrders = 0;
  let newOrders = 0;
  let updatedOrders = 0;
  let failedOrders = 0;
  let totalLineItems = 0;

  // Fetch orders for each location
  for (const location of locations) {
    const locationId = location.square_location_id;
    console.log(`\n📡 Fetching orders for: ${location.name || locationId}...`);

    let cursor = null;
    let locationOrderCount = 0;

    do {
      const searchBody = {
        location_ids: [locationId],
        query: {
          filter: {
            date_time_filter: {
              created_at: {
                start_at: startDate.toISOString(),
                end_at: endDate.toISOString()
              }
            }
          }
        },
        limit: 50
      };

      if (cursor) {
        searchBody.cursor = cursor;
      }

      let searchResult;
      try {
        searchResult = await squareApi('/orders/search', 'POST', searchBody);
      } catch (err) {
        console.log(`   ❌ Search error: ${err.message}`);
        break;
      }

      const orders = searchResult.orders || [];
      cursor = searchResult.cursor;

      console.log(`   Found ${orders.length} orders in batch`);
      locationOrderCount += orders.length;
      totalOrders += orders.length;

      for (const orderSummary of orders) {
        const orderId = orderSummary.id;
        const time = orderSummary.created_at ? new Date(orderSummary.created_at).toLocaleTimeString() : '';
        console.log(`\n   [${totalOrders}] Order ${orderId.substring(0, 12)}... (${time})`);

        const result = await processOrder(orderId, locationId);

        if (result.success) {
          if (result.isNew) newOrders++;
          else updatedOrders++;
          totalLineItems += result.lineItemsSaved || 0;
        } else {
          failedOrders++;
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
      }

    } while (cursor);

    console.log(`   ✅ Processed ${locationOrderCount} orders for this location`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 BACKFILL SUMMARY:');
  console.log('='.repeat(60));
  console.log(`   📦 Total orders from Square: ${totalOrders}`);
  console.log(`   ✅ New orders added: ${newOrders}`);
  console.log(`   🔄 Existing orders updated: ${updatedOrders}`);
  console.log(`   ❌ Failed: ${failedOrders}`);
  console.log(`   📋 Total line items saved: ${totalLineItems}`);
  console.log('='.repeat(60));

  return { totalOrders, newOrders, updatedOrders, failedOrders, totalLineItems };
}

// Run
backfillTodayOrders()
  .then(() => {
    console.log('\n✅ Backfill completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Backfill failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });

