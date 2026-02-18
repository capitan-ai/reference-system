require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function investigateAllIssues() {
  console.log('🔍 COMPREHENSIVE DATA INVESTIGATION - February 2026\n');

  try {
    // ===== ISSUE 1: MISSING PAYMENTS =====
    console.log('═'.repeat(80));
    console.log('❌ ISSUE 1: 529 BOOKINGS WITHOUT PAYMENT RECORDS');
    console.log('═'.repeat(80));
    console.log();

    const bookingsWithoutPayments = await prisma.booking.findMany({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        NOT: {
          payments: {
            some: {}
          }
        }
      },
      select: {
        booking_id: true,
        start_at: true,
        status: true,
        location: { select: { name: true } }
      },
      orderBy: { start_at: 'asc' }
    });

    console.log(`Total bookings without payments: ${bookingsWithoutPayments.length}\n`);

    // Breakdown by status
    const byStatus = {};
    const byLocation = {};
    bookingsWithoutPayments.forEach(b => {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      byLocation[b.location.name] = (byLocation[b.location.name] || 0) + 1;
    });

    console.log('By Booking Status:');
    Object.entries(byStatus)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`  ${status.padEnd(30)} ${count}`);
      });

    console.log();
    console.log('By Location:');
    Object.entries(byLocation).forEach(([loc, count]) => {
      const pct = ((count / bookingsWithoutPayments.length) * 100).toFixed(1);
      console.log(`  ${loc.padEnd(45)} ${count.toString().padStart(4)} (${pct}%)`);
    });

    console.log();
    console.log('Sample bookings without payments (first 10):');
    bookingsWithoutPayments.slice(0, 10).forEach((b, idx) => {
      const date = new Date(b.start_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      console.log(`  ${idx + 1}. ${b.booking_id} - ${date} (${b.status})`);
    });

    // ===== ISSUE 2: ORPHANED PAYMENTS =====
    console.log();
    console.log('═'.repeat(80));
    console.log('⚠️  ISSUE 2: 170 PAYMENTS NOT LINKED TO BOOKINGS');
    console.log('═'.repeat(80));
    console.log();

    const orphanedPayments = await prisma.payment.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: null
      },
      select: {
        payment_id: true,
        amount_money_amount: true,
        status: true,
        created_at: true,
        customer_id: true,
        location: { select: { name: true } }
      }
    });

    console.log(`Total orphaned payments: ${orphanedPayments.length}\n`);

    // Breakdown by status
    const orphanByStatus = {};
    const orphanByLocation = {};
    let orphanTotalRevenue = 0;

    orphanedPayments.forEach(p => {
      orphanByStatus[p.status] = (orphanByStatus[p.status] || 0) + 1;
      orphanByLocation[p.location.name] = (orphanByLocation[p.location.name] || 0) + 1;
      orphanTotalRevenue += (p.amount_money_amount || 0) / 100;
    });

    console.log('By Payment Status:');
    Object.entries(orphanByStatus)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`  ${status.padEnd(30)} ${count}`);
      });

    console.log();
    console.log('By Location:');
    Object.entries(orphanByLocation).forEach(([loc, count]) => {
      const pct = ((count / orphanedPayments.length) * 100).toFixed(1);
      console.log(`  ${loc.padEnd(45)} ${count.toString().padStart(4)} (${pct}%)`);
    });

    console.log();
    console.log(`Total Revenue from Orphaned Payments: $${orphanTotalRevenue.toFixed(2)}`);

    console.log();
    console.log('Sample orphaned payments (first 10):');
    orphanedPayments.slice(0, 10).forEach((p, idx) => {
      const amount = ((p.amount_money_amount || 0) / 100).toFixed(2);
      const date = new Date(p.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      console.log(`  ${idx + 1}. ${p.payment_id.substring(0, 20)}... - $${amount} (${p.status}) - ${date}`);
    });

    // ===== ISSUE 3: DRAFT ORDERS =====
    console.log();
    console.log('═'.repeat(80));
    console.log('⚠️  ISSUE 3: 815 DRAFT ORDERS');
    console.log('═'.repeat(80));
    console.log();

    const draftOrders = await prisma.order.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        state: 'DRAFT'
      },
      select: {
        order_id: true,
        state: true,
        created_at: true,
        booking_id: true,
        location: { select: { name: true } }
      }
    });

    console.log(`Total draft orders: ${draftOrders.length}\n`);

    const draftByLocation = {};
    const draftWithBooking = draftOrders.filter(o => o.booking_id).length;

    draftOrders.forEach(o => {
      draftByLocation[o.location.name] = (draftByLocation[o.location.name] || 0) + 1;
    });

    console.log('By Location:');
    Object.entries(draftByLocation).forEach(([loc, count]) => {
      const pct = ((count / draftOrders.length) * 100).toFixed(1);
      console.log(`  ${loc.padEnd(45)} ${count.toString().padStart(4)} (${pct}%)`);
    });

    console.log();
    console.log(`Linked to bookings: ${draftWithBooking} (${((draftWithBooking/draftOrders.length)*100).toFixed(1)}%)`);
    console.log(`Not linked: ${draftOrders.length - draftWithBooking}`);

    console.log();
    console.log('Sample draft orders (first 10):');
    draftOrders.slice(0, 10).forEach((o, idx) => {
      const date = new Date(o.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      const linked = o.booking_id ? '✓ Linked' : '✗ Not linked';
      console.log(`  ${idx + 1}. ${o.order_id.substring(0, 20)}... - ${date} (${linked})`);
    });

    // ===== SUMMARY =====
    console.log();
    console.log('═'.repeat(80));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(80));
    console.log();
    console.log(`Total data issues found:`);
    console.log(`  1. Bookings without payments: ${bookingsWithoutPayments.length}`);
    console.log(`  2. Orphaned payments: ${orphanedPayments.length} ($${orphanTotalRevenue.toFixed(2)})`);
    console.log(`  3. Draft orders: ${draftOrders.length}`);
    console.log();
    console.log(`Likely causes:`);
    console.log(`  • Cancelled bookings don't require payments`);
    console.log(`  • Some payments may be tied to other orders, not bookings`);
    console.log(`  • Draft orders are work-in-progress and may not need completion`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

investigateAllIssues();

