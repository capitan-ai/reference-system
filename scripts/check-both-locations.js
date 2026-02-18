require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function checkBothLocations() {
  console.log('📍 CHECKING BOTH LOCATIONS - February 2026\n');

  try {
    // Get locations
    const locations = await prisma.location.findMany({
      where: { organization_id: ORG_ID },
      select: { id: true, name: true }
    });

    console.log('Locations in system:');
    locations.forEach(loc => {
      console.log(`  • ${loc.name} (${loc.id})`);
    });

    console.log('\n' + '═'.repeat(80));
    console.log('\n📊 FEBRUARY DATA BY LOCATION:\n');

    for (const location of locations) {
      console.log(`\n🏪 ${location.name}`);
      console.log('-'.repeat(80));

      // Bookings
      const bookingStats = await prisma.booking.groupBy({
        by: ['status'],
        where: {
          organization_id: ORG_ID,
          location_id: location.id,
          start_at: {
            gte: new Date('2026-02-01T00:00:00Z'),
            lt: new Date('2026-03-01T00:00:00Z')
          }
        },
        _count: true
      });

      const totalBookings = bookingStats.reduce((sum, s) => sum + s._count, 0);
      console.log(`\n  📌 Bookings: ${totalBookings}`);
      bookingStats.forEach(stat => {
        console.log(`     ├─ ${stat.status}: ${stat._count}`);
      });

      // Payments
      const paymentStats = await prisma.payment.groupBy({
        by: ['status'],
        where: {
          organization_id: ORG_ID,
          location_id: location.id,
          created_at: {
            gte: new Date('2026-02-01T00:00:00Z'),
            lt: new Date('2026-03-01T00:00:00Z')
          }
        },
        _count: true,
        _sum: {
          amount_money_amount: true
        }
      });

      const totalPayments = paymentStats.reduce((sum, s) => sum + s._count, 0);
      const totalPaymentAmount = paymentStats.reduce((sum, s) => sum + ((s._sum.amount_money_amount || 0) / 100), 0);
      
      console.log(`\n  💵 Payments: ${totalPayments} ($${totalPaymentAmount.toFixed(2)})`);
      paymentStats.forEach(stat => {
        const amount = ((stat._sum.amount_money_amount || 0) / 100).toFixed(2);
        console.log(`     ├─ ${stat.status}: ${stat._count} ($${amount})`);
      });

      // Orders
      const orderStats = await prisma.order.groupBy({
        by: ['state'],
        where: {
          organization_id: ORG_ID,
          location_id: location.id,
          created_at: {
            gte: new Date('2026-02-01T00:00:00Z'),
            lt: new Date('2026-03-01T00:00:00Z')
          }
        },
        _count: true
      });

      const totalOrders = orderStats.reduce((sum, s) => sum + s._count, 0);
      console.log(`\n  📦 Orders: ${totalOrders}`);
      orderStats.forEach(stat => {
        console.log(`     ├─ ${stat.state}: ${stat._count}`);
      });

      // Ratio
      console.log(`\n  📊 Metrics:`);
      console.log(`     ├─ Payment Coverage: ${((totalPayments/totalBookings)*100).toFixed(1)}% of bookings`);
      if (totalBookings > 0) {
        console.log(`     └─ Avg Revenue/Booking: $${(totalPaymentAmount/totalBookings).toFixed(2)}`);
      }
    }

    // Comparison
    console.log('\n' + '═'.repeat(80));
    console.log('\n🔄 LOCATION COMPARISON:\n');

    const locStats = [];
    for (const location of locations) {
      const bookingCount = await prisma.booking.count({
        where: {
          organization_id: ORG_ID,
          location_id: location.id,
          start_at: {
            gte: new Date('2026-02-01T00:00:00Z'),
            lt: new Date('2026-03-01T00:00:00Z')
          }
        }
      });

      const paymentCount = await prisma.payment.count({
        where: {
          organization_id: ORG_ID,
          location_id: location.id,
          created_at: {
            gte: new Date('2026-02-01T00:00:00Z'),
            lt: new Date('2026-03-01T00:00:00Z')
          }
        }
      });

      const paymentAmount = await prisma.payment.aggregate({
        where: {
          organization_id: ORG_ID,
          location_id: location.id,
          created_at: {
            gte: new Date('2026-02-01T00:00:00Z'),
            lt: new Date('2026-03-01T00:00:00Z')
          }
        },
        _sum: {
          amount_money_amount: true
        }
      });

      const orderCount = await prisma.order.count({
        where: {
          organization_id: ORG_ID,
          location_id: location.id,
          created_at: {
            gte: new Date('2026-02-01T00:00:00Z'),
            lt: new Date('2026-03-01T00:00:00Z')
          }
        }
      });

      locStats.push({
        name: location.name,
        bookings: bookingCount,
        payments: paymentCount,
        revenue: ((paymentAmount._sum.amount_money_amount || 0) / 100),
        orders: orderCount
      });
    }

    const totalBookings = locStats.reduce((sum, s) => sum + s.bookings, 0);
    const totalPayments = locStats.reduce((sum, s) => sum + s.payments, 0);
    const totalRevenue = locStats.reduce((sum, s) => sum + s.revenue, 0);
    const totalOrders = locStats.reduce((sum, s) => sum + s.orders, 0);

    console.log(`${'Location'.padEnd(45)} ${'Bookings'.padEnd(12)} ${'Payments'.padEnd(12)} ${'Revenue'.padEnd(15)} ${'Orders'}`);
    console.log('-'.repeat(100));

    locStats.forEach(stat => {
      const pctBookings = ((stat.bookings/totalBookings)*100).toFixed(1);
      const pctPayments = ((stat.payments/totalPayments)*100).toFixed(1);
      const pctRevenue = ((stat.revenue/totalRevenue)*100).toFixed(1);
      const pctOrders = ((stat.orders/totalOrders)*100).toFixed(1);

      console.log(
        `${stat.name.padEnd(45)} ${stat.bookings.toString().padEnd(4)}(${pctBookings}%)${' '.padEnd(3)} ${stat.payments.toString().padEnd(4)}(${pctPayments}%)${' '.padEnd(3)} $${stat.revenue.toFixed(0).padEnd(10)}(${pctRevenue}%) ${stat.orders.toString().padEnd(5)}(${pctOrders}%)`
      );
    });

    console.log('-'.repeat(100));
    console.log(
      `${'TOTAL'.padEnd(45)} ${totalBookings.toString().padEnd(12)} ${totalPayments.toString().padEnd(12)} $${totalRevenue.toFixed(2).padEnd(15)} ${totalOrders}`
    );

    // Check for balance
    console.log('\n' + '═'.repeat(80));
    console.log('\n✅ BALANCE CHECK:\n');

    const ratio = locStats[0].bookings / locStats[1].bookings;
    console.log(`Booking ratio: ${(ratio > 1 ? locStats[0].name : locStats[1].name)} has ${Math.abs(ratio).toFixed(2)}x more bookings`);

    const paymentRatio = locStats[0].payments / locStats[1].payments;
    console.log(`Payment ratio: ${(paymentRatio > 1 ? locStats[0].name : locStats[1].name)} has ${Math.abs(paymentRatio).toFixed(2)}x more payments`);

    const revenueRatio = locStats[0].revenue / locStats[1].revenue;
    console.log(`Revenue ratio: ${(revenueRatio > 1 ? locStats[0].name : locStats[1].name)} has ${Math.abs(revenueRatio).toFixed(2)}x more revenue`);

    // Check balance
    if (ratio > 0.9 && ratio < 1.1 && paymentRatio > 0.9 && paymentRatio < 1.1) {
      console.log('\n✅ BALANCED: Both locations have similar activity');
    } else {
      console.log('\n⚠️  IMBALANCED: One location has significantly more activity');
    }

    if (locStats[0].payments/locStats[0].bookings === locStats[1].payments/locStats[1].bookings) {
      console.log('✅ Payment coverage is EQUAL between locations');
    } else {
      const cov1 = ((locStats[0].payments/locStats[0].bookings)*100).toFixed(1);
      const cov2 = ((locStats[1].payments/locStats[1].bookings)*100).toFixed(1);
      console.log(`⚠️  Payment coverage differs: ${locStats[0].name} (${cov1}%) vs ${locStats[1].name} (${cov2}%)`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkBothLocations();

