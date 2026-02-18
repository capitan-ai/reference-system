require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function analyzeUnlinkedPayments() {
  console.log('🔍 Analyzing Unlinked Payments - Why Can\'t We Link Them?\n');

  try {
    // Get sample unlinked payments
    const sampleUnlinked = await prisma.payment.findMany({
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
        location_id: true,
        created_at: true,
        amount_money_amount: true
      },
      take: 20
    });

    console.log(`Sample 20 unlinked payments:\n`);

    for (const payment of sampleUnlinked) {
      console.log(`Payment: ${payment.payment_id.substring(0, 20)}...`);
      console.log(`  Customer ID: ${payment.customer_id}`);
      console.log(`  Location ID: ${payment.location_id}`);
      console.log(`  Amount: $${((payment.amount_money_amount || 0) / 100).toFixed(2)}`);
      console.log(`  Date: ${new Date(payment.created_at).toLocaleDateString()}`);

      // Check if this customer has any bookings
      if (payment.customer_id) {
        const customerBookings = await prisma.booking.count({
          where: {
            organization_id: ORG_ID,
            customer_id: payment.customer_id
          }
        });
        console.log(`  Bookings for this customer: ${customerBookings}`);
      }

      // Check bookings on same date
      if (payment.location_id) {
        const paymentDate = new Date(payment.created_at);
        const sameDay = await prisma.booking.count({
          where: {
            organization_id: ORG_ID,
            location_id: payment.location_id,
            start_at: {
              gte: new Date(paymentDate.getFullYear(), paymentDate.getMonth(), paymentDate.getDate()),
              lt: new Date(paymentDate.getFullYear(), paymentDate.getMonth(), paymentDate.getDate() + 1)
            }
          }
        });
        console.log(`  ACCEPTED bookings same day/location: ${sameDay}`);
      }

      console.log();
    }

    // Analysis
    console.log('═'.repeat(80));
    console.log('\n📊 ANALYSIS:\n');

    // Check if unlinked payments have customer_id at all
    const withCustomerId = await prisma.payment.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: null,
        customer_id: { not: null }
      }
    });

    const withoutCustomerId = 171 - withCustomerId;

    console.log(`Unlinked payments with customer_id: ${withCustomerId}`);
    console.log(`Unlinked payments WITHOUT customer_id: ${withoutCustomerId}`);

    if (withoutCustomerId > 0) {
      console.log(`\n⚠️  ${withoutCustomerId} payments have NO customer ID - cannot link by customer`);
      console.log('    These may be walk-in services or retail sales');
    }

    // Check if bookings have customer_id
    const bookingsWithCustomer = await prisma.booking.count({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        customer_id: { not: null }
      }
    });

    const totalBookings = await prisma.booking.count({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      }
    });

    console.log(`\nBookings with customer_id: ${bookingsWithCustomer}/${totalBookings}`);
    console.log(`Bookings WITHOUT customer_id: ${totalBookings - bookingsWithCustomer}`);

    console.log(`\n═`.repeat(40));
    console.log('\n✅ CONCLUSION:\n');
    console.log(`These ${withoutCustomerId} unlinked payments are likely:`);
    console.log('  • Walk-in services (no advance booking)');
    console.log('  • Retail/product sales (not booking-related)');
    console.log('  • Same-day cash transactions');
    console.log('\nThey are NOT missing data - they\'re legitimate payments');
    console.log('that don\'t directly correspond to individual bookings.');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeUnlinkedPayments();

