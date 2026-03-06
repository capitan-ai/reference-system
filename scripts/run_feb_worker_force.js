const prisma = require('../lib/prisma-client');

async function processSingleSnapshot(snapshot, force = false) {
  const { booking_id, booking } = snapshot;
  
  const order = booking.orders[0];
  const payments = order ? await prisma.payment.findMany({ 
    where: { order_id: order.id, status: 'COMPLETED' } 
  }) : [];

  // If no payment and not forcing, skip
  if (payments.length === 0 && !force) return false;

  console.log(`[EARNINGS-WORKER] Processing booking ${booking_id}${force ? ' (FORCE)' : ''}...`);

  try {
    await prisma.$transaction(async (tx) => {
      const ledgerEntries = [];
      
      const basePrice = snapshot.price_snapshot_amount;
      const commissionRate = snapshot.commission_rate_snapshot / 100;
      const commissionAmount = Math.round(basePrice * commissionRate);

      if (commissionAmount > 0) {
        ledgerEntries.push({
          organization_id: snapshot.organization_id,
          team_member_id: snapshot.technician_id,
          booking_id: snapshot.booking_id,
          entry_type: 'SERVICE_COMMISSION',
          amount_amount: commissionAmount,
          source_engine: 'MASTER_ENGINE',
          meta_json: { 
            calculation_base: 'SNAPSHOT_PRICE',
            price_used: basePrice, 
            rate: snapshot.commission_rate_snapshot,
            is_fix: snapshot.is_fix,
            forced: force
          }
        });
      }

      const totalTips = payments.reduce((sum, p) => sum + (p.tip_money_amount || 0), 0);
      if (totalTips > 0) {
        ledgerEntries.push({
          organization_id: snapshot.organization_id,
          team_member_id: snapshot.technician_id,
          booking_id: snapshot.booking_id,
          entry_type: 'TIP',
          amount_amount: totalTips,
          source_engine: 'MASTER_ENGINE',
          meta_json: { 
            order_id: order?.order_id,
            payment_ids: payments.map(p => p.payment_id)
          }
        });
      }

      if (ledgerEntries.length > 0) {
        await tx.masterEarningsLedger.createMany({
          data: ledgerEntries
        });
      }

      await tx.bookingSnapshot.update({
        where: { booking_id: snapshot.booking_id },
        data: { base_processed: true }
      });
    });

    return true;
  } catch (error) {
    console.error(`[EARNINGS-WORKER] ❌ Error processing booking ${booking_id}:`, error.message);
    return false;
  }
}

async function runFebruaryWorker() {
  console.log('🚀 Running Master Earnings Worker for February 2026 (Force Mode)...');
  const orgId = 'd0e24178-2f94-4033-bc91-41f22df58278';
  const start = new Date('2026-02-01T00:00:00Z');
  const end = new Date('2026-03-01T00:00:00Z');

  try {
    console.log('🧹 Clearing existing ledger entries for February...');
    await prisma.masterEarningsLedger.deleteMany({
      where: {
        organization_id: orgId,
        snapshot: {
          booking: {
            start_at: { gte: start, lt: end }
          }
        }
      }
    });

    console.log('🔄 Resetting base_processed flag for February snapshots...');
    await prisma.bookingSnapshot.updateMany({
      where: {
        organization_id: orgId,
        booking: {
          start_at: { gte: start, lt: end }
        }
      },
      data: { base_processed: false }
    });

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
            orders: {
              where: { state: 'COMPLETED' }
            }
          }
        }
      }
    });

    console.log(`Found ${snapshots.length} snapshots to process.`);

    let processed = 0;
    for (const snapshot of snapshots) {
      // Force process if no completed payment found
      const hasPayment = snapshot.booking.orders.length > 0;
      const ok = await processSingleSnapshot(snapshot, true); // Force all accepted bookings
      if (ok) processed++;
    }

    console.log(`\n✅ Finished! Processed ${processed} bookings into the ledger.`);

    console.log('\n📊 GENERATING FINAL REPORT FROM LEDGER (Masters Only)...');
    
    const masters = await prisma.teamMember.findMany({
      where: { 
        organization_id: orgId,
        master_settings: {
          category: { in: ['TOP_MASTER', 'MASTER', 'JUNIOR'] }
        }
      },
      include: { master_settings: true }
    });

    const report = [];
    for (const master of masters) {
      const ledger = await prisma.masterEarningsLedger.findMany({
        where: {
          team_member_id: master.id,
          snapshot: {
            booking: {
              start_at: { gte: start, lt: end }
            }
          }
        }
      });

      if (ledger.length === 0) continue;

      const commission = ledger
        .filter(e => e.entry_type === 'SERVICE_COMMISSION')
        .reduce((sum, e) => sum + e.amount_amount, 0) / 100;
      
      const tips = ledger
        .filter(e => e.entry_type === 'TIP')
        .reduce((sum, e) => sum + e.amount_amount, 0) / 100;

      const visits = new Set(ledger.map(e => e.booking_id)).size;

      report.push({
        Master: `${master.given_name} ${master.family_name}`,
        Visits: visits,
        Commission: `$${commission.toFixed(2)}`,
        Tips: `$${tips.toFixed(2)}`,
        'Total Payout': commission + tips
      });
    }

    report.sort((a, b) => b['Total Payout'] - a['Total Payout']);
    console.table(report.map(r => ({...r, 'Total Payout': `$${r['Total Payout'].toFixed(2)}`})));

    const total = report.reduce((sum, r) => sum + r['Total Payout'], 0);
    console.log('\n--- TOTAL SYSTEM PAYOUT: $' + total.toLocaleString() + ' ---');
    console.log('User Target: $93,438.00');
    console.log('Difference: $' + (total - 93438).toFixed(2));

  } catch (error) {
    console.error('❌ Worker failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runFebruaryWorker();

