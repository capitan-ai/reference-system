#!/usr/bin/env node
require('dotenv').config();
const prisma = require('../lib/prisma-client');

(async () => {
  const CUSTOMER_ID = 'WGKFCXD42JE1QPFBNX5DS2D0NG';
  
  // Check when first_payment_completed was set
  const customer = await prisma.$queryRaw`
    SELECT 
      square_customer_id,
      first_payment_completed,
      updated_at,
      created_at
    FROM square_existing_clients
    WHERE square_customer_id = ${CUSTOMER_ID}
  `;
  
  console.log('Customer timeline:');
  console.log(JSON.stringify(customer[0], null, 2));
  
  const paymentTime = new Date(customer[0].updated_at);
  const beforeTime = new Date(paymentTime.getTime() - 3600000); // 1 hour before
  const afterTime = new Date(paymentTime.getTime() + 3600000); // 1 hour after
  
  console.log('\nChecking for payment runs between:', beforeTime.toISOString(), 'and', afterTime.toISOString());
  
  // Check for payment runs around that time
  const paymentRuns = await prisma.$queryRaw`
    SELECT 
      id,
      correlation_id,
      square_event_type,
      stage,
      status,
      last_error,
      context,
      created_at,
      updated_at
    FROM giftcard_runs
    WHERE square_event_type = 'payment.updated'
      AND created_at >= ${beforeTime}
      AND created_at <= ${afterTime}
    ORDER BY created_at DESC
    LIMIT 20
  `;
  
  console.log('\nPayment runs around that time:', paymentRuns.length);
  paymentRuns.forEach((r, idx) => {
    console.log(`\n${idx + 1}. Run: ${r.correlation_id}`);
    console.log(`   Stage: ${r.stage}`);
    console.log(`   Status: ${r.status}`);
    console.log(`   Created: ${r.created_at}`);
    console.log(`   Updated: ${r.updated_at}`);
    if (r.last_error) {
      console.log(`   ❌ Error: ${r.last_error.substring(0, 300)}`);
    }
    if (r.context) {
      try {
        const ctx = typeof r.context === 'string' ? JSON.parse(r.context) : r.context;
        if (ctx.customerId) {
          console.log(`   Customer ID in context: ${ctx.customerId}`);
          if (ctx.customerId === CUSTOMER_ID) {
            console.log(`   ✅ THIS IS THE RIGHT RUN!`);
          }
        }
      } catch (e) {
        // ignore
      }
    }
  });
  
  // Also check for runs with this customer ID in context
  const customerRuns = await prisma.$queryRaw`
    SELECT 
      id,
      correlation_id,
      square_event_type,
      stage,
      status,
      last_error,
      context,
      created_at
    FROM giftcard_runs
    WHERE context::text LIKE ${`%${CUSTOMER_ID}%`}
    ORDER BY created_at DESC
    LIMIT 10
  `;
  
  console.log('\n\nRuns with customer ID in context:', customerRuns.length);
  customerRuns.forEach((r, idx) => {
    console.log(`\n${idx + 1}. Run: ${r.correlation_id}`);
    console.log(`   Event: ${r.square_event_type}`);
    console.log(`   Stage: ${r.stage}`);
    console.log(`   Status: ${r.status}`);
    console.log(`   Created: ${r.created_at}`);
    if (r.last_error) {
      console.log(`   ❌ Error: ${r.last_error.substring(0, 300)}`);
    }
  });
  
  await prisma.$disconnect();
})();

