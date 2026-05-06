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

          for (const paymentId of missingInDb) {
            const p = allSquarePayments.find(x => x.id === paymentId);
            
            try {
              const createdAt = new Date(p.created_at);
              const updatedAt = new Date(p.updated_at || p.created_at);
              
              // Use ORM with properly converted values
              const result = await prisma.$queryRaw`
                INSERT INTO "Payment" (
                  id, organization_id, payment_id, event_type, location_id,
                  customer_id, order_id, amount_money_amount, total_money_amount,
                  status, source_type, created_at, updated_at
                ) VALUES (
                  gen_random_uuid(),
                  ${ORG_ID}::uuid,
                  ${paymentId},
                  'payment.created',
                  ${dbLocId}::uuid,
                  ${p.customer_id || null},
                  ${p.order_id || null},
                  ${p.amount_money?.amount || 0},
                  ${p.total_money?.amount || p.amount_money?.amount || 0},
                  ${p.status},
                  ${p.source_type || null},
                  ${createdAt},
                  ${updatedAt}
                )
              `;
              
              syncedCount++;
              totalSynced++;
              totalAmount += (p.amount_money?.amount || 0) / 100;
            } catch (error) {
              if (!error.message.includes('Unique constraint')) {
                console.error(`  ⚠️  ${paymentId.substring(0, 15)}: ${error.message.substring(0, 60)}`);
              }
            }
          }

          console.log(`  ✅ Synced ${syncedCount}/${missingInDb.length} payments`);
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
