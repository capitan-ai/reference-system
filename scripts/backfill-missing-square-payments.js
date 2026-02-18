require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

const LOCATIONS = {
  'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380',
  'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'
};

async function backfillMissingPayments() {
  console.log('🔄 Backfilling Missing Payments from Square\n');
  console.log('='.repeat(100));

  let totalAdded = 0;
  let totalAmount = 0;
  let totalDuplicate = 0;
  let totalFailed = 0;

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
          console.log(`\n${period}: Backfilling ${missingInDb.length} payments...`);
          let addedCount = 0;

          for (const paymentId of missingInDb) {
            const p = allSquarePayments.find(x => x.id === paymentId);
            
            try {
              // Use direct INSERT to avoid Prisma validation issues
              await prisma.$executeRawUnsafe(`
                INSERT INTO payments (
                  organization_id,
                  payment_id,
                  event_type,
                  location_id,
                  customer_id,
                  order_id,
                  amount_money_amount,
                  amount_money_currency,
                  total_money_amount,
                  total_money_currency,
                  status,
                  source_type,
                  created_at,
                  updated_at
                ) VALUES (
                  '${ORG_ID}'::uuid,
                  '${paymentId}',
                  'payment.created',
                  '${dbLocId}'::uuid,
                  ${p.customer_id ? `'${p.customer_id}'` : 'NULL'},
                  ${p.order_id ? `'${p.order_id}'` : 'NULL'},
                  ${p.amount_money?.amount || 0},
                  'USD',
                  ${p.total_money?.amount || p.amount_money?.amount || 0},
                  'USD',
                  '${p.status}',
                  ${p.source_type ? `'${p.source_type}'` : 'NULL'},
                  '${p.created_at}',
                  '${p.updated_at || p.created_at}'
                )
              `);
              
              addedCount++;
              totalAdded++;
              totalAmount += (p.amount_money?.amount || 0) / 100;
            } catch (error) {
              if (error.message.includes('unique constraint') || error.message.includes('Unique')) {
                totalDuplicate++;
              } else {
                totalFailed++;
                console.error(`  ⚠️  ${paymentId.substring(0, 15)}: ${error.message.substring(0, 60)}`);
              }
            }
          }

          console.log(`  ✅ Added ${addedCount} payments`);
        } else {
          console.log(`\n${period}: No missing payments`);
        }
      }
    }

    console.log(`\n${'='.repeat(100)}`);
    console.log(`\n📊 BACKFILL SUMMARY`);
    console.log(`Total added:      ${totalAdded} payments`);
    console.log(`Total amount:     $${totalAmount.toFixed(2)}`);
    console.log(`Duplicates:       ${totalDuplicate} (already existed)`);
    console.log(`Failed:           ${totalFailed} (errors)`);
    console.log(`\nExpected: 77 payments, Actual: ${totalAdded} added`);

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

backfillMissingPayments();
