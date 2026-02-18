#!/usr/bin/env node
require('dotenv').config();
const { Client, Environment } = require('square');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const orgId = 'd0e24178-2f94-4033-bc91-41f22df58278';

async function compareJanuaryData() {
  const client = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: Environment.Production
  });

  const paymentsApi = client.paymentsApi;

  try {
    console.log('📅 Comparing January 2026 Payments: Square vs Database\n');
    console.log('='.repeat(100));

    // Get all January payments from Square
    console.log('📥 Fetching January payments from Square API...');
    
    let allSquarePayments = [];
    let cursor = null;
    let pageNum = 0;

    while (true) {
      pageNum++;
      
      const response = await paymentsApi.listPayments(
        '2026-01-01T00:00:00Z',
        '2026-02-01T00:00:00Z',
        'DESC',
        cursor,
        null,
        null,
        null,
        null,
        null,
        null,
        100
      );

      if (response.payments) {
        allSquarePayments = allSquarePayments.concat(response.payments);
        console.log(`  Page ${pageNum}: ${response.payments.length} payments (total: ${allSquarePayments.length})`);
      }

      cursor = response.cursor;
      if (!cursor) break;
    }

    console.log(`✅ Total from Square: ${allSquarePayments.length} payments\n`);

    // Get January payments from DB
    console.log('📥 Fetching January payments from database...');
    const dbPayments = await prisma.payment.findMany({
      where: {
        organization_id: orgId,
        created_at: {
          gte: new Date('2026-01-01T00:00:00Z'),
          lt: new Date('2026-02-01T00:00:00Z')
        }
      },
      select: {
        payment_id: true,
        amount_money_amount: true,
        status: true,
        order_id: true,
        created_at: true
      }
    });

    console.log(`✅ Total in database: ${dbPayments.length} payments\n`);

    console.log('='.repeat(100));
    console.log('\n💳 COMPARISON ANALYSIS:\n');

    // Create maps
    const squarePaymentIds = new Map();
    allSquarePayments.forEach(p => {
      squarePaymentIds.set(p.id, {
        amount: (p.amount_money?.amount || 0) / 100,
        status: p.status,
        created_at: p.created_at
      });
    });

    const dbPaymentIds = new Map();
    dbPayments.forEach(p => {
      dbPaymentIds.set(p.payment_id, {
        amount: (p.amount_money_amount || 0) / 100,
        status: p.status,
        created_at: p.created_at
      });
    });

    // Find differences
    const inSquareNotDb = Array.from(squarePaymentIds.keys()).filter(id => !dbPaymentIds.has(id));
    const inDbNotSquare = Array.from(dbPaymentIds.keys()).filter(id => !squarePaymentIds.has(id));

    console.log(`📊 Summary:`);
    console.log(`Square: ${squarePaymentIds.size}`);
    console.log(`DB: ${dbPaymentIds.size}`);
    console.log(`\n❌ Missing in DB: ${inSquareNotDb.length} (from Square)`);
    console.log(`⚠️  Extra in DB: ${inDbNotSquare.length} (not in Square)`);

    if (inSquareNotDb.length > 0) {
      console.log(`\nSample of missing payments (first 10):`);
      console.log('-'.repeat(100));
      inSquareNotDb.slice(0, 10).forEach((id, idx) => {
        const payment = squarePaymentIds.get(id);
        console.log(`${idx+1}. ${id.substring(0, 25)}... | $${payment.amount.toFixed(2)} | ${payment.status} | ${payment.created_at.substring(0, 10)}`);
      });
      if (inSquareNotDb.length > 10) {
        console.log(`... and ${inSquareNotDb.length - 10} more`);
      }
    }

    if (inDbNotSquare.length > 0) {
      console.log(`\nSample of extra payments in DB (first 10):`);
      console.log('-'.repeat(100));
      inDbNotSquare.slice(0, 10).forEach((id, idx) => {
        const payment = dbPaymentIds.get(id);
        console.log(`${idx+1}. ${id.substring(0, 25)}... | $${payment.amount.toFixed(2)} | ${payment.status}`);
      });
      if (inDbNotSquare.length > 10) {
        console.log(`... and ${inDbNotSquare.length - 10} more`);
      }
    }

    // Revenue comparison
    console.log('\n\n💵 Revenue:');
    console.log('-'.repeat(100));
    
    const squareRevenue = Array.from(squarePaymentIds.values())
      .reduce((sum, p) => sum + p.amount, 0);
    
    const dbRevenue = Array.from(dbPaymentIds.values())
      .reduce((sum, p) => sum + p.amount, 0);

    console.log(`Square: $${squareRevenue.toFixed(2)}`);
    console.log(`DB: $${dbRevenue.toFixed(2)}`);
    console.log(`Difference: $${(dbRevenue - squareRevenue).toFixed(2)}`);

    // Status check
    console.log('\n\n📋 Status Distribution (DB):');
    console.log('-'.repeat(100));
    const statusCount = {};
    dbPayments.forEach(p => {
      statusCount[p.status] = (statusCount[p.status] || 0) + 1;
    });
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(`${status}: ${count}`);
    });

    console.log('\n' + '='.repeat(100));

    await prisma.$disconnect();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.errors) {
      console.error('Errors:', error.errors);
    }
    process.exit(1);
  }
}

compareJanuaryData();
