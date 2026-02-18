require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

async function compareJanuaryPaymentsWithSquare() {
  console.log('🔍 Comparing January Payments: Square vs Database\n');

  try {
    // Get all January payments from Square
    console.log('📥 Fetching all January payments from Square API...\n');

    let allSquarePayments = [];
    let cursor = null;
    let pageCount = 0;

    // Get all pages
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
        console.log(`  Page ${pageCount}: ${data.payments.length} payments (total: ${allSquarePayments.length})`);
      }

      // Check for next page
      if (data.cursor) {
        cursor = data.cursor;
      } else {
        break;
      }
    }

    console.log(`✅ Total payments from Square: ${allSquarePayments.length}\n`);

    // Get all January payments from DB
    console.log('📥 Fetching all January payments from database...');
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
        order_id: true,
        created_at: true
      }
    });

    console.log(`✅ Total payments in database: ${dbPayments.length}\n`);

    // Compare
    console.log('═'.repeat(80));
    console.log('🔎 COMPARISON ANALYSIS\n');

    // Create sets for comparison
    const squarePaymentIds = new Set(allSquarePayments.map(p => p.id));
    const dbPaymentIds = new Set(dbPayments.map(p => p.payment_id));

    // Find differences
    const paymentsInSquareNotDb = Array.from(squarePaymentIds).filter(id => !dbPaymentIds.has(id));
    const paymentsInDbNotSquare = Array.from(dbPaymentIds).filter(id => !squarePaymentIds.has(id));

    console.log('📊 PAYMENT IDs:\n');
    console.log(`Square total: ${squarePaymentIds.size}`);
    console.log(`DB total: ${dbPaymentIds.size}`);
    console.log(`Difference: ${squarePaymentIds.size - dbPaymentIds.size}`);
    console.log();

    if (paymentsInSquareNotDb.length > 0) {
      console.log(`❌ MISSING IN DB: ${paymentsInSquareNotDb.length} payments from Square not in DB`);
      paymentsInSquareNotDb.slice(0, 10).forEach((id, idx) => {
        const sqPayment = allSquarePayments.find(p => p.id === id);
        const amount = ((sqPayment.amount_money?.amount || 0) / 100).toFixed(2);
        const date = new Date(sqPayment.created_at).toLocaleDateString();
        console.log(`  ${idx + 1}. ${id.substring(0, 20)}... - $${amount} (${date})`);
      });
      if (paymentsInSquareNotDb.length > 10) {
        console.log(`  ... and ${paymentsInSquareNotDb.length - 10} more`);
      }
    } else {
      console.log('✅ All Square payments are in DB');
    }

    console.log();

    if (paymentsInDbNotSquare.length > 0) {
      console.log(`⚠️  EXTRA IN DB: ${paymentsInDbNotSquare.length} payments in DB not in Square`);
      paymentsInDbNotSquare.slice(0, 5).forEach((id, idx) => {
        const dbPayment = dbPayments.find(p => p.payment_id === id);
        const amount = ((dbPayment.amount_money_amount || 0) / 100).toFixed(2);
        const date = new Date(dbPayment.created_at).toLocaleDateString();
        console.log(`  ${idx + 1}. ${id.substring(0, 20)}... - $${amount} (${date})`);
      });
      if (paymentsInDbNotSquare.length > 5) {
        console.log(`  ... and ${paymentsInDbNotSquare.length - 5} more`);
      }
    } else {
      console.log('✅ No extra payments in DB');
    }

    // Revenue comparison
    console.log('\n' + '═'.repeat(80));
    console.log('\n💵 REVENUE COMPARISON:\n');

    const squareRevenue = allSquarePayments.reduce((sum, p) => sum + ((p.amount_money?.amount || 0) / 100), 0);
    const dbRevenue = dbPayments.reduce((sum, p) => sum + ((p.amount_money_amount || 0) / 100), 0);

    console.log(`Square Total: $${squareRevenue.toFixed(2)}`);
    console.log(`DB Total:     $${dbRevenue.toFixed(2)}`);
    console.log(`Difference:   $${(squareRevenue - dbRevenue).toFixed(2)}`);

    // Final verdict
    console.log('\n' + '═'.repeat(80));
    console.log('\n✅ FINAL VERDICT:\n');

    if (paymentsInSquareNotDb.length === 0 && paymentsInDbNotSquare.length === 0) {
      console.log('✅ PAYMENTS: Perfect sync between Square and DB');
    } else {
      console.log(`⚠️  PAYMENTS: ${paymentsInSquareNotDb.length + paymentsInDbNotSquare.length} discrepancies found`);
    }

    if (Math.abs(squareRevenue - dbRevenue) < 1) {
      console.log('✅ REVENUE: Matches perfectly');
    } else {
      console.log(`⚠️  REVENUE: Difference of $${(squareRevenue - dbRevenue).toFixed(2)}`);
    }

    if (paymentsInSquareNotDb.length > 0) {
      console.log(`\n📋 ACTION: Sync ${paymentsInSquareNotDb.length} missing payments from Square`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

compareJanuaryPaymentsWithSquare();
