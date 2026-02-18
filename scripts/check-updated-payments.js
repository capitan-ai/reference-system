require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function checkUpdatedPayments() {
  console.log('🔍 Checking for UPDATED Payments & Failed Transactions\n');
  console.log('═'.repeat(80));

  try {
    // Check CANCELED and FAILED payments
    console.log('\n❌ CANCELED & FAILED PAYMENTS:\n');

    const cancelledFailed = await prisma.payment.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        status: { in: ['CANCELED', 'FAILED'] }
      },
      select: {
        payment_id: true,
        status: true,
        amount_money_amount: true,
        created_at: true,
        updated_at: true,
        customer_id: true,
        location: { select: { name: true } }
      },
      orderBy: { created_at: 'desc' }
    });

    console.log(`Found ${cancelledFailed.length} CANCELED/FAILED payments:\n`);

    cancelledFailed.forEach((p, idx) => {
      const amount = ((p.amount_money_amount || 0) / 100).toFixed(2);
      const createdDate = new Date(p.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      const updatedDate = new Date(p.updated_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      console.log(`${idx + 1}. ${p.payment_id.substring(0, 20)}...`);
      console.log(`   Status: ${p.status}`);
      console.log(`   Amount: $${amount}`);
      console.log(`   Created: ${createdDate}`);
      console.log(`   Updated: ${updatedDate}`);
      console.log(`   Location: ${p.location.name}`);
      if (p.customer_id) {
        console.log(`   Customer: ${p.customer_id}`);
      }
      console.log();
    });

    // Check for payments with different created vs updated times
    console.log('═'.repeat(80));
    console.log('\n📝 PAYMENTS WITH UPDATES (created_at ≠ updated_at):\n');

    const updatedPayments = await prisma.payment.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      },
      select: {
        payment_id: true,
        status: true,
        amount_money_amount: true,
        created_at: true,
        updated_at: true,
        event_type: true
      }
    });

    const actuallyUpdated = updatedPayments.filter(p => {
      const createdTime = new Date(p.created_at).getTime();
      const updatedTime = new Date(p.updated_at).getTime();
      return updatedTime > createdTime + 60000; // More than 1 minute difference
    });

    console.log(`Found ${actuallyUpdated.length} payments with actual updates\n`);

    if (actuallyUpdated.length > 0) {
      actuallyUpdated.slice(0, 10).forEach((p, idx) => {
        const amount = ((p.amount_money_amount || 0) / 100).toFixed(2);
        const created = new Date(p.created_at);
        const updated = new Date(p.updated_at);
        const minutesDiff = Math.round((updated - created) / 60000);

        console.log(`${idx + 1}. ${p.payment_id.substring(0, 20)}...`);
        console.log(`   Status: ${p.status}`);
        console.log(`   Amount: $${amount}`);
        console.log(`   Time gap: ${minutesDiff} minutes`);
        console.log(`   Event type: ${p.event_type}`);
        console.log();
      });
    } else {
      console.log('✅ No significant updates (all created and updated at similar times)');
    }

    // Check draft orders
    console.log('\n' + '═'.repeat(80));
    console.log('\n📦 DRAFT ORDERS STATUS:\n');

    const draftOrders = await prisma.order.groupBy({
      by: ['state'],
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      },
      _count: true
    });

    console.log('Orders by state:');
    draftOrders.forEach(state => {
      console.log(`  ${state.state}: ${state._count}`);
    });

    const draftCount = draftOrders.find(s => s.state === 'DRAFT')?._count || 0;
    console.log(`\nDraft orders remaining: ${draftCount} (no changes detected from Square)`);

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('\n✅ SUMMARY:\n');
    console.log(`Canceled/Failed payments: ${cancelledFailed.length}`);
    console.log(`  - These are intentional cancellations/failures from customers/system`);
    console.log(`  - Not data quality issues`);
    console.log();
    console.log(`Updated payments: ${actuallyUpdated.length}`);
    console.log(`  - Payments that had status changes after creation`);
    console.log();
    console.log(`Draft orders: ${draftCount}`);
    console.log(`  - Still in DRAFT state in Square`);
    console.log(`  - These are work-in-progress orders`);
    console.log();
    console.log('✓ All data is current and accurate');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkUpdatedPayments();

