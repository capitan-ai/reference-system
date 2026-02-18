require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

async function backfillAndUpdateData() {
  console.log('🔄 BACKFILL & UPDATE SCRIPT - February 2026\n');
  console.log('═'.repeat(80));

  try {
    let ordersUpdated = 0;
    let paymentsAdded = 0;
    let paymentsLinked = 0;

    // STEP 1: Update Draft Orders from Square
    console.log('\n📋 STEP 1: Checking & Updating Draft Orders\n');

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
        state: true,
        location_id: true
      }
    });

    console.log(`Found ${draftOrders.length} draft orders to check\n`);

    for (let i = 0; i < draftOrders.length; i++) {
      const order = draftOrders[i];

      try {
        // Get order from Square
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

          if (squareState !== 'DRAFT') {
            // Update the order
            await prisma.order.update({
              where: { id: order.id },
              data: {
                state: squareState,
                updated_at: new Date(),
                raw_json: data.order
              }
            });

            ordersUpdated++;
            if (ordersUpdated % 10 === 0 || ordersUpdated === 1) {
              console.log(`✓ Updated ${ordersUpdated} orders...`);
            }
          }
        }
      } catch (err) {
        // Silent fail for API errors
      }

      // Rate limiting
      if ((i + 1) % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`\n✅ Updated ${ordersUpdated} orders from DRAFT status\n`);

    // STEP 2: Backfill Missing Payments from Square
    console.log('═'.repeat(80));
    console.log('\n💵 STEP 2: Backfilling Missing Payments from Square\n');

    // Get payments from Square
    let allSquarePayments = [];
    let cursor = null;

    while (true) {
      let url = 'https://connect.squareup.com/v2/payments?begin_time=2026-02-01T00:00:00Z&end_time=2026-03-01T00:00:00Z&limit=100';
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Square-Version': '2026-01-22',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.payments) {
          allSquarePayments = allSquarePayments.concat(data.payments);
        }
        if (data.cursor) {
          cursor = data.cursor;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    console.log(`Found ${allSquarePayments.length} payments in Square\n`);

    // Get existing payment IDs in DB
    const existingPaymentIds = await prisma.payment.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      },
      select: { payment_id: true }
    });

    const existingIds = new Set(existingPaymentIds.map(p => p.payment_id));

    // Find missing payments
    const missingPayments = allSquarePayments.filter(p => !existingIds.has(p.id));
    console.log(`Found ${missingPayments.length} missing payments to backfill\n`);

    // Add missing payments
    for (const payment of missingPayments) {
      try {
        // Find location
        let locationId = null;
        if (payment.location_id) {
          const location = await prisma.location.findFirst({
            where: {
              organization_id: ORG_ID,
              square_location_id: payment.location_id
            },
            select: { id: true }
          });
          locationId = location?.id || null;
        }

        // Create payment record
        await prisma.payment.create({
          data: {
            id: require('crypto').randomUUID(),
            organization_id: ORG_ID,
            payment_id: payment.id,
            square_event_id: payment.id, // Use payment ID as event ID for backfilled
            event_type: 'payment.created',
            status: payment.status,
            amount_money_amount: payment.amount_money?.amount || 0,
            amount_money_currency: payment.amount_money?.currency || 'USD',
            customer_id: payment.customer_id || null,
            location_id: locationId,
            order_id: payment.order_id || null,
            booking_id: null, // Will be linked in next step
            total_money_amount: payment.total_money?.amount || payment.amount_money?.amount || 0,
            total_money_currency: payment.total_money?.currency || payment.amount_money?.currency || 'USD',
            created_at: new Date(payment.created_at),
            updated_at: new Date(payment.updated_at || payment.created_at),
            square_created_at: new Date(payment.created_at),
            raw_json: payment
          }
        });

        paymentsAdded++;
        if (paymentsAdded % 10 === 0 || paymentsAdded === 1) {
          console.log(`✓ Added ${paymentsAdded} payments...`);
        }
      } catch (err) {
        // Silent fail - payment may already exist or have validation error
      }
    }

    console.log(`\n✅ Added ${paymentsAdded} missing payments\n`);

    // STEP 3: Link Payments to Bookings
    console.log('═'.repeat(80));
    console.log('\n🔗 STEP 3: Linking Payments to Bookings\n');

    const unlinkedPayments = await prisma.payment.findMany({
      where: {
        organization_id: ORG_ID,
        created_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        },
        booking_id: null
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

    console.log(`Found ${unlinkedPayments.length} unlinked payments\n`);

    for (const payment of unlinkedPayments) {
      try {
        // Strategy 1: Match by customer ID
        let booking = null;

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
            select: { id: true }
          });
        }

        // Strategy 2: Match by location + date proximity
        if (!booking && payment.location_id) {
          const paymentDate = new Date(payment.created_at);
          booking = await prisma.booking.findFirst({
            where: {
              organization_id: ORG_ID,
              location_id: payment.location_id,
              start_at: {
                gte: new Date(paymentDate.getTime() - 1 * 24 * 60 * 60 * 1000),
                lte: new Date(paymentDate.getTime() + 1 * 24 * 60 * 60 * 1000)
              },
              status: 'ACCEPTED',
              booking_id: { not: null }
            },
            select: { id: true }
          });
        }

        // Link if found
        if (booking) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { booking_id: booking.id }
          });
          paymentsLinked++;
        }
      } catch (err) {
        // Silent fail
      }
    }

    console.log(`✅ Linked ${paymentsLinked} payments to bookings\n`);

    // Summary
    console.log('═'.repeat(80));
    console.log('\n✅ BACKFILL & UPDATE COMPLETE\n');
    console.log('Summary:');
    console.log(`  1. Orders updated from DRAFT: ${ordersUpdated}`);
    console.log(`  2. Missing payments added: ${paymentsAdded}`);
    console.log(`  3. Payments linked to bookings: ${paymentsLinked}`);
    console.log();

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

backfillAndUpdateData();

