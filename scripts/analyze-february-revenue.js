require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function analyzeFebruaryRevenue() {
  console.log('💰 February 2026 Revenue Analysis\n');

  try {
    // Check what payment/order models exist
    console.log('📊 Checking database for payments/orders data...\n');

    // Get all payments for February 2026
    const febPayments = await prisma.payment.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      },
      select: {
        id: true,
        payment_id: true,
        amount_money_amount: true,
        amount_money_currency: true,
        status: true,
        created_at: true,
        location: { select: { name: true } }
      }
    });

    console.log(`✅ February 2026 Payments: ${febPayments.length}\n`);

    if (febPayments.length === 0) {
      console.log('⚠️  No payments found in database for February 2026\n');
    } else {
      // Calculate total revenue
      let totalRevenue = 0;
      const byStatus = {};
      const byLocation = {};
      const byCurrency = {};

      febPayments.forEach(payment => {
        const amount = (payment.amount_money_amount || 0) / 100; // Convert from cents
        totalRevenue += amount;
        const currency = payment.amount_money_currency || 'USD';

        // By status
        if (!byStatus[payment.status]) {
          byStatus[payment.status] = { count: 0, total: 0 };
        }
        byStatus[payment.status].count++;
        byStatus[payment.status].total += amount;

        // By location
        if (!byLocation[payment.location.name]) {
          byLocation[payment.location.name] = { count: 0, total: 0 };
        }
        byLocation[payment.location.name].count++;
        byLocation[payment.location.name].total += amount;

        // By currency
        if (!byCurrency[currency]) {
          byCurrency[currency] = { count: 0, total: 0 };
        }
        byCurrency[currency].count++;
        byCurrency[currency].total += amount;
      });

      console.log('💵 TOTAL REVENUE (February 2026): $' + totalRevenue.toFixed(2));
      console.log();

      // By Status
      console.log('📈 Revenue by Payment Status:');
      console.log('━'.repeat(60));
      Object.entries(byStatus)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([status, data]) => {
          console.log(`  ${status.padEnd(30)} ${data.count.toString().padStart(4)} payments  $${data.total.toFixed(2).padStart(12)}`);
        });

      console.log();

      // By Location
      console.log('📍 Revenue by Location:');
      console.log('━'.repeat(60));
      Object.entries(byLocation)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([loc, data]) => {
          const percentage = ((data.total / totalRevenue) * 100).toFixed(1);
          console.log(`  ${loc.padEnd(40)} ${data.count.toString().padStart(4)} payments  $${data.total.toFixed(2).padStart(12)} (${percentage}%)`);
        });

      console.log();

      // By Currency
      console.log('💱 Revenue by Currency:');
      console.log('━'.repeat(60));
      Object.entries(byCurrency).forEach(([currency, data]) => {
        console.log(`  ${currency} $${data.total.toFixed(2)} (${data.count} payments)`);
      });

      console.log();

      // Payment methods breakdown
      console.log('💳 Sample Payment Records (first 5):');
      console.log('━'.repeat(60));
      const samplePayments = febPayments.slice(0, 5);
      samplePayments.forEach((p, idx) => {
        const amount = ((p.amount_money_amount || 0) / 100).toFixed(2);
        const date = new Date(p.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        console.log(`  ${idx + 1}. ID: ${p.payment_id?.substring(0, 20) || 'N/A'}... $${amount} (${p.status})`);
      });
    }

    // Check for orders
    console.log('\n' + '='.repeat(70));
    console.log('\n📦 Checking for Orders Data...\n');

    const febOrders = await prisma.order.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      },
      select: {
        id: true,
        order_id: true,
        state: true,
        created_at: true,
        raw_json: true,
        location: { select: { name: true } }
      }
    });

    console.log(`✅ February 2026 Orders: ${febOrders.length}\n`);

    if (febOrders.length === 0) {
      console.log('⚠️  No orders found in database for February 2026\n');
    } else {
      let totalOrderRevenue = 0;
      const orderByState = {};
      const orderByLocation = {};

      febOrders.forEach(order => {
        let amount = 0;
        if (order.raw_json?.total_money) {
          amount = (order.raw_json.total_money.amount || 0) / 100;
        }
        totalOrderRevenue += amount;

        if (!orderByState[order.state]) {
          orderByState[order.state] = { count: 0, total: 0 };
        }
        orderByState[order.state].count++;
        orderByState[order.state].total += amount;

        if (!orderByLocation[order.location.name]) {
          orderByLocation[order.location.name] = { count: 0, total: 0 };
        }
        orderByLocation[order.location.name].count++;
        orderByLocation[order.location.name].total += amount;
      });

      console.log('💵 TOTAL ORDER REVENUE (February 2026): $' + totalOrderRevenue.toFixed(2));
      console.log();

      console.log('📈 Orders by State:');
      console.log('━'.repeat(60));
      Object.entries(orderByState)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([state, data]) => {
          console.log(`  ${state.padEnd(30)} ${data.count.toString().padStart(4)} orders   $${data.total.toFixed(2).padStart(12)}`);
        });

      console.log();
      console.log('📍 Orders by Location:');
      console.log('━'.repeat(60));
      Object.entries(orderByLocation)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([loc, data]) => {
          const percentage = totalOrderRevenue > 0 ? ((data.total / totalOrderRevenue) * 100).toFixed(1) : '0.0';
          console.log(`  ${loc.padEnd(40)} ${data.count.toString().padStart(4)} orders   $${data.total.toFixed(2).padStart(12)} (${percentage}%)`);
        });
    }

    // Summary comparison
    console.log('\n' + '='.repeat(70));
    console.log('\n📊 SUMMARY - February 2026\n');

    const totalPaymentRevenue = febPayments.reduce((sum, p) => sum + ((p.amount_money_amount || 0) / 100), 0);
    const totalOrderRevenue = febOrders.reduce((sum, o) => {
      let amount = 0;
      if (o.raw_json?.total_money) {
        amount = (o.raw_json.total_money.amount || 0) / 100;
      }
      return sum + amount;
    }, 0);

    console.log(`Payments found: ${febPayments.length}`);
    console.log(`  Total: $${totalPaymentRevenue.toFixed(2)}`);
    console.log();
    console.log(`Orders found: ${febOrders.length}`);
    console.log(`  Total: $${totalOrderRevenue.toFixed(2)}`);
    console.log();
    console.log(`Combined Total Revenue: $${(totalPaymentRevenue + totalOrderRevenue).toFixed(2)}`);

    // Check for data completeness
    console.log('\n' + '='.repeat(70));
    console.log('\n🔍 DATA COMPLETENESS CHECK\n');

    // Compare with bookings
    const febBookingsCount = await prisma.booking.count({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        status: 'ACCEPTED'
      }
    });

    console.log(`✅ February Accepted Bookings: ${febBookingsCount}`);
    console.log(`✅ February Payment Records: ${febPayments.length}`);
    console.log(`✅ February Order Records: ${febOrders.length}`);
    console.log();

    if (febPayments.length === 0 && febOrders.length === 0) {
      console.log('⚠️  WARNING: No payment or order data found for February!');
      console.log('   This may indicate:');
      console.log('   - Payment/order syncing is not working');
      console.log('   - Data is stored in a different location');
      console.log('   - No revenue has been recorded yet');
    } else if (febPayments.length < febBookingsCount * 0.5) {
      console.log('⚠️  WARNING: Payment count is much lower than booking count');
      console.log(`   Ratio: ${(febPayments.length / febBookingsCount * 100).toFixed(1)}% of bookings have payments`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeFebruaryRevenue();
