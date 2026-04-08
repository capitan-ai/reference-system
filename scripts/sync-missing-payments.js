require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

// Square location IDs to UUID mapping
const LOCATIONS = {
  'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380',
  'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'
};

async function syncMissingPayments() {
  console.log('🔄 Finding and syncing missing payments\n');
  console.log('='.repeat(100));

  try {
    let allMissingPayments = [];

    // Check January and February
    for (const period of ['January', 'February']) {
      const beginTime = period === 'January' ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z';
      const endTime = period === 'January' ? '2026-02-01T00:00:00Z' : '2026-03-01T00:00:00Z';
      const monthNum = period === 'January' ? 1 : 2;

      console.log(`\n📍 ${period} 2026`);
      console.log('-'.repeat(100));

      // Get from Square
      let allSquarePayments = [];
      let cursor = null;

      while (true) {
        let url = `https://connect.squareup.com/v2/payments?begin_time=${beginTime}&end_time=${endTime}&limit=100`;
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

      console.log(`Square: ${allSquarePayments.length} payments`);

      // Get from DB by actual month
      const dbPayments = await prisma.payment.findMany({
        where: {
          organization_id: ORG_ID,
          created_at: {
            gte: new Date(beginTime),
            lt: new Date(endTime)
          }
        },
        select: {
          payment_id: true
        }
      });

      console.log(`DB: ${dbPayments.length} payments`);

      // Find missing
      const squareIds = new Set(allSquarePayments.map(p => p.id));
      const dbIds = new Set(dbPayments.map(p => p.payment_id));

      const missingInDb = Array.from(squareIds).filter(id => !dbIds.has(id));
      console.log(`Missing in DB: ${missingInDb.length}`);

      if (missingInDb.length > 0) {
        console.log(`\nMissing payment details (first 10):`);
        missingInDb.slice(0, 10).forEach((id, idx) => {
          const payment = allSquarePayments.find(p => p.id === id);
          const amount = ((payment.amount_money?.amount || 0) / 100).toFixed(2);
          const locId = payment.location_id || 'unknown';
          const dbLocId = LOCATIONS[locId] || locId;
          console.log(`${idx+1}. ID: ${id}`);
          console.log(`   Amount: $${amount}, Location: ${locId}, Date: ${payment.created_at.substring(0, 10)}`);
        });

        if (missingInDb.length > 10) {
          console.log(`... and ${missingInDb.length - 10} more`);
        }

        allMissingPayments = allMissingPayments.concat(
          missingInDb.map(id => {
            const p = allSquarePayments.find(payment => payment.id === id);
            return {
              month: period,
              squareId: id,
              amount: p.amount_money?.amount || 0,
              locationId: p.location_id,
              createdAt: p.created_at,
              status: p.status
            };
          })
        );
      }
    }

    // Summary
    console.log(`\n\n${'='.repeat(100)}`);
    console.log(`\n📋 TOTAL MISSING PAYMENTS: ${allMissingPayments.length}`);
    
    let totalMissingAmount = 0;
    allMissingPayments.forEach(p => {
      totalMissingAmount += (p.amount / 100);
    });
    
    console.log(`Total amount: $${totalMissingAmount.toFixed(2)}`);

    // Break down by month
    const byMonth = {};
    allMissingPayments.forEach(p => {
      if (!byMonth[p.month]) {
        byMonth[p.month] = [];
      }
      byMonth[p.month].push(p);
    });

    console.log(`\nBy month:`);
    Object.entries(byMonth).forEach(([month, payments]) => {
      const amount = payments.reduce((sum, p) => sum + (p.amount / 100), 0);
      console.log(`  ${month}: ${payments.length} payments | $${amount.toFixed(2)}`);
    });

    console.log(`\n✅ These payments need to be synced from Square to DB`);

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

syncMissingPayments();
