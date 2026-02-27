const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.trim();
  const CONCURRENCY = 10; // Number of parallel requests
  
  if (!SQUARE_ACCESS_TOKEN) {
    console.error('❌ SQUARE_ACCESS_TOKEN is missing in .env');
    process.exit(1);
  }

  try {
    console.log('--- Starting PARALLEL Payment raw_json Backfill ---');
    
    // Find payments without raw_json
    const payments = await prisma.$queryRaw`
      SELECT payment_id 
      FROM payments 
      WHERE raw_json IS NULL 
      ORDER BY created_at DESC;
    `;

    console.log(`Found ${payments.length} payments to backfill.`);

    if (payments.length === 0) {
      console.log('✅ No payments need backfilling.');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let processedCount = 0;

    async function processPayment(payment_id) {
      try {
        const response = await fetch(`https://connect.squareup.com/v2/payments/${payment_id}`, {
          headers: {
            'Square-Version': '2026-01-22',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const squarePayment = data.payment;

          await prisma.$executeRaw`
            UPDATE payments 
            SET raw_json = ${squarePayment} 
            WHERE payment_id = ${payment_id};
          `;
          
          successCount++;
        } else {
          const errorData = await response.json();
          console.error(`  ❌ Failed to fetch ${payment_id}:`, JSON.stringify(errorData));
          failCount++;
        }
      } catch (err) {
        console.error(`  ❌ Error processing ${payment_id}:`, err.message);
        failCount++;
      } finally {
        processedCount++;
        if (processedCount % 100 === 0) {
          console.log(`Progress: ${processedCount}/${payments.length} (${successCount} success, ${failCount} fail)`);
        }
      }
    }

    // Process in chunks of CONCURRENCY
    for (let i = 0; i < payments.length; i += CONCURRENCY) {
      const chunk = payments.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(p => processPayment(p.payment_id)));
      
      // Small delay between chunks to stay within rate limits (5 req/sec is the official limit for some endpoints, 
      // but often it's higher. 10 at a time with 500ms delay = 20 req/sec, which might be too high.
      // Let's do 10 at a time with 1000ms delay = 10 req/sec).
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n--- Backfill Summary ---');
    console.log(`Total processed: ${payments.length}`);
    console.log(`Successfully updated: ${successCount}`);
    console.log(`Failed: ${failCount}`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
