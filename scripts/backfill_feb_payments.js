require('dotenv').config();
const prisma = require('../lib/prisma-client');
const axios = require('axios');

async function backfillPayments() {
  console.log('🚀 Starting backfill for 2 missing failed payments...');
  
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

  const missingPaymentIds = [
    'hmBZ3I6v2vDm5M36WXna64XGG1ZZY',
    'Nw9W5QstR80WmqayW2X0FNWGSl6YY'
  ];

  // Actual mappings from DB
  const locationMap = {
    'LT4ZHFBQQYB2N': '9dc99ffe-8904-4f9b-895f-f1f006d0d380', // Union St
    'LNQKVBTQZN3EZ': '01ae4ff0-f69d-48d8-ab12-ccde01ce0abc'  // Pacific Ave
  };
  const organizationId = 'd0e24178-2f94-4033-bc91-41f22df58278';

  for (const id of missingPaymentIds) {
    try {
      console.log(`\nFetching payment ${id}...`);
      const response = await axios.get(`${baseUrl}/payments/${id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Square-Version': '2025-02-20',
          'Accept': 'application/json'
        }
      });
      
      const p = response.data.payment;
      const locationUuid = locationMap[p.location_id];
      
      if (!locationUuid) {
        console.error(`❌ Unknown Square location ID: ${p.location_id} for payment ${id}`);
        continue;
      }

      console.log(`Upserting payment ${id} into DB...`);
      
      // Map Square payment to your DB schema
      await prisma.$executeRaw`
        INSERT INTO payments (
          payment_id, 
          organization_id, 
          location_id, 
          customer_id, 
          order_id,
          amount_money_amount, 
          amount_money_currency,
          tip_money_amount,
          total_money_amount,
          status, 
          event_type,
          created_at, 
          updated_at
        ) VALUES (
          ${p.id}, 
          ${organizationId}::uuid,
          ${locationUuid}::uuid, 
          ${p.customer_id || null},
          NULL, -- We don't have the internal order UUID easily, and it's optional
          ${p.amount_money.amount},
          ${p.amount_money.currency},
          ${p.tip_money?.amount || 0},
          ${p.total_money.amount},
          ${p.status}, 
          'payment.updated',
          ${p.created_at}::timestamptz, 
          ${p.updated_at}::timestamptz
        )
        ON CONFLICT (organization_id, payment_id) DO UPDATE SET
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `;
      
      console.log(`✅ Successfully backfilled payment ${id}`);
    } catch (err) {
      console.error(`❌ Failed to backfill payment ${id}:`, err.response?.data || err.message);
    }
  }

  console.log('\n✨ Payment backfill completed.');
  await prisma.$disconnect();
}

backfillPayments();

