require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

const LOCATIONS = {
  'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380',
  'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'
};

async function syncMissingPayments() {
  console.log('🔄 Syncing Missing Payments from Square to DB\n');
  console.log('='.repeat(100));

  let totalSynced = 0;
  let totalAmount = 0;

  try {
    for (const [squareLocId, dbLocId] of Object.entries(LOCATIONS)) {
      const location = await prisma.$queryRawUnsafe(`
        SELECT name FROM locations WHERE id = $1::uuid
      `, dbLocId);
      const locName = location[0]?.name || squareLocId;

      console.log(`\n📍 ${locName}`);
      console.log('-'.repeat(80));

      for (const period of ['January', 'February']) {
        const beginTime = period === 'January' ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z';
        const endTime = period === 'January' ? '2026-02-01T00:00:00Z' : '2026-03-01T00:00:00Z';

        // Get from Square with location_id filter
        let allSquarePayments = [];
        let cursor = null;

        while (true) {
          let url = `https://connect.squareup.com/v2/payments?begin_time=${beginTime}&end_time=${endTime}&location_id=${squareLocId}&limit=100`;
          if (cursor) {
            url += `&cursor=${encodeURIComponent(cursor)}`;
          }

          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Square-Version': '2026-01-22',
              'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          });

          if (!response.ok) {
            throw new Error(`Square API error: ${response.status}`);
          }

          const data = await response.json();
          
          if (data.payments) {
            allSquarePayments = allSquarePayments.concat(data.payments);
          }

          if (data.cursor) {
            cursor = data.cursor;
          } else {
            break;
          }
        }

        // Get from DB for this location and period
        const dbPayments = await prisma.payment.findMany({
          where: {
            organization_id: ORG_ID,
            location_id: dbLocId,
            created_at: {
              gte: new Date(beginTime),
              lt: new Date(endTime)
            }
          },
          select: {
            payment_id: true
          }
        });

        // Find missing
        const squareIds = new Set(allSquarePayments.map(p => p.id));
        const dbIds = new Set(dbPayments.map(p => p.payment_id));
        const missingInDb = Array.from(squareIds).filter(id => !dbIds.has(id));

        if (missingInDb.length > 0) {
          console.log(`\n${period}: Syncing ${missingInDb.length} payments...`);

          for (const paymentId of missingInDb) {
            const squarePayment = allSquarePayments.find(p => p.id === paymentId);
            
            try {
              await prisma.payment.create({
                data: {
                  payment_id: squarePayment.id,
                  organization_id: ORG_ID,
                  location_id: dbLocId,
                  event_type: 'payment.created',
                  customer_id: squarePayment.customer_id || null,
                  order_id: squarePayment.order_id || null,
                  amount_money_amount: squarePayment.amount_money?.amount || 0,
                  total_money_amount: squarePayment.total_money?.amount || squarePayment.amount_money?.amount || 0,
                  status: squarePayment.status,
                  source_type: squarePayment.source_type || null,
                  created_at: new Date(squarePayment.created_at),
                  updated_at: new Date(squarePayment.updated_at || squarePayment.created_at)
                }
              });

              totalSynced++;
              totalAmount += (squarePayment.amount_money?.amount || 0) / 100;
            } catch (error) {
              console.error(`  ❌ Failed to sync ${paymentId}: ${error.message}`);
            }
          }

          console.log(`  ✅ Synced ${missingInDb.length} payments`);
        } else {
          console.log(`\n${period}: No missing payments`);
        }
      }
    }

    console.log(`\n${'='.repeat(100)}`);
    console.log(`\n✅ SYNC COMPLETE`);
    console.log(`Total synced: ${totalSynced} payments`);
    console.log(`Total amount: $${totalAmount.toFixed(2)}`);

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

syncMissingPayments();
