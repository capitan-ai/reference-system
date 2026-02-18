require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function checkDataCompleteness() {
  console.log('🔍 Checking Payment/Order Data Completeness\n');

  try {
    // Get sample payments and orders
    console.log('📊 Sample Payment Record:\n');
    const samplePayment = await prisma.payment.findFirst({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      }
    });

    if (samplePayment) {
      console.log('Keys in Payment record:');
      Object.keys(samplePayment).forEach(key => {
        const value = samplePayment[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          console.log(`  ├─ ${key}: ${JSON.stringify(value).substring(0, 50)}...`);
        } else if (Array.isArray(value)) {
          console.log(`  ├─ ${key}: [Array with ${value.length} items]`);
        } else if (value !== null) {
          console.log(`  ├─ ${key}: ${value}`);
        }
      });
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n📦 Sample Order Record:\n');
    
    const sampleOrder = await prisma.order.findFirst({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      }
    });

    if (sampleOrder) {
      console.log('Keys in Order record:');
      Object.keys(sampleOrder).forEach(key => {
        const value = sampleOrder[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          console.log(`  ├─ ${key}: ${JSON.stringify(value).substring(0, 50)}...`);
        } else if (Array.isArray(value)) {
          console.log(`  ├─ ${key}: [Array with ${value.length} items]`);
        } else if (value !== null && key !== 'raw_json') {
          console.log(`  ├─ ${key}: ${value}`);
        } else if (key === 'raw_json') {
          console.log(`  ├─ ${key}: [JSON object]`);
        }
      });

      // Show order raw_json structure
      if (sampleOrder.raw_json) {
        console.log('\n  📋 raw_json structure:');
        if (sampleOrder.raw_json.total_money) {
          console.log(`    ├─ total_money: ${JSON.stringify(sampleOrder.raw_json.total_money)}`);
        }
        if (sampleOrder.raw_json.line_items && Array.isArray(sampleOrder.raw_json.line_items)) {
          console.log(`    ├─ line_items: [${sampleOrder.raw_json.line_items.length} items]`);
          if (sampleOrder.raw_json.line_items.length > 0) {
            console.log(`      Sample item: ${JSON.stringify(sampleOrder.raw_json.line_items[0]).substring(0, 100)}...`);
          }
        }
      }
    }

    // Data completeness summary
    console.log('\n' + '='.repeat(70));
    console.log('\n📈 DATA COMPLETENESS ANALYSIS\n');

    // Feb stats
    const febBookings = await prisma.booking.count({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      }
    });

    const febPayments = await prisma.payment.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      }
    });

    const febOrders = await prisma.order.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      }
    });

    console.log('February 2026:');
    console.log(`  Bookings:  ${febBookings}`);
    console.log(`  Payments:  ${febPayments} (${((febPayments/febBookings)*100).toFixed(1)}% coverage)`);
    console.log(`  Orders:    ${febOrders} (${((febOrders/febBookings)*100).toFixed(1)}% ratio)`);
    console.log();

    // Check if payments match bookings
    const paymentWithBooking = await prisma.payment.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: { not: null }
      }
    });

    const ordersWithBooking = await prisma.order.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: { not: null }
      }
    });

    console.log('Linking to Bookings:');
    console.log(`  Payments with booking_id: ${paymentWithBooking}`);
    console.log(`  Orders with booking_id: ${ordersWithBooking}`);
    console.log();

    // Check missing data
    console.log('⚠️  Data Quality Issues:');
    if (febPayments < febBookings * 0.5) {
      console.log(`  ❌ LOW PAYMENT COVERAGE: Only ${((febPayments/febBookings)*100).toFixed(1)}% of bookings have payments`);
    } else if (febPayments < febBookings) {
      console.log(`  ⚠️  PARTIAL COVERAGE: ${((febPayments/febBookings)*100).toFixed(1)}% of bookings have payments`);
    } else {
      console.log(`  ✅ GOOD COVERAGE: More payments than bookings`);
    }

    if (paymentWithBooking < febPayments * 0.8) {
      console.log(`  ❌ LINKING ISSUE: Only ${((paymentWithBooking/febPayments)*100).toFixed(1)}% of payments linked to bookings`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDataCompleteness();

