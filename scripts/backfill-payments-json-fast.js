const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.trim();
  
  if (!SQUARE_ACCESS_TOKEN) {
    console.error('❌ SQUARE_ACCESS_TOKEN is missing in .env');
    process.exit(1);
  }

  try {
    console.log('--- Starting FAST Payment raw_json Backfill (Batch Mode) ---');
    
    let cursor = null;
    let totalUpdated = 0;
    let totalFetched = 0;
    let page = 1;

    do {
      console.log(`\n[Page ${page}] Fetching batch from Square...`);
      
      let url = 'https://connect.squareup.com/v2/payments?limit=100';
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const response = await fetch(url, {
        headers: {
          'Square-Version': '2026-01-22',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Square API Error:', JSON.stringify(errorData));
        break;
      }

      const data = await response.json();
      const payments = data.payments || [];
      cursor = data.cursor;
      
      totalFetched += payments.length;
      console.log(`  Fetched ${payments.length} payments (Total fetched: ${totalFetched})`);

      if (payments.length > 0) {
        // Update DB for the batch
        const updates = payments.map(p => 
          prisma.$executeRaw`
            UPDATE payments 
            SET raw_json = ${p} 
            WHERE payment_id = ${p.id} AND raw_json IS NULL;
          `.catch(err => console.error(`    Error updating ${p.id}:`, err.message))
        );

        const results = await Promise.all(updates);
        const updatedInBatch = results.filter(r => r > 0).length;
        totalUpdated += updatedInBatch;
        
        console.log(`  ✅ Updated ${updatedInBatch} payments in this batch (Total updated: ${totalUpdated})`);
      }

      page++;
      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));

    } while (cursor);

    console.log('\n--- Fast Backfill Summary ---');
    console.log(`Total fetched from Square: ${totalFetched}`);
    console.log(`Total records updated in DB: ${totalUpdated}`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();


