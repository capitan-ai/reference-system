require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function analyzeBookingsPerDay() {
  console.log('📊 Bookings Served Per Day - February 2026\n');

  try {
    // Get all February bookings
    console.log('📚 Fetching February bookings...');
    const februaryBookings = await prisma.booking.findMany({
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
        status: true,
        location: { select: { name: true } }
      }
    });

    console.log(`✅ Loaded ${februaryBookings.length} total bookings\n`);

    // Group by date
    const bookingsByDate = {};
    
    for (const booking of februaryBookings) {
      const date = new Date(booking.start_at);
      const dateStr = date.toLocaleDateString('en-US', { 
        month: '2-digit', 
        day: '2-digit',
        year: 'numeric'
      });
      
      if (!bookingsByDate[dateStr]) {
        bookingsByDate[dateStr] = {
          total: 0,
          byStatus: {},
          byLocation: {},
          bookings: []
        };
      }
      
      bookingsByDate[dateStr].total++;
      bookingsByDate[dateStr].byStatus[booking.status] = (bookingsByDate[dateStr].byStatus[booking.status] || 0) + 1;
      bookingsByDate[dateStr].byLocation[booking.location.name] = (bookingsByDate[dateStr].byLocation[booking.location.name] || 0) + 1;
      bookingsByDate[dateStr].bookings.push(booking);
    }

    // Sort dates
    const sortedDates = Object.keys(bookingsByDate).sort((a, b) => new Date(a) - new Date(b));

    console.log(`${'='.repeat(100)}\n`);
    console.log('DAILY BREAKDOWN:\n');

    sortedDates.forEach((dateStr, idx) => {
      const data = bookingsByDate[dateStr];
      const date = new Date(dateStr);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      
      console.log(`${dayName} ${dateStr}`);
      console.log(`├─ Total bookings: ${data.total}`);
      
      // Status
      console.log(`├─ Status:`);
      Object.entries(data.byStatus).forEach(([status, count]) => {
        console.log(`│  ├─ ${status}: ${count}`);
      });

      // Locations
      console.log(`└─ Locations:`);
      Object.entries(data.byLocation).forEach(([loc, count], locIdx, arr) => {
        const isLast = locIdx === arr.length - 1;
        const prefix = isLast ? '   └─' : '   ├─';
        console.log(`${prefix} ${loc}: ${count}`);
      });
      
      console.log();
    });

    console.log(`${'='.repeat(100)}\n`);

    // Statistics
    console.log('📈 STATISTICS:\n');
    
    const totalDays = sortedDates.length;
    const totalBookings = februaryBookings.length;
    const avgPerDay = (totalBookings / totalDays).toFixed(1);
    
    const counts = Object.values(bookingsByDate).map(d => d.total).sort((a, b) => a - b);
    const minPerDay = Math.min(...counts);
    const maxPerDay = Math.max(...counts);
    
    console.log(`Total days with bookings: ${totalDays}`);
    console.log(`Total bookings: ${totalBookings}`);
    console.log(`Average per day: ${avgPerDay}`);
    console.log(`Min per day: ${minPerDay} (${sortedDates.find(d => bookingsByDate[d].total === minPerDay)})`);
    console.log(`Max per day: ${maxPerDay} (${sortedDates.find(d => bookingsByDate[d].total === maxPerDay)})`);

    // Status breakdown
    console.log(`\nStatus breakdown:`);
    const allStatuses = {};
    februaryBookings.forEach(b => {
      allStatuses[b.status] = (allStatuses[b.status] || 0) + 1;
    });
    Object.entries(allStatuses).forEach(([status, count]) => {
      const pct = ((count / totalBookings) * 100).toFixed(1);
      console.log(`├─ ${status}: ${count} (${pct}%)`);
    });

    // Location breakdown
    console.log(`\nLocation breakdown:`);
    const allLocations = {};
    februaryBookings.forEach(b => {
      allLocations[b.location.name] = (allLocations[b.location.name] || 0) + 1;
    });
    Object.entries(allLocations).forEach(([loc, count]) => {
      const pct = ((count / totalBookings) * 100).toFixed(1);
      console.log(`├─ ${loc}: ${count} (${pct}%)`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeBookingsPerDay();

