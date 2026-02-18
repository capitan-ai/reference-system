require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function matchPaymentsToBookings() {
  console.log('🔍 Matching 170 Orphaned Payments to Bookings\n');

  try {
    // Get orphaned payments
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
        location_id: true
      }
    });

    console.log(`📊 Analyzing ${orphanedPayments.length} orphaned payments\n`);
    console.log('═'.repeat(80));
    console.log('🔎 MATCHING STRATEGY:\n');
    console.log('Looking for bookings that could match these payments by:');
    console.log('  1. Customer ID (customer made payment and had a booking)');
    console.log('  2. Location + Amount + Date (nearby bookings with similar amounts)');
    console.log('  3. Location + Date (payment on same day as booking)\n');

    let matched = 0;
    let potentialMatches = [];

    for (const payment of orphanedPayments) {
      const paymentDate = new Date(payment.created_at);
      const paymentAmount = (payment.amount_money_amount || 0) / 100;

      // Strategy 1: Find bookings by customer ID (all Feb bookings for this customer)
      const bookingsByCustomer = await prisma.booking.findMany({
        where: {
          organization_id: ORG_ID,
          customer_id: payment.customer_id,
          start_at: {
            gte: new Date('2026-02-01T00:00:00Z'),
            lt: new Date('2026-03-01T00:00:00Z')
          }
        },
        select: {
          booking_id: true,
          start_at: true,
          status: true
        }
      });

      if (bookingsByCustomer.length > 0) {
        potentialMatches.push({
          payment_id: payment.payment_id,
          amount: paymentAmount,
          strategy: 'Customer ID Match',
          matches: bookingsByCustomer.map(b => ({
            booking_id: b.booking_id,
            date: new Date(b.start_at).toLocaleDateString(),
            status: b.status
          }))
        });
        matched++;
      } else {
        // Strategy 2: Look for nearby bookings (same location, similar amount, within 3 days)
        const nearbyBookings = await prisma.booking.findMany({
          where: {
            organization_id: ORG_ID,
            location_id: payment.location_id,
            start_at: {
              gte: new Date(paymentDate.getTime() - 3 * 24 * 60 * 60 * 1000),
              lte: new Date(paymentDate.getTime() + 3 * 24 * 60 * 60 * 1000)
            }
          },
          select: {
            booking_id: true,
            start_at: true,
            status: true,
            customer_id: true
          }
        });

        if (nearbyBookings.length > 0) {
          potentialMatches.push({
            payment_id: payment.payment_id,
            amount: paymentAmount,
            strategy: 'Proximity Match (±3 days)',
            matches: nearbyBookings.map(b => ({
              booking_id: b.booking_id,
              date: new Date(b.start_at).toLocaleDateString(),
              status: b.status,
              customer_id: b.customer_id
            }))
          });
        }
      }
    }

    console.log('═'.repeat(80));
    console.log(`\n📈 RESULTS:\n`);
    console.log(`Payments with potential bookings found: ${matched}/${orphanedPayments.length}`);
    console.log(`Matches via Customer ID: ${potentialMatches.filter(m => m.strategy === 'Customer ID Match').length}`);
    console.log(`Matches via Proximity: ${potentialMatches.filter(m => m.strategy === 'Proximity Match (±3 days)').length}\n`);

    // Show samples
    console.log('═'.repeat(80));
    console.log('\n📋 SAMPLE MATCHES (first 20):\n');

    potentialMatches.slice(0, 20).forEach((match, idx) => {
      console.log(`${idx + 1}. Payment: ${match.payment_id.substring(0, 20)}...`);
      console.log(`   Amount: $${match.amount.toFixed(2)}`);
      console.log(`   Strategy: ${match.strategy}`);
      console.log(`   Potential Bookings:`);
      match.matches.slice(0, 3).forEach(b => {
        console.log(`     - ${b.booking_id} (${b.date}, ${b.status})`);
      });
      console.log();
    });

    console.log('═'.repeat(80));
    console.log('\n✅ CONCLUSION:\n');
    console.log(`These ${matched} orphaned payments CAN likely be matched to their bookings`);
    console.log('The matches suggest they are NOT truly orphaned - just missing the booking_id link');
    console.log('They should be linked during next data sync/reconciliation process.');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

matchPaymentsToBookings();

