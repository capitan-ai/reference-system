const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_2,
    },
  },
});

async function main() {
  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN.trim();
  
  try {
    console.log('Fetching payments from database...');
    const payments = await prisma.$queryRaw`SELECT id FROM payments WHERE raw_json IS NULL;`;

    console.log(`Found ${payments.length} payments to update.`);

    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];
      console.log(`[${i+1}/${payments.length}] Fetching data for payment ${payment.id}...`);

      try {
        const response = await fetch(`https://connect.squareup.com/v2/payments/${payment.id}`, {
          headers: {
            'Square-Version': '2026-01-22',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          await prisma.$executeRaw`UPDATE payments SET raw_json = ${data.payment} WHERE id = ${payment.id};`;
          console.log(`✓ Updated payment ${payment.id}`);
        } else {
          const errorData = await response.json();
          console.error(`✗ Failed to fetch payment ${payment.id}:`, errorData);
        }
      } catch (err) {
        console.error(`✗ Error processing payment ${payment.id}:`, err.message);
      }

      // Rate limiting
      if ((i + 1) % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('Backfill complete.');
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

