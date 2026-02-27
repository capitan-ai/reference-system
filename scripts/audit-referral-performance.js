/**
 * Audit script that fetches ALL bookings from the last 5 months from the DB,
 * then checks Square for each customer's custom attributes.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const prisma = require('../lib/prisma-client');
const { Client, Environment } = require('square');

// Initialize Square client
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENV === 'production' ? Environment.Production : Environment.Sandbox,
});

const customersApi = squareClient.customersApi;
const customerCustomAttributesApi = squareClient.customerCustomAttributesApi;

async function runFullDbAudit() {
  console.log('🚀 Starting Full DB-based Referral Audit (Last 5 Months)...');
  
  const fiveMonthsAgo = new Date();
  fiveMonthsAgo.setMonth(fiveMonthsAgo.getMonth() - 5);

  try {
    // Step 1: Get all unique customers from bookings in the last 5 months
    console.log(`Step 1: Fetching customers from bookings since ${fiveMonthsAgo.toISOString()}...`);
    const customersFromBookings = await prisma.booking.findMany({
      where: {
        start_at: { gte: fiveMonthsAgo },
        customer_id: { not: null }
      },
      select: {
        customer_id: true,
        booking_id: true,
        start_at: true,
        status: true
      },
      orderBy: { start_at: 'asc' }
    });

    // Group by customer to get their first booking in this period
    const customerMap = new Map();
    for (const b of customersFromBookings) {
      if (!customerMap.has(b.customer_id)) {
        customerMap.set(b.customer_id, b);
      }
    }

    const uniqueCustomerIds = Array.from(customerMap.keys());
    console.log(`✅ Found ${uniqueCustomerIds.length} unique customers with bookings.`);

    const auditResults = {
      totalScanned: 0,
      codesFound: 0,
      paidReferrals: 0,
      missedRewards: 0,
      details: []
    };

    // Step 2: Check each customer in Square
    console.log('Step 2: Checking Square Custom Attributes for each customer...');
    
    for (let i = 0; i < uniqueCustomerIds.length; i++) {
      const customerId = uniqueCustomerIds[i];
      auditResults.totalScanned++;

      if (i % 10 === 0) {
        console.log(`Processing ${i + 1}/${uniqueCustomerIds.length}...`);
      }

      try {
        const response = await customerCustomAttributesApi.listCustomerCustomAttributes(customerId);
        const attributes = response.result.customAttributes || [];
        
        const referralAttr = attributes.find(attr => 
          attr.key === 'referral_code' || 
          attr.key.toLowerCase().includes('referral')
        );

        if (referralAttr && referralAttr.value) {
          const referralCode = referralAttr.value;
          auditResults.codesFound++;

          // Check for payment
          const firstPayment = await prisma.payment.findFirst({
            where: { customer_id: customerId, status: 'COMPLETED' },
            orderBy: { created_at: 'asc' }
          });

          // Check for existing reward
          const reward = await prisma.referralReward.findFirst({
            where: { referred_customer_id: customerId, reward_type: 'referrer_reward' }
          });

          const hasPaid = !!firstPayment;
          const hasReward = !!reward;

          if (hasPaid) auditResults.paidReferrals++;
          if (hasPaid && !hasReward) auditResults.missedRewards++;

          auditResults.details.push({
            customerId,
            referralCode,
            firstBookingDate: customerMap.get(customerId).start_at,
            firstPaymentDate: firstPayment?.created_at,
            status: hasReward ? 'PAID' : (hasPaid ? 'MISSED' : 'PENDING_PAYMENT')
          });
        }

        // Rate limiting
        await new Promise(r => setTimeout(resolve, 150));
      } catch (err) {
        if (err.statusCode === 404) {
          // Customer might not exist in Square anymore or has no attributes
        } else {
          console.error(`Error for ${customerId}:`, err.message);
        }
      }
    }

    // Final Report
    console.log('\n====================================');
    console.log('📊 FINAL DB-DRIVEN AUDIT REPORT');
    console.log('====================================');
    console.log(`Total Customers Checked: ${auditResults.totalScanned}`);
    console.log(`Referral Codes Found:    ${auditResults.codesFound}`);
    console.log(`New Paid Customers:      ${auditResults.paidReferrals}`);
    console.log(`Missed Rewards (Errors): ${auditResults.missedRewards}`);
    console.log(`Total Value:             $${auditResults.paidReferrals * 10}`);
    console.log('====================================\n');

    const fs = require('fs');
    const reportPath = `./referral_full_audit_${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify(auditResults, null, 2));
    console.log(`Report saved to: ${reportPath}`);

  } catch (error) {
    console.error('❌ Audit failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

runFullDbAudit();
