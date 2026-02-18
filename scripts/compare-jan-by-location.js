require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

async function compareJanuaryByLocation() {
  console.log('🔍 Comparing January Payments by Location: Square vs Database\n');

  try {
    // Get all January payments from Square
    console.log('📥 Fetching all January payments from Square API...\n');

    let allSquarePayments = [];
    let cursor = null;
    let pageCount = 0;

    while (true) {
      pageCount++;
      
      let url = 'https://connect.squareup.com/v2/payments?begin_time=2026-01-01T00:00:00Z&end_time=2026-02-01T00:00:00Z&limit=100';
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

    console.log(`✅ Total payments from Square: ${allSquarePayments.length}\n`);

    // Group Square payments by location
    const squareByLocation = {};
    allSquarePayments.forEach(p => {
      const locId = p.location_id || 'unknown';
      if (!squareByLocation[locId]) {
        squareByLocation[locId] = [];
      }
      squareByLocation[locId].push(p);
    });

    console.log('📊 Square Payments by Location:');
    console.log('-'.repeat(80));
    Object.entries(squareByLocation).forEach(([locId, payments]) => {
      const revenue = payments.reduce((sum, p) => sum + ((p.amount_money?.amount || 0) / 100), 0);
      console.log(`Location: ${locId}`);
      console.log(`  Payments: ${payments.length}`);
      console.log(`  Revenue: $${revenue.toFixed(2)}`);
    });

    // Get January payments from DB by location
    console.log('\n📥 Fetching January payments from database...');
    
    const dbPayments = await prisma.payment.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-01-01T00:00:00Z'),
          lt: new Date('2026-02-01T00:00:00Z')
        }
      },
      select: {
        payment_id: true,
        amount_money_amount: true,
        status: true,
        location_id: true,
        created_at: true
      }
    });

    console.log(`✅ Total in database: ${dbPayments.length}\n`);

    // Group DB payments by location
    const dbByLocation = {};
    dbPayments.forEach(p => {
      const locId = p.location_id || 'unknown';
      if (!dbByLocation[locId]) {
        dbByLocation[locId] = [];
      }
      dbByLocation[locId].push(p);
    });

    console.log('📊 DB Payments by Location:');
    console.log('-'.repeat(80));
    Object.entries(dbByLocation).forEach(([locId, payments]) => {
      const revenue = payments.reduce((sum, p) => sum + ((p.amount_money_amount || 0) / 100), 0);
      console.log(`Location: ${locId}`);
      console.log(`  Payments: ${payments.length}`);
      console.log(`  Revenue: $${revenue.toFixed(2)}`);
    });

    // Detailed comparison per location
    console.log('\n' + '═'.repeat(80));
    console.log('\n🔎 COMPARISON BY LOCATION:\n');

    const allLocations = new Set([
      ...Object.keys(squareByLocation),
      ...Object.keys(dbByLocation)
    ]);

    allLocations.forEach(locId => {
      const squarePayments = squareByLocation[locId] || [];
      const dbPaymentsForLoc = dbByLocation[locId] || [];

      console.log(`\nLocation: ${locId}`);
      console.log('-'.repeat(80));

      const squareIds = new Set(squarePayments.map(p => p.id));
      const dbIds = new Set(dbPaymentsForLoc.map(p => p.payment_id));

      const missingInDb = Array.from(squareIds).filter(id => !dbIds.has(id));
      const extraInDb = Array.from(dbIds).filter(id => !squareIds.has(id));

      console.log(`Square: ${squareIds.size} payments`);
      console.log(`DB: ${dbIds.size} payments`);
      console.log(`Missing in DB: ${missingInDb.length}`);
      console.log(`Extra in DB: ${extraInDb.length}`);

      const squareRevenue = squarePayments.reduce((sum, p) => sum + ((p.amount_money?.amount || 0) / 100), 0);
      const dbRevenue = dbPaymentsForLoc.reduce((sum, p) => sum + ((p.amount_money_amount || 0) / 100), 0);

      console.log(`Square Revenue: $${squareRevenue.toFixed(2)}`);
      console.log(`DB Revenue: $${dbRevenue.toFixed(2)}`);
      console.log(`Difference: $${(dbRevenue - squareRevenue).toFixed(2)}`);
    });

    console.log('\n' + '═'.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

compareJanuaryByLocation();
