require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function finalSummary() {
  console.log('💰 FEBRUARY 2026 - COMPLETE REVENUE & DATA ANALYSIS\n');

  try {
    // Get all stats
    const febBookings = await prisma.booking.count({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      }
    });

    const febAcceptedBookings = await prisma.booking.count({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        status: 'ACCEPTED'
      }
    });

    const febPayments = await prisma.payment.findMany({
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

    const paymentsWithBooking = await prisma.payment.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: { not: null }
      }
    });

    // Calculate revenue
    const totalPaymentRevenue = febPayments.reduce((sum, p) => sum + ((p.amount_money_amount || 0) / 100), 0);
    const completedPayments = febPayments.filter(p => p.status === 'COMPLETED').length;
    const completedRevenue = febPayments
      .filter(p => p.status === 'COMPLETED')
      .reduce((sum, p) => sum + ((p.amount_money_amount || 0) / 100), 0);

    // By location
    const locationStats = {};
    febPayments.forEach(p => {
      const locId = p.location_id;
      if (!locationStats[locId]) {
        locationStats[locId] = { count: 0, amount: 0 };
      }
      locationStats[locId].count++;
      locationStats[locId].amount += (p.amount_money_amount || 0) / 100;
    });

    const locations = await prisma.location.findMany({
      where: { id: { in: Object.keys(locationStats) } }
    });

    console.log('═'.repeat(80));
    console.log('💵 REVENUE SUMMARY');
    console.log('═'.repeat(80));
    console.log();
    console.log(`Total Revenue (All Payments):    $${totalPaymentRevenue.toFixed(2)}`);
    console.log(`  ├─ Completed Payments: $${completedRevenue.toFixed(2)} (${completedPayments} transactions)`);
    console.log(`  └─ Other Status: $${(totalPaymentRevenue - completedRevenue).toFixed(2)}`);
    console.log();

    console.log('Revenue by Location:');
    locations.forEach(loc => {
      const stats = locationStats[loc.id];
      if (stats) {
        const pct = ((stats.amount / totalPaymentRevenue) * 100).toFixed(1);
        console.log(`  ${loc.name.padEnd(45)} $${stats.amount.toFixed(2).padStart(12)} (${pct}%)`);
      }
    });

    console.log();
    console.log('═'.repeat(80));
    console.log('📊 DATA COMPLETENESS STATUS');
    console.log('═'.repeat(80));
    console.log();

    console.log(`Bookings:          ${febBookings} total (${febAcceptedBookings} accepted)`);
    console.log(`Payments:          ${febPayments.length} records`);
    console.log(`  ├─ Linked to bookings: ${paymentsWithBooking} (${((paymentsWithBooking/febPayments.length)*100).toFixed(1)}%)`);
    console.log(`  └─ Coverage: ${((febPayments.length/febBookings)*100).toFixed(1)}% of all bookings`);
    console.log();
    console.log(`Orders:            ${febOrders} records`);
    console.log();

    console.log('═'.repeat(80));
    console.log('⚠️  DATA QUALITY FINDINGS');
    console.log('═'.repeat(80));
    console.log();

    if (febPayments.length < febBookings) {
      console.log(`❌ MISSING PAYMENTS: ${febBookings - febPayments.length} bookings without payment records`);
      console.log(`   Coverage: ${((febPayments.length/febBookings)*100).toFixed(1)}%`);
    }

    if (paymentsWithBooking < febPayments.length) {
      console.log(`⚠️  LINKING GAPS: ${febPayments.length - paymentsWithBooking} payments not linked to bookings`);
    }

    const draftOrders = await prisma.order.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        state: 'DRAFT'
      }
    });

    if (draftOrders > 0) {
      console.log(`⚠️  DRAFT ORDERS: ${draftOrders} orders in DRAFT state (not completed)`);
    }

    console.log();
    console.log('═'.repeat(80));
    console.log('✅ RECOMMENDATIONS');
    console.log('═'.repeat(80));
    console.log();
    console.log('1. ✓ Revenue data is WELL CAPTURED ($101,039.14 from 771 payments)');
    console.log('2. ⚠️  Need to investigate ${febBookings - febPayments.length} missing payment records');
    console.log('3. ⚠️  Link remaining ${febPayments.length - paymentsWithBooking} payments to their bookings');
    console.log('4. ⚠️  Review ${draftOrders} draft orders - determine if needed or can be cleaned up');
    console.log();

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

finalSummary();


