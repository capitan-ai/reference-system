require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

async function checkOrdersWithSquare() {
  console.log('🔍 Verifying Draft Orders with Square API\n');

  try {
    // Get draft orders from DB
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
        location_id: true
      },
      take: 50 // Check first 50 to avoid timeout
    });

    console.log(`📊 Checking ${draftOrders.length} draft orders against Square\n`);
    console.log('═'.repeat(80));

    let stateChanged = 0;
    let stillDraft = 0;
    let notFound = 0;
    let errors = 0;

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

        if (response.status === 200) {
          const data = await response.json();
          const squareState = data.order.state;

          if (squareState !== 'DRAFT') {
            stateChanged++;
            console.log(`${i + 1}. ${order.order_id.substring(0, 20)}...`);
            console.log(`   DB State: DRAFT → Square State: ${squareState}`);
          } else {
            stillDraft++;
          }
        } else if (response.status === 404) {
          notFound++;
          console.log(`${i + 1}. ${order.order_id.substring(0, 20)}... - NOT FOUND in Square`);
        } else {
          errors++;
          console.log(`${i + 1}. ${order.order_id.substring(0, 20)}... - Error: ${response.status}`);
        }
      } catch (err) {
        errors++;
        if (i % 10 === 0) console.log(`Checking... (${i}/${draftOrders.length})`);
      }

      // Rate limiting - slight delay between requests
      if (i % 10 === 0 && i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log();
    console.log('═'.repeat(80));
    console.log('\n📈 SQUARE VERIFICATION RESULTS:\n');
    console.log(`Orders checked: ${draftOrders.length}`);
    console.log(`  ✅ Still DRAFT in Square: ${stillDraft}`);
    console.log(`  ⚠️  State changed in Square: ${stateChanged}`);
    console.log(`  ❌ Not found in Square: ${notFound}`);
    console.log(`  ⚠️  Errors/Timeouts: ${errors}`);

    console.log();
    console.log('═'.repeat(80));
    console.log('\n✅ CONCLUSION:\n');
    if (stateChanged > 0) {
      console.log(`⚠️  ${stateChanged} draft orders have been updated in Square`);
      console.log('   DB needs to be synced with latest Square data');
    }
    if (stillDraft === draftOrders.length - stateChanged - notFound - errors) {
      console.log(`✓ Most draft orders remain DRAFT in Square (working as expected)`);
    }
    if (notFound > 0) {
      console.log(`⚠️  ${notFound} orders not found in Square (possible deleted/invalid)`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkOrdersWithSquare();

