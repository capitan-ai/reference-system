require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'; // ZORINA Nail Studio

async function analyzeBookingStats() {
  console.log('📊 Booking Statistics - Daily & Monthly Analysis\n');

  try {
    // Get all bookings
    console.log('📚 Fetching all bookings...');
    const allBookings = await prisma.booking.findMany({
      where: {
        organization_id: ORG_ID,
        status: { in: ['ACCEPTED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER'] }
      },
      select: {
        booking_id: true,
        start_at: true,
        status: true,
        location: { select: { name: true } }
      }
    });

    console.log(`✅ Loaded ${allBookings.length} bookings\n`);

    // Organize by date and month
    const dailyStats = {};
    const monthlyStats = {};
    const monthlyByLocation = {};

    allBookings.forEach(booking => {
      const date = new Date(booking.start_at);
      const dateStr = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      
      const monthStr = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long'
      });

      const dayOfWeek = date.toLocaleDateString('en-US', {
        weekday: 'short'
      });

      const location = booking.location.name;

      // Daily stats
      if (!dailyStats[dateStr]) {
        dailyStats[dateStr] = {
          date: dateStr,
          dayOfWeek: dayOfWeek,
          total: 0,
          accepted: 0,
          cancelled: 0,
          byLocation: {}
        };
      }

      dailyStats[dateStr].total++;
      if (booking.status === 'ACCEPTED') {
        dailyStats[dateStr].accepted++;
      } else {
        dailyStats[dateStr].cancelled++;
      }

      if (!dailyStats[dateStr].byLocation[location]) {
        dailyStats[dateStr].byLocation[location] = 0;
      }
      dailyStats[dateStr].byLocation[location]++;

      // Monthly stats
      if (!monthlyStats[monthStr]) {
        monthlyStats[monthStr] = {
          month: monthStr,
          total: 0,
          accepted: 0,
          cancelled: 0,
          byLocation: {}
        };
        monthlyByLocation[monthStr] = {};
      }

      monthlyStats[monthStr].total++;
      if (booking.status === 'ACCEPTED') {
        monthlyStats[monthStr].accepted++;
      } else {
        monthlyStats[monthStr].cancelled++;
      }

      if (!monthlyStats[monthStr].byLocation[location]) {
        monthlyStats[monthStr].byLocation[location] = 0;
      }
      monthlyStats[monthStr].byLocation[location]++;

      if (!monthlyByLocation[monthStr][location]) {
        monthlyByLocation[monthStr][location] = { total: 0, accepted: 0, cancelled: 0 };
      }
      monthlyByLocation[monthStr][location].total++;
      if (booking.status === 'ACCEPTED') {
        monthlyByLocation[monthStr][location].accepted++;
      } else {
        monthlyByLocation[monthStr][location].cancelled++;
      }
    });

    // Display Daily Stats
    console.log('📅 DAILY BOOKINGS\n');
    console.log(`${'Date'.padEnd(15)} ${'Day'.padEnd(6)} ${'Total'.padEnd(8)} ${'Accepted'.padEnd(12)} ${'Cancelled'.padEnd(12)} ${'Locations'}`);
    console.log('='.repeat(100));

    const sortedDates = Object.keys(dailyStats).sort();
    
    let totalBookings = 0;
    let totalAccepted = 0;
    let totalCancelled = 0;

    sortedDates.forEach(dateStr => {
      const stats = dailyStats[dateStr];
      const locationBreakdown = Object.entries(stats.byLocation)
        .map(([loc, count]) => `${loc.split(' ').slice(-2).join(' ')}: ${count}`)
        .join(' | ');

      console.log(
        `${dateStr.padEnd(15)} ${stats.dayOfWeek.padEnd(6)} ${stats.total.toString().padEnd(8)} ${stats.accepted.toString().padEnd(12)} ${stats.cancelled.toString().padEnd(12)} ${locationBreakdown}`
      );

      totalBookings += stats.total;
      totalAccepted += stats.accepted;
      totalCancelled += stats.cancelled;
    });

    console.log('='.repeat(100));
    console.log(
      `${'TOTAL'.padEnd(15)} ${' '.padEnd(6)} ${totalBookings.toString().padEnd(8)} ${totalAccepted.toString().padEnd(12)} ${totalCancelled.toString().padEnd(12)}`
    );

    // Calculate daily average
    const uniqueDays = Object.keys(dailyStats).length;
    const avgPerDay = (totalBookings / uniqueDays).toFixed(2);
    console.log(`\n📊 Daily Average: ${avgPerDay} bookings/day (over ${uniqueDays} days)\n`);

    // Display Monthly Stats
    console.log('\n' + '='.repeat(100));
    console.log('\n📅 MONTHLY BOOKINGS\n');
    console.log(`${'Month'.padEnd(20)} ${'Total'.padEnd(10)} ${'Accepted'.padEnd(12)} ${'Cancelled'.padEnd(12)} ${'Breakdown by Location'}`);
    console.log('='.repeat(100));

    const sortedMonths = Object.keys(monthlyStats).sort((a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateA - dateB;
    });

    let grandTotal = 0;
    let grandAccepted = 0;
    let grandCancelled = 0;

    sortedMonths.forEach(monthStr => {
      const stats = monthlyStats[monthStr];
      const locStats = monthlyByLocation[monthStr];

      const locationBreakdown = Object.entries(locStats)
        .map(([loc, data]) => `${loc.split(' ').slice(-2).join(' ')}: ${data.total}`)
        .join(' | ');

      console.log(
        `${monthStr.padEnd(20)} ${stats.total.toString().padEnd(10)} ${stats.accepted.toString().padEnd(12)} ${stats.cancelled.toString().padEnd(12)} ${locationBreakdown}`
      );

      grandTotal += stats.total;
      grandAccepted += stats.accepted;
      grandCancelled += stats.cancelled;
    });

    console.log('='.repeat(100));
    console.log(
      `${'TOTAL'.padEnd(20)} ${grandTotal.toString().padEnd(10)} ${grandAccepted.toString().padEnd(12)} ${grandCancelled.toString().padEnd(12)}`
    );

    // Summary
    console.log('\n' + '='.repeat(100));
    console.log('\n📈 SUMMARY\n');
    console.log(`Total Bookings: ${grandTotal}`);
    console.log(`  - Accepted: ${grandAccepted} (${((grandAccepted/grandTotal)*100).toFixed(1)}%)`);
    console.log(`  - Cancelled: ${grandCancelled} (${((grandCancelled/grandTotal)*100).toFixed(1)}%)`);
    console.log(`\nDaily Average: ${avgPerDay} bookings/day`);
    console.log(`Monthly Average: ${(grandTotal/sortedMonths.length).toFixed(2)} bookings/month`);
    console.log(`Busiest Day: ${sortedDates[0]} (${Math.max(...sortedDates.map(d => dailyStats[d].total))} bookings)`);
    console.log(`Slowest Day: ${sortedDates[sortedDates.length-1]} (${Math.min(...sortedDates.map(d => dailyStats[d].total))} bookings)`);

    // Location comparison
    console.log('\n📍 LOCATION COMPARISON\n');
    const locationTotals = {};
    allBookings.forEach(booking => {
      const loc = booking.location.name;
      if (!locationTotals[loc]) {
        locationTotals[loc] = { total: 0, accepted: 0, cancelled: 0 };
      }
      locationTotals[loc].total++;
      if (booking.status === 'ACCEPTED') {
        locationTotals[loc].accepted++;
      } else {
        locationTotals[loc].cancelled++;
      }
    });

    Object.entries(locationTotals).forEach(([loc, data]) => {
      console.log(`${loc}`);
      console.log(`  Total: ${data.total} (${((data.total/grandTotal)*100).toFixed(1)}%)`);
      console.log(`  Accepted: ${data.accepted}`);
      console.log(`  Cancelled: ${data.cancelled}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeBookingStats();

