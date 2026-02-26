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
    console.log('--- Starting Payment raw_json Backfill ---');
    
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

    for (let i = 0; i < payments.length; i++) {
      const { payment_id } = payments[i];
      console.log(`[${i + 1}/${payments.length}] Fetching Square data for payment: ${payment_id}`);

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
          console.log(`  ✅ Updated ${payment_id}`);
        } else {
          const errorData = await response.json();
          console.error(`  ❌ Failed to fetch ${payment_id}:`, JSON.stringify(errorData));
          failCount++;
        }
      } catch (err) {
        console.error(`  ❌ Error processing ${payment_id}:`, err.message);
        failCount++;
      }

      // Rate limiting: Square allows 5 requests per second for many endpoints.
      // We'll wait 250ms between requests to be safe.
      await new Promise(resolve => setTimeout(resolve, 250));
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

