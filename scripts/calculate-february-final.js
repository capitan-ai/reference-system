const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function calculateFinal() {
  console.log('📊 FINAL CALCULATION: February 2026 (Master-First Logic)');
  const orgId = 'd0e24178-2f94-4033-bc91-41f22df58278';
  const start = new Date('2026-02-01T08:00:00Z'); 
  const end = new Date('2026-03-01T08:00:00Z');

  try {
    const snapshots = await prisma.bookingSnapshot.findMany({
      where: {
        organization_id: orgId,
        status: 'ACCEPTED',
        booking: {
          start_at: { gte: start, lt: end }
        }
      },
      include: {
        booking: {
          include: {
            orders: true,
            technician: true
          }
        }
      }
    });

    console.log(`Analyzing ${snapshots.length} bookings...`);

    const report = {};

    for (const s of snapshots) {
      const order = s.booking.orders[0];
      if (!order) continue;

      const payments = await prisma.payment.findMany({
        where: { order_id: order.id, status: 'COMPLETED' }
      });

      if (!payments.length) continue;

      const master = s.booking.technician;
      const masterName = master ? `${master.given_name} ${master.family_name}` : 'Unknown';
      
      const commission = (s.price_snapshot_amount * s.commission_rate_snapshot) / 10000;
      const tips = payments.reduce((sum, p) => sum + (p.tip_money_amount || 0), 0) / 100;

      if (!report[masterName]) report[masterName] = { visits: 0, commission: 0, tips: 0 };
      
      report[masterName].visits++;
      report[masterName].commission += commission;
      report[masterName].tips += tips;
    }

    const finalTable = Object.entries(report).map(([name, data]) => ({
      Master: name,
      Visits: data.visits,
      Commission: `$${data.commission.toFixed(2)}`,
      Tips: `$${data.tips.toFixed(2)}`,
      'Total Payout': data.commission + data.tips
    })).sort((a, b) => b['Total Payout'] - a['Total Payout']);

    console.table(finalTable.map(r => ({...r, 'Total Payout': `$${r['Total Payout'].toFixed(2)}`})));

    const total = finalTable.reduce((sum, r) => sum + r['Total Payout'], 0);
    console.log('\n--- TOTAL SYSTEM PAYOUT: $' + total.toLocaleString() + ' ---');
    console.log('User Target: $93,438.00');
    console.log('Difference: $' + (total - 93438).toFixed(2));

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
calculateFinal();
