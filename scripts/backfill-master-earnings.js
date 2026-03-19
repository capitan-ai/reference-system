const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Speed up backfill: override via env (e.g. EARNINGS_BATCH_SIZE=2000 EARNINGS_CONCURRENCY=20)
process.env.EARNINGS_BATCH_SIZE = process.env.EARNINGS_BATCH_SIZE || '1500';
process.env.EARNINGS_CONCURRENCY = process.env.EARNINGS_CONCURRENCY || '15';
const { upsertBookingSnapshot } = require('../lib/workers/master-snapshot-service');
const { processMasterEarnings } = require('../lib/workers/master-earnings-worker');
const { processDiscountAdjustments } = require('../lib/workers/discount-engine-worker');
const { refreshMasterPerformance } = require('./refresh-master-performance');

async function backfill(organizationId, earningsOnly = false) {
  console.log(`🚀 Starting Backfill for Master Earnings (Org: ${organizationId})${earningsOnly ? ' [earnings-only]' : ''}...`);

  try {
    if (!earningsOnly) {
      // 1. Get all accepted bookings
      const bookings = await prisma.booking.findMany({
        where: {
          organization_id: organizationId,
          status: 'ACCEPTED'
        },
        select: { booking_id: true }
      });

      console.log(`Found ${bookings.length} accepted bookings. Creating snapshots...`);

      // 2. Create snapshots for all bookings
      for (let i = 0; i < bookings.length; i++) {
        if (i % 50 === 0) console.log(`Processed ${i}/${bookings.length} snapshots...`);
        await upsertBookingSnapshot(bookings[i].booking_id, organizationId);
      }
    }

    // 3. Run earnings worker (multiple passes to process all)
    const BATCH_SIZE = parseInt(process.env.EARNINGS_BATCH_SIZE || '1500', 10)
    const CONCURRENCY = parseInt(process.env.EARNINGS_CONCURRENCY || '15', 10)
    console.log(`Processing earnings into ledger (batch=${BATCH_SIZE}, concurrency=${CONCURRENCY})...`);
    let processedCount = 0;
    while (true) {
      const pendingBefore = await prisma.bookingSnapshot.count({
        where: { organization_id: organizationId, status: 'ACCEPTED', base_processed: false }
      });
      
      if (pendingBefore === 0) break;
      
      await processMasterEarnings(organizationId, BATCH_SIZE);
      
      const pendingAfter = await prisma.bookingSnapshot.count({
        where: { organization_id: organizationId, status: 'ACCEPTED', base_processed: false }
      });
      
      if (pendingAfter === pendingBefore) {
        console.log('⚠️ Some snapshots could not be processed (missing orders/payments). Stopping loop.');
        break;
      }
      
      processedCount += (pendingBefore - pendingAfter);
      console.log(`Processed ${processedCount} earnings entries...`);
    }

    // 4. Process discount adjustments (historical snapshots)
    console.log('Processing discount adjustments...');
    while (true) {
      const pendingBefore = await prisma.bookingSnapshot.count({
        where: {
          organization_id: organizationId,
          base_processed: true,
          discount_processed: false
        }
      });
      if (pendingBefore === 0) break;
      await processDiscountAdjustments(organizationId);
    }

    // 5. Refresh performance table
    console.log('Refreshing daily performance table...');
    await refreshMasterPerformance(organizationId);

    console.log('✅ Backfill completed successfully!');

  } catch (error) {
    console.error('❌ Backfill failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

const earningsOnly = process.argv.includes('--earnings-only');
const orgId = process.argv.filter((a) => !a.startsWith('--'))[2] || 'd0e24178-2f94-4033-bc91-41f22df58278';
backfill(orgId, earningsOnly);


