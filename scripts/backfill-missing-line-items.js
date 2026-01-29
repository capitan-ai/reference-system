#!/usr/bin/env node
/**
 * Backfill missing order_line_items from orders.raw_json
 * 
 * Finds orders that have line_items in raw_json but no corresponding
 * records in order_line_items table, and inserts them.
 * 
 * Usage: node scripts/backfill-missing-line-items.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

console.log('🔄 Backfill Missing Line Items from raw_json\n');
console.log('='.repeat(60));

// Cache for location lookups
const locationCache = {};

async function resolveLocationId(squareLocationId, orgId) {
  if (!squareLocationId) return null;
  
  const cacheKey = `${squareLocationId}`;
  if (locationCache[cacheKey]) return locationCache[cacheKey];
  
  const loc = await prisma.$queryRaw`
    SELECT id FROM locations WHERE square_location_id = ${squareLocationId} LIMIT 1
  `;
  
  const internalId = loc?.[0]?.id || null;
  locationCache[cacheKey] = internalId;
  return internalId;
}

async function backfillLineItems() {
  // Find COMPLETED orders with line_items in raw_json but not in table
  const orders = await prisma.$queryRaw`
    SELECT 
      o.id,
      o.order_id,
      o.organization_id,
      o.raw_json->>'location_id' as square_location_id,
      o.customer_id,
      o.raw_json
    FROM orders o
    WHERE NOT EXISTS (SELECT 1 FROM order_line_items oli WHERE oli.order_id = o.id)
      AND jsonb_array_length(o.raw_json->'line_items') > 0
      AND o.raw_json->>'state' = 'COMPLETED'
  `;
  
  console.log(`📋 Found ${orders.length} orders with missing line items\n`);
  
  let totalLineItems = 0;
  let inserted = 0;
  let errors = 0;
  
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const rawJson = order.raw_json;
    const lineItems = rawJson?.line_items || rawJson?.lineItems || [];
    
    // Resolve internal location_id
    const internalLocationId = await resolveLocationId(order.square_location_id, order.organization_id);
    
    if ((i + 1) % 100 === 0) {
      console.log(`📊 Progress: ${i + 1}/${orders.length} (${inserted} line items inserted)`);
    }
    
    for (const li of lineItems) {
      totalLineItems++;
      
      const uid = li.uid;
      const name = li.name || null;
      const quantity = li.quantity || '1';
      const catalogObjectId = li.catalog_object_id || li.catalogObjectId || null;
      const catalogVersion = li.catalog_version ? BigInt(li.catalog_version) : null;
      const variationName = li.variation_name || li.variationName || null;
      const itemType = li.item_type || li.itemType || null;
      const note = li.note || null;
      
      // Base price
      const basePriceMoney = li.base_price_money || li.basePriceMoney || {};
      const basePriceAmount = basePriceMoney.amount ? parseInt(basePriceMoney.amount) : null;
      const basePriceCurrency = basePriceMoney.currency || 'USD';
      
      // Variation total
      const variationTotalPriceMoney = li.variation_total_price_money || li.variationTotalPriceMoney || {};
      const variationTotalAmount = variationTotalPriceMoney.amount ? parseInt(variationTotalPriceMoney.amount) : null;
      const variationTotalCurrency = variationTotalPriceMoney.currency || 'USD';
      
      // Gross sales
      const grossSalesMoney = li.gross_sales_money || li.grossSalesMoney || {};
      const grossSalesAmount = grossSalesMoney.amount ? parseInt(grossSalesMoney.amount) : null;
      const grossSalesCurrency = grossSalesMoney.currency || 'USD';
      
      // Total money
      const totalMoney = li.total_money || li.totalMoney || {};
      const totalMoneyAmount = totalMoney.amount ? parseInt(totalMoney.amount) : null;
      const totalMoneyCurrency = totalMoney.currency || 'USD';
      
      // Total discount
      const totalDiscountMoney = li.total_discount_money || li.totalDiscountMoney || {};
      const totalDiscountAmount = totalDiscountMoney.amount ? parseInt(totalDiscountMoney.amount) : null;
      
      // Total tax
      const totalTaxMoney = li.total_tax_money || li.totalTaxMoney || {};
      const totalTaxAmount = totalTaxMoney.amount ? parseInt(totalTaxMoney.amount) : null;
      
      // Total service charge
      const totalServiceCharge = li.total_service_charge_money || li.totalServiceChargeMoney || {};
      const totalServiceChargeAmount = totalServiceCharge.amount ? parseInt(totalServiceCharge.amount) : null;
      
      // For service-based items, catalog_object_id IS the service_variation_id
      const serviceVariationId = catalogObjectId;
      
      // Use order_id + uid as composite to avoid UID collisions across orders
      const compositeUid = `${order.order_id}:${uid}`;
      
      try {
        await prisma.$executeRaw`
          INSERT INTO order_line_items (
            id, organization_id, order_id, location_id, customer_id,
            uid, name, quantity,
            service_variation_id, catalog_version, variation_name, item_type, note,
            base_price_money_amount, base_price_money_currency,
            variation_total_price_money_amount, variation_total_price_money_currency,
            gross_sales_money_amount, gross_sales_money_currency,
            total_money_amount, total_money_currency,
            total_discount_money_amount, total_tax_money_amount, total_service_charge_money_amount,
            created_at, updated_at
          ) VALUES (
            gen_random_uuid(),
            ${order.organization_id}::uuid,
            ${order.id}::uuid,
            ${internalLocationId ? internalLocationId : null}::uuid,
            ${order.customer_id},
            ${compositeUid},
            ${name},
            ${quantity},
            ${serviceVariationId},
            ${catalogVersion},
            ${variationName},
            ${itemType},
            ${note},
            ${basePriceAmount},
            ${basePriceCurrency},
            ${variationTotalAmount},
            ${variationTotalCurrency},
            ${grossSalesAmount},
            ${grossSalesCurrency},
            ${totalMoneyAmount},
            ${totalMoneyCurrency},
            ${totalDiscountAmount},
            ${totalTaxAmount},
            ${totalServiceChargeAmount},
            NOW(),
            NOW()
          )
          ON CONFLICT (uid) DO NOTHING
        `;
        inserted++;
      } catch (err) {
        errors++;
        if (errors <= 5) {
          console.log(`   ⚠️ Error on ${order.order_id}: ${err.message.substring(0, 100)}`);
        }
      }
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 SUMMARY:');
  console.log('='.repeat(60));
  console.log(`   📋 Orders processed: ${orders.length}`);
  console.log(`   📦 Total line items found: ${totalLineItems}`);
  console.log(`   ✅ Inserted: ${inserted}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log('='.repeat(60));
}

backfillLineItems()
  .then(() => {
    console.log('\n✅ Backfill completed!');
    console.log('\n📌 Next: Run order-booking match script');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error.message);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });

