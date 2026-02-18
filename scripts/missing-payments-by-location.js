require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

const LOCATIONS = {
  'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380', // 2266 Union St
  'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'  // 550 Pacific Ave
};

async function getMissingByLocation() {
  console.log('🔍 Missing Payments by Location\n');
  console.log('='.repeat(100));

  try {
    let totalMissing = 0;
    let totalMissingAmount = 0;

    for (const [squareLocId, dbLocId] of Object.entries(LOCATIONS)) {
      console.log(`\n📍 Location: ${squareLocId}`);
      console.log('-'.repeat(100));

      // Get location name
      const location = await prisma.$queryRawUnsafe(`
        SELECT name FROM locations 
        WHERE id = '${dbLocId}'::uuid
      `);
      const locName = location[0]?.name || 'Unknown';
      console.log(`Name: ${locName}\n`);

      let locationMissing = 0;
      let locationMissingAmount = 0;

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

        // Get from DB for this location
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

        const missingAmount = missingInDb.reduce((sum, id) => {
          const p = allSquarePayments.find(payment => payment.id === id);
          return sum + ((p.amount_money?.amount || 0) / 100);
        }, 0);

        locationMissing += missingInDb.length;
        locationMissingAmount += missingAmount;

        console.log(`${period}:`);
        console.log(`  Square: ${allSquarePayments.length} | DB: ${dbPayments.length} | Missing: ${missingInDb.length} | Amount: $${missingAmount.toFixed(2)}`);

        if (missingInDb.length > 0) {
          console.log(`  Missing IDs (first 3):`);
          missingInDb.slice(0, 3).forEach((id, idx) => {
            const p = allSquarePayments.find(payment => payment.id === id);
            const amount = ((p.amount_money?.amount || 0) / 100).toFixed(2);
            console.log(`    ${idx+1}. ${id.substring(0, 20)}... - $${amount}`);
          });
          if (missingInDb.length > 3) {
            console.log(`    ... and ${missingInDb.length - 3} more`);
          }
        }
      }

      console.log(`\nLocation Summary: ${locationMissing} missing | $${locationMissingAmount.toFixed(2)}`);
      totalMissing += locationMissing;
      totalMissingAmount += locationMissingAmount;
    }

    console.log(`\n${'='.repeat(100)}`);
    console.log(`\n📋 TOTAL MISSING ACROSS ALL LOCATIONS:`);
    console.log(`Payments: ${totalMissing}`);
    console.log(`Amount: $${totalMissingAmount.toFixed(2)}`);

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

getMissingByLocation();
