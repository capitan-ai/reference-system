require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function verifyFebruaryMarchCounts() {
  console.log('🔍 Verifying February & March 2026 Booking Counts\n');

  try {
    // Get ALL bookings in Feb (regardless of status)
    console.log('📚 Fetching February 2026 bookings (ALL statuses)...');
    const febAllBookings = await prisma.booking.findMany({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      }
    });

    console.log(`✅ Total Feb 2026 bookings (all statuses): ${febAllBookings.length}\n`);

    // Breakdown by status
    const febByStatus = {};
    febAllBookings.forEach(b => {
      febByStatus[b.status] = (febByStatus[b.status] || 0) + 1;
    });

    console.log('February 2026 - Breakdown by Status:');
    console.log('━'.repeat(50));
    Object.entries(febByStatus)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`  ${status.padEnd(30)} ${count}`);
      });

    const febAccepted = febByStatus['ACCEPTED'] || 0;
    const febCancelled = (febByStatus['CANCELLED_BY_SELLER'] || 0) + (febByStatus['CANCELLED_BY_CUSTOMER'] || 0);
    console.log('━'.repeat(50));
    console.log(`  Accepted: ${febAccepted}`);
    console.log(`  Cancelled: ${febCancelled}`);
    console.log(`  TOTAL: ${febAllBookings.length}`);
    console.log(`  Expected (from report): 1,296 (1,020 accepted + 276 cancelled)\n`);

    // Get ALL bookings in March (regardless of status)
    console.log('\n📚 Fetching March 2026 bookings (ALL statuses)...');
    const marAllBookings = await prisma.booking.findMany({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-03-01T00:00:00Z'),
          lt: new Date('2026-04-01T00:00:00Z')
        }
      }
    });

    console.log(`✅ Total March 2026 bookings (all statuses): ${marAllBookings.length}\n`);

    // Breakdown by status
    const marByStatus = {};
    marAllBookings.forEach(b => {
      marByStatus[b.status] = (marByStatus[b.status] || 0) + 1;
    });

    console.log('March 2026 - Breakdown by Status:');
    console.log('━'.repeat(50));
    Object.entries(marByStatus)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`  ${status.padEnd(30)} ${count}`);
      });

    const marAccepted = marByStatus['ACCEPTED'] || 0;
    const marCancelled = (marByStatus['CANCELLED_BY_SELLER'] || 0) + (marByStatus['CANCELLED_BY_CUSTOMER'] || 0);
    console.log('━'.repeat(50));
    console.log(`  Accepted: ${marAccepted}`);
    console.log(`  Cancelled: ${marCancelled}`);
    console.log(`  TOTAL: ${marAllBookings.length}`);
    console.log(`  Expected (from report): 246 (238 accepted + 8 cancelled)\n`);

    // Check for Square API status filters
    console.log('\n' + '='.repeat(70));
    console.log('⚠️  FILTERING ANALYSIS:\n');
    console.log('The monthly report filters by status:');
    console.log('  { in: ["ACCEPTED", "CANCELLED_BY_SELLER", "CANCELLED_BY_CUSTOMER"] }\n');

    const febFiltered = febAllBookings.filter(b => 
      ['ACCEPTED', 'CANCELLED_BY_SELLER', 'CANCELLED_BY_CUSTOMER'].includes(b.status)
    ).length;

    const marFiltered = marAllBookings.filter(b => 
      ['ACCEPTED', 'CANCELLED_BY_SELLER', 'CANCELLED_BY_CUSTOMER'].includes(b.status)
    ).length;

    console.log(`February 2026 - Filtered count: ${febFiltered}`);
    console.log(`February 2026 - Total count: ${febAllBookings.length}`);
    console.log(`February 2026 - Excluded: ${febAllBookings.length - febFiltered}\n`);

    console.log(`March 2026 - Filtered count: ${marFiltered}`);
    console.log(`March 2026 - Total count: ${marAllBookings.length}`);
    console.log(`March 2026 - Excluded: ${marAllBookings.length - marFiltered}\n`);

    // Identify excluded statuses
    const febOtherStatuses = {};
    febAllBookings.forEach(b => {
      if (!['ACCEPTED', 'CANCELLED_BY_SELLER', 'CANCELLED_BY_CUSTOMER'].includes(b.status)) {
        febOtherStatuses[b.status] = (febOtherStatuses[b.status] || 0) + 1;
      }
    });

    const marOtherStatuses = {};
    marAllBookings.forEach(b => {
      if (!['ACCEPTED', 'CANCELLED_BY_SELLER', 'CANCELLED_BY_CUSTOMER'].includes(b.status)) {
        marOtherStatuses[b.status] = (marOtherStatuses[b.status] || 0) + 1;
      }
    });

    if (Object.keys(febOtherStatuses).length > 0) {
      console.log('📋 February 2026 - Excluded Statuses:');
      Object.entries(febOtherStatuses).forEach(([status, count]) => {
        console.log(`   ${status}: ${count}`);
      });
    }

    if (Object.keys(marOtherStatuses).length > 0) {
      console.log('\n📋 March 2026 - Excluded Statuses:');
      Object.entries(marOtherStatuses).forEach(([status, count]) => {
        console.log(`   ${status}: ${count}`);
      });
    }

    // Verify dates
    console.log('\n' + '='.repeat(70));
    console.log('✅ VERIFICATION RESULT:\n');

    if (febFiltered === 1296) {
      console.log('✅ February 2026 count is CORRECT: 1,296 bookings');
    } else {
      console.log(`⚠️  February 2026 count MISMATCH:`);
      console.log(`   Expected: 1,296`);
      console.log(`   Found: ${febFiltered}`);
      console.log(`   Difference: ${febFiltered - 1296}`);
    }

    console.log();

    if (marFiltered === 246) {
      console.log('✅ March 2026 count is CORRECT: 246 bookings');
      console.log('⚠️  However, this is incomplete data (today is Feb 18, 2026)');
    } else {
      console.log(`⚠️  March 2026 count MISMATCH:`);
      console.log(`   Expected: 246`);
      console.log(`   Found: ${marFiltered}`);
      console.log(`   Difference: ${marFiltered - 246}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyFebruaryMarchCounts();

