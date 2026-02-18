require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

async function verifyOrdersWithSquare() {
  console.log('🔍 Verifying Draft Orders Against Square (Batch API)\n');
  console.log('═'.repeat(80));

  try {
    // Get draft orders from DB
    const draftOrdersDb = await prisma.order.findMany({
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

    console.log(`\n📊 Database shows ${draftOrdersDb.length} DRAFT orders\n`);

    // Get locations for batch requests
    const locations = await prisma.location.findMany({
      where: { organization_id: ORG_ID },
      select: { id: true, square_location_id: true }
    });

    const locationMap = {};
    locations.forEach(loc => {
      locationMap[loc.id] = loc.square_location_id;
    });

    // Group orders by location
    const ordersByLocation = {};
    draftOrdersDb.forEach(order => {
      const locId = order.location_id;
      if (!ordersByLocation[locId]) {
        ordersByLocation[locId] = [];
      }
      ordersByLocation[locId].push(order);
    });

    console.log('Verifying with Square API (batch retrieve)...\n');

    let stateChanged = 0;
    let stillDraft = 0;
    let notFound = 0;
    let errors = 0;

    const stateChangeDetails = [];

    // Process each location
    for (const [locId, orders] of Object.entries(ordersByLocation)) {
      const squareLocId = locationMap[locId];

      // Process in batches of 100 (API limit)
      for (let i = 0; i < orders.length; i += 100) {
        const batch = orders.slice(i, i + 100);
        const orderIds = batch.map(o => o.order_id);

        try {
          const response = await fetch(
            'https://connect.squareup.com/v2/orders/batch-retrieve',
            {
              method: 'POST',
              headers: {
                'Square-Version': '2026-01-22',
                'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                location_id: squareLocId,
                order_ids: orderIds
              })
            }
          );

          if (response.ok) {
            const data = await response.json();

            if (data.orders) {
              data.orders.forEach(squareOrder => {
                const dbOrder = batch.find(o => o.order_id === squareOrder.id);

                if (squareOrder.state !== 'DRAFT') {
                  stateChanged++;
                  stateChangeDetails.push({
                    order_id: squareOrder.id,
                    dbState: dbOrder.state,
                    squareState: squareOrder.state
                  });
                } else {
                  stillDraft++;
                }
              });
            }

            // Count not found
            if (data.orders && data.orders.length < batch.length) {
              notFound += batch.length - data.orders.length;
            }
          } else {
            errors += batch.length;
          }
        } catch (err) {
          errors += batch.length;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log('✅ Verification Complete\n');
    console.log('═'.repeat(80));
    console.log('\n📈 SQUARE VERIFICATION RESULTS:\n');
    console.log(`Orders checked: ${draftOrdersDb.length}`);
    console.log(`  ✅ Still DRAFT in Square: ${stillDraft}`);
    console.log(`  ⚠️  State changed in Square: ${stateChanged}`);
    console.log(`  ❌ Not found in Square: ${notFound}`);
    console.log(`  ⚠️  Errors: ${errors}`);

    if (stateChanged > 0) {
      console.log('\n' + '─'.repeat(80));
      console.log(`\n❌ ${stateChanged} ORDERS HAVE CHANGED STATE IN SQUARE:\n`);

      // Group by state
      const byState = {};
      stateChangeDetails.forEach(detail => {
        if (!byState[detail.squareState]) {
          byState[detail.squareState] = [];
        }
        byState[detail.squareState].push(detail);
      });

      Object.entries(byState).forEach(([state, items]) => {
        console.log(`\n${state}: ${items.length} orders`);
        items.slice(0, 5).forEach((item, idx) => {
          console.log(`  ${idx + 1}. ${item.order_id.substring(0, 20)}... (DB: ${item.dbState} → Square: ${state})`);
        });
        if (items.length > 5) {
          console.log(`  ... and ${items.length - 5} more`);
        }
      });

      console.log('\n' + '═'.repeat(80));
      console.log(`\n🔄 ACTION REQUIRED: Update ${stateChanged} orders in database\n`);
    } else {
      console.log('\n✅ All draft orders match Square status - no updates needed');
    }

    console.log('\n' + '═'.repeat(80));
    console.log('\n✅ FINAL STATUS:\n');

    if (stateChanged === 0 && notFound === 0 && errors === 0) {
      console.log('✓ All ${draftOrdersDb.length} draft orders verified with Square');
      console.log('✓ No state changes detected');
      console.log('✓ Database is in sync with Square');
    } else {
      console.log(`⚠️  ${stateChanged + notFound + errors} orders need attention`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyOrdersWithSquare();

