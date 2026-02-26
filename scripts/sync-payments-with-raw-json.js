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
  const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
  
  try {
    console.log('Fetching payments from Square for the last 30 days...');
    
    let allSquarePayments = [];
    let cursor = null;
    const end_time = new Date().toISOString();
    const begin_time = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    while (true) {
      let url = `https://connect.squareup.com/v2/payments?begin_time=${begin_time}&end_time=${end_time}&limit=100`;
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

      if (response.ok) {
        const data = await response.json();
        if (data.payments) {
          allSquarePayments = allSquarePayments.concat(data.payments);
        }
        if (data.cursor) {
          cursor = data.cursor;
        } else {
          break;
        }
      } else {
        const err = await response.json();
        console.error('Square API Error:', err);
        break;
      }
    }

    console.log(`Found ${allSquarePayments.length} payments in Square.`);

    for (let i = 0; i < allSquarePayments.length; i++) {
      const payment = allSquarePayments[i];
      console.log(`[${i+1}/${allSquarePayments.length}] Processing payment ${payment.id}...`);

      try {
        // Find location
        let locationId = null;
        if (payment.location_id) {
          const location = await prisma.$queryRaw`SELECT square_location_id FROM locations WHERE square_location_id = ${payment.location_id} LIMIT 1;`;
          locationId = location[0]?.square_location_id || payment.location_id;
        }

        // Upsert payment with raw_json
        await prisma.$executeRaw`
          INSERT INTO payments (
            id, square_event_id, event_type, merchant_id, customer_id, location_id, 
            order_id, amount_money_amount, amount_money_currency, total_money_amount, 
            total_money_currency, status, created_at, updated_at, square_created_at, raw_json
          ) VALUES (
            ${payment.id}, ${payment.id}, 'payment.created', ${payment.merchant_id}, ${payment.customer_id}, 
            ${locationId}, ${payment.order_id}, ${payment.amount_money?.amount || 0}, 
            ${payment.amount_money?.currency || 'USD'}, ${payment.total_money?.amount || 0}, 
            ${payment.total_money?.currency || 'USD'}, ${payment.status}, 
            ${new Date(payment.created_at)}, ${new Date(payment.updated_at || payment.created_at)}, 
            ${new Date(payment.created_at)}, ${payment}
          ) ON CONFLICT (id) DO UPDATE SET 
            raw_json = EXCLUDED.raw_json,
            updated_at = EXCLUDED.updated_at,
            status = EXCLUDED.status;
        `;
        console.log(`✓ Upserted payment ${payment.id}`);
      } catch (err) {
        console.error(`✗ Error processing payment ${payment.id}:`, err.message);
      }
    }

    console.log('Sync complete.');
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

