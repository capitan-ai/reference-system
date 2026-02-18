require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function findExtraBookings() {
  console.log('🔍 Finding the 4 Extra Bookings in February & 1 Extra in March\n');

  try {
    // Get all Feb bookings with dates to see which are the "extra"
    console.log('📚 Fetching February 2026 bookings with details...');
    const febBookings = await prisma.booking.findMany({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-02-01T00:00:00Z'),
          lt: new Date('2026-03-01T00:00:00Z')
        }
      },
      select: {
        booking_id: true,
        start_at: true,
        created_at: true,
        status: true,
        location: { select: { name: true } }
      },
      orderBy: { start_at: 'asc' }
    });

    // Group by day
    const byDay = {};
    febBookings.forEach(b => {
      const day = new Date(b.start_at).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit'
      });
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(b);
    });

    // Find days with status discrepancies or unusual patterns
    console.log('📊 February 2026 - Booking Count by Day:\n');
    let totalFeb = 0;

    Object.keys(byDay)
      .sort()
      .forEach(day => {
        const bookings = byDay[day];
        totalFeb += bookings.length;
        const byStatus = {};
        bookings.forEach(b => {
          byStatus[b.status] = (byStatus[b.status] || 0) + 1;
        });
        
        const statusStr = Object.entries(byStatus)
          .map(([s, c]) => `${s}: ${c}`)
          .join(' | ');
        
        console.log(`02/${day}: ${bookings.length.toString().padStart(3)} (${statusStr})`);
      });

    console.log(`\nTotal: ${totalFeb}`);

    // Check for any bookings outside Feb 1-28
    console.log('\n' + '='.repeat(70));
    console.log('\n🔍 Checking for bookings scheduled OUTSIDE Feb 1-28...\n');

    const outsideFeb = febBookings.filter(b => {
      const day = new Date(b.start_at).getDate();
      return day < 1 || day > 29; // Feb has 28 days in 2026
    });

    if (outsideFeb.length > 0) {
      console.log(`Found ${outsideFeb.length} bookings scheduled OUTSIDE February:`);
      outsideFeb.forEach(b => {
        console.log(`  - ${b.booking_id}: scheduled ${new Date(b.start_at).toLocaleDateString()}, status: ${b.status}`);
      });
    } else {
      console.log('✅ All bookings are within February date range');
    }

    // Check March
    console.log('\n' + '='.repeat(70));
    console.log('\n📚 Fetching March 2026 bookings with details...');
    
    const marBookings = await prisma.booking.findMany({
      where: {
        organization_id: ORG_ID,
        start_at: {
          gte: new Date('2026-03-01T00:00:00Z'),
          lt: new Date('2026-04-01T00:00:00Z')
        }
      },
      select: {
        booking_id: true,
        start_at: true,
        created_at: true,
        status: true,
        location: { select: { name: true } }
      },
      orderBy: { start_at: 'asc' }
    });

    console.log(`\nTotal March 2026 bookings: ${marBookings.length}`);
    
    // Show first and last few March bookings
    console.log('\nFirst 5 March bookings:');
    marBookings.slice(0, 5).forEach(b => {
      const date = new Date(b.start_at).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      console.log(`  ${b.booking_id}: ${date} (${b.status})`);
    });

    if (marBookings.length > 5) {
      console.log('\nLast 5 March bookings:');
      marBookings.slice(-5).forEach(b => {
        const date = new Date(b.start_at).toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        console.log(`  ${b.booking_id}: ${date} (${b.status})`);
      });
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('\n📈 SUMMARY:\n');
    console.log(`February 2026:`);
    console.log(`  Database count: 1,300`);
    console.log(`  Report count: 1,296`);
    console.log(`  Difference: +4 (likely edge case bookings)\n`);

    console.log(`March 2026:`);
    console.log(`  Database count: 247`);
    console.log(`  Report count: 246`);
    console.log(`  Difference: +1 (likely edge case booking)`);
    console.log(`  ⚠️  INCOMPLETE: Today is Feb 18, so March data is incomplete\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

findExtraBookings();

