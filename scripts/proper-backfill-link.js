require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function properBackfill() {
  console.log('🔄 PROPER BACKFILL - Linking Payments to Bookings\n');
  console.log('═'.repeat(80));

  try {
    let paymentsLinked = 0;
    let linkedByCustomer = 0;
    let linkedByProximity = 0;

    // Get all unlinked COMPLETED payments
    const unlinkedPayments = await prisma.payment.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: null,
        status: 'COMPLETED'
      },
      select: {
        id: true,
        payment_id: true,
        customer_id: true,
        amount_money_amount: true,
        created_at: true,
        location_id: true
      }
    });

    console.log(`\nProcessing ${unlinkedPayments.length} unlinked COMPLETED payments...\n`);

    for (let idx = 0; idx < unlinkedPayments.length; idx++) {
      const payment = unlinkedPayments[idx];
      let linkedBookingId = null;

      // STRATEGY 1: Exact customer match - link first ACCEPTED booking
      if (payment.customer_id) {
        const booking = await prisma.booking.findFirst({
          where: {
            organization_id: ORG_ID,
            customer_id: payment.customer_id,
            status: 'ACCEPTED'
          },
          select: { id: true },
          orderBy: { start_at: 'desc' }
        });

        if (booking) {
          linkedBookingId = booking.id;
          linkedByCustomer++;
        }
      }

      // STRATEGY 2: If no customer match, try location + date proximity
      if (!linkedBookingId && payment.location_id) {
        const paymentDate = new Date(payment.created_at);
        const dayStart = new Date(paymentDate.getFullYear(), paymentDate.getMonth(), paymentDate.getDate());
        const dayEnd = new Date(paymentDate.getFullYear(), paymentDate.getMonth(), paymentDate.getDate() + 1);

        const booking = await prisma.booking.findFirst({
          where: {
            organization_id: ORG_ID,
            location_id: payment.location_id,
            start_at: {
              gte: dayStart,
              lt: dayEnd
            },
            status: 'ACCEPTED'
          },
          select: { id: true },
          orderBy: { start_at: 'asc' }
        });

        if (booking) {
          linkedBookingId = booking.id;
          linkedByProximity++;
        }
      }

      // Link the payment if we found a booking
      if (linkedBookingId) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { booking_id: linkedBookingId }
        });
        paymentsLinked++;

        if (paymentsLinked % 25 === 0) {
          console.log(`✓ Linked ${paymentsLinked} payments (${linkedByCustomer} by customer, ${linkedByProximity} by proximity)`);
        }
      }
    }

    console.log(`\n✅ LINKING COMPLETE\n`);
    console.log(`Total payments linked: ${paymentsLinked}`);
    console.log(`  ├─ By customer match: ${linkedByCustomer}`);
    console.log(`  └─ By proximity match: ${linkedByProximity}`);

    // Check remaining unlinked
    const remainingUnlinked = await prisma.payment.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: null
      }
    });

    console.log(`\nRemaining unlinked payments: ${remainingUnlinked}`);

    if (remainingUnlinked > 0) {
      console.log('\n📋 These are likely:');
      console.log('  • Retail/product sales (not booking services)');
      console.log('  • Walk-in services without advance booking');
      console.log('  • Same-day cash transactions');
      console.log('  • Deposits or partial payments');
    }

    // Updated stats
    console.log('\n' + '═'.repeat(80));
    console.log('\n📊 UPDATED PAYMENT STATISTICS\n');

    const updatedPaymentStats = await prisma.payment.groupBy({
      by: ['status'],
      where: {
        organization_id: ORG_ID,
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

    const linkedPayments = await prisma.payment.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: { not: null }
      }
    });

    console.log(`Total payments: 773`);
    console.log(`Linked to bookings: ${linkedPayments}`);
    console.log(`Coverage: ${((linkedPayments/773)*100).toFixed(1)}%`);

    updatedPaymentStats.forEach(stat => {
      const amount = ((stat._sum.amount_money_amount || 0) / 100).toFixed(2);
      console.log(`\n${stat.status}: ${stat._count} payments ($${amount})`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

properBackfill();

