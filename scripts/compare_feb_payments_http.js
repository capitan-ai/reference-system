require('dotenv').config();
const axios = require('axios');
const prisma = require('../lib/prisma-client');

async function comparePayments() {
  console.log('🚀 Starting February 2026 Payments Comparison...');
  
  let accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (accessToken) {
    accessToken = accessToken.trim();
    if (accessToken.startsWith('Bearer ')) {
      accessToken = accessToken.slice(7);
    }
  }
  const env = process.env.SQUARE_ENVIRONMENT || 'production';
  const baseUrl = env === 'sandbox' 
    ? 'https://connect.squareupsandbox.com/v2' 
    : 'https://connect.squareup.com/v2';

  if (!accessToken) {
    console.error('❌ SQUARE_ACCESS_TOKEN is missing');
    return;
  }

  const beginTime = '2026-02-01T00:00:00Z';
  const endTime = '2026-03-01T00:00:00Z';

  try {
    console.log('\n--- Fetching Locations ---');
    const locationsResponse = await axios.get(`${baseUrl}/locations`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Square-Version': '2025-02-20'
      }
    });
    const locations = locationsResponse.data.locations || [];
    console.log(`✅ Found ${locations.length} locations.`);

    console.log(`\n--- Fetching Payments from Square for ALL Locations (${beginTime} to ${endTime}) ---`);
    
    let squarePayments = [];
    
    for (const loc of locations) {
      console.log(`\n📍 Processing location: ${loc.name} (${loc.id})`);
      let cursor = null;
      let locPaymentsCount = 0;
      
      do {
        console.log(`  Requesting Square API (cursor: ${cursor ? cursor.substring(0, 10) + '...' : 'none'})...`);
        const response = await axios.get(`${baseUrl}/payments`, {
          params: {
            begin_time: beginTime,
            end_time: endTime,
            location_id: loc.id,
            cursor: cursor || undefined,
            limit: 100
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Square-Version': '2025-02-20',
            'Accept': 'application/json'
          }
        });
        
        const payments = response.data.payments || [];
        console.log(`    Received ${payments.length} payments.`);
        squarePayments = squarePayments.concat(payments);
        locPaymentsCount += payments.length;
        cursor = response.data.cursor;
      } while (cursor);
      
      console.log(`  ✅ Total for ${loc.name}: ${locPaymentsCount}`);
    }

    console.log(`✅ Total Square payments found: ${squarePayments.length}`);

    // Fetch from DB
    console.log('\n--- Fetching Payments from DB ---');
    const dbPayments = await prisma.payment.findMany({
      where: {
        created_at: {
          gte: new Date(beginTime),
          lt: new Date(endTime)
        }
      }
    });
    console.log(`✅ Total DB payments found: ${dbPayments.length}`);

    const squareIds = new Set(squarePayments.map(p => p.id));
    const dbIds = new Set(dbPayments.map(p => p.payment_id));

    const missingInDb = squarePayments.filter(p => !dbIds.has(p.id));
    const extraInDb = dbPayments.filter(p => !squareIds.has(p.payment_id));

    console.log('\n--- Comparison Results ---');
    console.log(`Square Count: ${squarePayments.length}`);
    console.log(`DB Count:     ${dbPayments.length}`);
    console.log(`Missing in DB: ${missingInDb.length}`);
    console.log(`Extra in DB:   ${extraInDb.length}`);

    if (missingInDb.length > 0) {
      console.log('\nSample Missing Payments (Square IDs not in DB):');
      console.log(missingInDb.slice(0, 10).map(p => ({
        id: p.id,
        created_at: p.created_at,
        status: p.status,
        amount: `${p.amount_money.amount} ${p.amount_money.currency}`,
        order_id: p.order_id
      })));
    }

  } catch (error) {
    console.error('❌ Error:', error.response ? error.response.data : error.message);
  } finally {
    await prisma.$disconnect();
  }
}

comparePayments();

