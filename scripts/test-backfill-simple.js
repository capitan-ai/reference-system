#!/usr/bin/env node
/**
 * Simple test script to debug backfill issues
 */

// Force sync console output
process.stdout.write('Script starting...\n');

require('dotenv').config();
process.stdout.write('Dotenv loaded\n');

const { PrismaClient } = require('@prisma/client');
process.stdout.write('Prisma loaded\n');

const { Client, Environment } = require('square');
process.stdout.write('Square SDK loaded\n');

const prisma = new PrismaClient();

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
});
process.stdout.write('Square client created\n');

async function main() {
  try {
    process.stdout.write('\n--- Step 1: Get Locations from DB ---\n');
    const locations = await prisma.$queryRaw`
      SELECT square_location_id, name FROM locations WHERE square_location_id IS NOT NULL LIMIT 5
    `;
    process.stdout.write(`Found ${locations.length} locations in DB\n`);
    
    if (locations.length === 0) {
      process.stdout.write('ERROR: No locations in database!\n');
      return;
    }
    
    const locationId = locations[0].square_location_id;
    process.stdout.write(`Using location: ${locationId}\n`);
    
    process.stdout.write('\n--- Step 2: Fetch Orders from Square API ---\n');
    
    // Today's date range
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date();
    
    process.stdout.write(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}\n`);
    
    const searchRequest = {
      locationIds: [locationId],
      query: {
        filter: {
          dateTimeFilter: {
            createdAt: {
              startAt: startDate.toISOString(),
              endAt: endDate.toISOString()
            }
          }
        }
      },
      limit: 10
    };
    
    process.stdout.write('Calling Square Orders API...\n');
    
    const response = await client.ordersApi.searchOrders(searchRequest);
    
    const orders = response.result?.orders || [];
    process.stdout.write(`SUCCESS! Found ${orders.length} orders from Square\n`);
    
    if (orders.length > 0) {
      orders.forEach((order, i) => {
        process.stdout.write(`  ${i+1}. Order ${order.id} - ${order.state} - ${order.lineItems?.length || 0} items\n`);
      });
    }
    
    process.stdout.write('\n--- Step 3: Check DB counts ---\n');
    const ordersInDb = await prisma.$queryRaw`SELECT COUNT(*)::int as count FROM orders`;
    const lineItemsInDb = await prisma.$queryRaw`SELECT COUNT(*)::int as count FROM order_line_items`;
    process.stdout.write(`Orders in DB: ${ordersInDb[0].count}\n`);
    process.stdout.write(`Line items in DB: ${lineItemsInDb[0].count}\n`);
    
    process.stdout.write('\n✅ Test completed successfully!\n');
    
  } catch (error) {
    process.stdout.write(`\n❌ ERROR: ${error.message}\n`);
    process.stdout.write(`Stack: ${error.stack}\n`);
    if (error.errors) {
      process.stdout.write(`Square errors: ${JSON.stringify(error.errors, null, 2)}\n`);
    }
  } finally {
    await prisma.$disconnect();
    process.stdout.write('Prisma disconnected\n');
  }
}

main().then(() => {
  process.stdout.write('Main function completed\n');
  process.exit(0);
}).catch((e) => {
  process.stdout.write(`Unhandled error: ${e.message}\n`);
  process.exit(1);
});

