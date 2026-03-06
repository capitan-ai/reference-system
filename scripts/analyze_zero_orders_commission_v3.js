require('dotenv').config();
const prisma = require('../lib/prisma-client');

const PACKAGE_UNIT_PRICES = {
  'Package 5 TOP MASTER': 12600,
  'Package 5 MASTER': 10800,
  'Package 5 JUNIOR': 9000,
  'Package 3 TOP MASTER': 13066,
  'Package 3 MASTER': 11200,
  'Package 3 JUNIOR': 9333,
  'Packages 5 TOP MASTER': 12600, // Handle plural
  'Packages 5 MASTER': 10800,
  'Packages 5 JUNIOR': 9000
};

async function analyzeZeroDollarOrders() {
  console.log('📊 Analyzing $0 Orders for February 2026 (With Package Resolution)...');
  const orgId = 'd0e24178-2f94-4033-bc91-41f22df58278';
  const start = new Date('2026-02-01T00:00:00Z');
  const end = new Date('2026-03-01T00:00:00Z');

  try {
    const zeroOrders = await prisma.order.findMany({
      where: {
        organization_id: orgId,
        created_at: { gte: start, lt: end },
        state: 'COMPLETED',
        total_money_amount: 0
      }
    });

    console.log(`Found ${zeroOrders.length} orders with $0 total.`);

    const report = [];
    let totalCommissionCents = 0;

    for (const order of zeroOrders) {
      if (!order.booking_id) continue;

      const snapshot = await prisma.bookingSnapshot.findUnique({
        where: { booking_id: order.booking_id },
        include: {
          booking: {
            include: {
              technician: true,
              service_variation: true
            }
          }
        }
      });

      if (!snapshot) continue;

      const master = snapshot.booking.technician;
      const masterName = master ? `${master.given_name} ${master.family_name}` : 'Unknown';
      
      let price = snapshot.price_snapshot_amount;
      let usedPackageLogic = false;

      // Resolve package unit price if snapshot price is 0
      if (price === 0) {
        const serviceName = snapshot.booking.service_variation?.service_name || snapshot.booking.service_variation?.name;
        if (serviceName && PACKAGE_UNIT_PRICES[serviceName]) {
          price = PACKAGE_UNIT_PRICES[serviceName];
          usedPackageLogic = true;
        }
      }

      const rate = snapshot.commission_rate_snapshot;
      const commission = Math.round((price * rate) / 100);
      totalCommissionCents += commission;

      report.push({
        OrderID: order.order_id,
        Master: masterName,
        Service: snapshot.booking.service_variation?.service_name || 'Unknown',
        'Price Used': `$${(price / 100).toFixed(2)}${usedPackageLogic ? ' (Pkg)' : ''}`,
        'Rate': `${rate}%`,
        'Commission': `$${(commission / 100).toFixed(2)}`
      });
    }

    console.table(report);
    console.log(`\n💰 Total Commission for $0 Orders: $${(totalCommissionCents / 100).toFixed(2)}`);

  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeZeroDollarOrders();

