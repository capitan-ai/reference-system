require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

async function improvedBackfillAndUpdate() {
  console.log('🔄 IMPROVED BACKFILL & UPDATE - February 2026\n');
  console.log('═'.repeat(80));

  try {
    let ordersUpdated = 0;
    let paymentsAdded = 0;
    let paymentsLinked = 0;

    // STEP 1: Update Draft Orders from Square
    console.log('\n📋 STEP 1: Updating Draft Orders from Square\n');

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
        id: true,
        order_id: true,
        state: true
      },
      take: 100 // Check first 100 to be safe
    });

    console.log(`Checking ${draftOrders.length} draft orders...\n`);

    for (let i = 0; i < draftOrders.length; i++) {
      const order = draftOrders[i];

      try {
        const response = await fetch(
          `https://connect.squareup.com/v2/orders/${order.order_id}`,
          {
            method: 'GET',
            headers: {
              'Square-Version': '2026-01-22',
              'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        if (response.ok) {
          const data = await response.json();
          const squareState = data.order.state;

          if (squareState !== 'DRAFT' && squareState !== order.state) {
            await prisma.order.update({
              where: { id: order.id },
              data: {
                state: squareState,
                updated_at: new Date(),
                raw_json: data.order
              }
            });
            ordersUpdated++;
            console.log(`✓ Updated order to ${squareState}`);
          }
        }
      } catch (err) {
        // Continue
      }

      if ((i + 1) % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`\n✅ Updated ${ordersUpdated} orders\n`);

    // STEP 2: Link Unlinked Payments to Bookings
    console.log('═'.repeat(80));
    console.log('\n🔗 STEP 2: Linking Unlinked Payments to Bookings\n');

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

    console.log(`Found ${unlinkedPayments.length} unlinked COMPLETED payments\n`);

    let linkedByCustomer = 0;
    let linkedByProximity = 0;

    for (const payment of unlinkedPayments) {
      try {
        let booking = null;

        // Strategy 1: Match by customer ID (exact match)
        if (payment.customer_id) {
          booking = await prisma.booking.findFirst({
            where: {
              organization_id: ORG_ID,
              customer_id: payment.customer_id,
              start_at: {
                gte: new Date('2026-02-01T00:00:00Z'),
                lt: new Date('2026-03-01T00:00:00Z')
              },
              status: 'ACCEPTED',
              booking_id: { not: null }
            },
            select: { id: true },
            orderBy: { start_at: 'asc' }
          });

          if (booking) {
            linkedByCustomer++;
          }
        }

        // Strategy 2: Match by location + date proximity (within 2 days)
        if (!booking && payment.location_id) {
          const paymentDate = new Date(payment.created_at);
          booking = await prisma.booking.findFirst({
            where: {
              organization_id: ORG_ID,
              location_id: payment.location_id,
              start_at: {
                gte: new Date(paymentDate.getTime() - 2 * 24 * 60 * 60 * 1000),
                lte: new Date(paymentDate.getTime() + 2 * 24 * 60 * 60 * 1000)
              },
              status: 'ACCEPTED',
              booking_id: { not: null }
            },
            select: { id: true },
            orderBy: { start_at: 'asc' }
          });

          if (booking) {
            linkedByProximity++;
          }
        }

        // Link if found
        if (booking) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { booking_id: booking.id },
            select: { id: true }
          });
          paymentsLinked++;

          if (paymentsLinked % 20 === 0) {
            console.log(`✓ Linked ${paymentsLinked} payments...`);
          }
        }
      } catch (err) {
        // Continue
      }
    }

    console.log(`\n✅ Linked ${paymentsLinked} payments to bookings`);
    console.log(`  ├─ By Customer ID: ${linkedByCustomer}`);
    console.log(`  └─ By Proximity: ${linkedByProximity}\n`);

    // SUMMARY
    console.log('═'.repeat(80));
    console.log('\n📊 BACKFILL & UPDATE COMPLETE\n');
    console.log('Results:');
    console.log(`  1. Draft orders updated to new state: ${ordersUpdated}`);
    console.log(`  2. Payments linked to bookings: ${paymentsLinked}`);
    console.log();

    // New counts
    const finalUnlinked = await prisma.payment.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: null
      }
    });

    const finalDraft = await prisma.order.count({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        state: 'DRAFT'
      }
    });

    console.log('Updated Counts:');
    console.log(`  Unlinked payments remaining: ${finalUnlinked}`);
    console.log(`  Draft orders remaining: ${finalDraft}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

improvedBackfillAndUpdate();

