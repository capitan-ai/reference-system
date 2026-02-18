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

        // Get from Square
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

        // Get from DB
        const dbPayments = await prisma.payment.findMany({
          where: {
            organization_id: ORG_ID,
            location_id: dbLocId,
            created_at: {
              gte: new Date(beginTime),
              lt: new Date(endTime)
            }
          },
          select: { payment_id: true }
        });

        // Find missing
        const squareIds = new Set(allSquarePayments.map(p => p.id));
        const dbIds = new Set(dbPayments.map(p => p.payment_id));
        const missingInDb = Array.from(squareIds).filter(id => !dbIds.has(id));

        if (missingInDb.length > 0) {
          console.log(`\n${period}: Syncing ${missingInDb.length} payments...`);
          let syncedCount = 0;
          let failedCount = 0;

          for (const paymentId of missingInDb) {
            const p = allSquarePayments.find(x => x.id === paymentId);
            
            try {
              // Insert directly using ORM which should use correct table name
              await prisma.payment.create({
                data: {
                  organization_id: ORG_ID,
                  payment_id: paymentId,
                  event_type: 'payment.created',
                  location_id: dbLocId,
                  customer_id: p.customer_id || null,
                  order_id: p.order_id || null,
                  amount_money_amount: p.amount_money?.amount || 0,
                  total_money_amount: p.total_money?.amount || p.amount_money?.amount || 0,
                  status: p.status,
                  source_type: p.source_type || null,
                  created_at: new Date(p.created_at),
                  updated_at: new Date(p.updated_at || p.created_at)
                }
              });
              
              syncedCount++;
              totalSynced++;
              totalAmount += (p.amount_money?.amount || 0) / 100;
            } catch (error) {
              failedCount++;
              if (!error.message.includes('Unique constraint')) {
                console.error(`  ❌ ${paymentId.substring(0, 15)}: ${error.message.substring(0, 80)}`);
              }
            }
          }

          console.log(`  ✅ Synced ${syncedCount}/${missingInDb.length} payments`);
          if (failedCount > 0) {
            console.log(`  ⚠️  Failed: ${failedCount}`);
          }
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
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

syncMissingPayments();
