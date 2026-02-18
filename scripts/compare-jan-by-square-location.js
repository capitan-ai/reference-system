require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

// Square location IDs
const LOCATIONS = {
  'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380', // 2266 Union St
  'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'  // 550 Pacific Ave
};

async function compareJanuaryBySquareLocation() {
  console.log('🔍 Comparing January Payments by Square Location ID\n');

  try {
    for (const [squareLocId, dbLocId] of Object.entries(LOCATIONS)) {
      console.log(`\n📍 Location: ${squareLocId}`);
      console.log('═'.repeat(80));

      // Fetch from Square with location_id filter
      console.log('📥 Fetching from Square API with location_id filter...');
      
      let allSquarePayments = [];
      let cursor = null;
      let pageCount = 0;

      while (true) {
        pageCount++;
        
        let url = `https://connect.squareup.com/v2/payments?begin_time=2026-01-01T00:00:00Z&end_time=2026-02-01T00:00:00Z&location_id=${squareLocId}&limit=100`;
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

      const squareRevenue = allSquarePayments.reduce((sum, p) => sum + ((p.amount_money?.amount || 0) / 100), 0);
      console.log(`  ✅ Square: ${allSquarePayments.length} payments | $${squareRevenue.toFixed(2)}`);

      // Get from DB
      const dbPayments = await prisma.payment.findMany({
        where: {
          organization_id: ORG_ID,
          location_id: dbLocId,
          created_at: {
            gte: new Date('2026-01-01T00:00:00Z'),
            lt: new Date('2026-02-01T00:00:00Z')
          }
        },
        select: {
          payment_id: true,
          amount_money_amount: true
        }
      });

      const dbRevenue = dbPayments.reduce((sum, p) => sum + ((p.amount_money_amount || 0) / 100), 0);
      console.log(`  ✅ DB: ${dbPayments.length} payments | $${dbRevenue.toFixed(2)}`);

      // Compare
      const squareIds = new Set(allSquarePayments.map(p => p.id));
      const dbIds = new Set(dbPayments.map(p => p.payment_id));

      const missing = Array.from(squareIds).filter(id => !dbIds.has(id));
      const extra = Array.from(dbIds).filter(id => !squareIds.has(id));

      console.log(`\n  Missing in DB: ${missing.length}`);
      if (missing.length > 0) {
        missing.slice(0, 5).forEach((id, idx) => {
          const payment = allSquarePayments.find(p => p.id === id);
          const amount = ((payment.amount_money?.amount || 0) / 100).toFixed(2);
          console.log(`    ${idx + 1}. ${id.substring(0, 15)}... - $${amount}`);
        });
        if (missing.length > 5) {
          console.log(`    ... and ${missing.length - 5} more`);
        }
      }

      console.log(`  Extra in DB: ${extra.length}`);
    }

    console.log('\n' + '═'.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

compareJanuaryBySquareLocation();
