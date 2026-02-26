const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const name = 'Iryna';
  const family = 'Kitnovska';
  
  console.log(`\n--- Searching for Team Member: ${name} ${family} ---`);
  const members = await prisma.$queryRaw`
    SELECT id, square_team_member_id, given_name, family_name, role, status
    FROM team_members
    WHERE given_name ILIKE ${'%' + name + '%'} OR family_name ILIKE ${'%' + family + '%'}
  `;
  
  if (members.length === 0) {
    console.log('No team member found.');
    return;
  }

  const memberId = members[0].id;
  const fifteenDaysAgo = new Date();
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

  console.log(`\n--- Counting bookings created by ${members[0].given_name} ${members[0].family_name} (ID: ${memberId}) since ${fifteenDaysAgo.toISOString()} ---`);
  
  const bookingCount = await prisma.booking.count({
    where: {
      administrator_id: memberId,
      created_at: {
        gte: fifteenDaysAgo
      }
    }
  });

  console.log(`\nTotal bookings created as administrator in last 15 days: ${bookingCount}`);

  const creatorTypeStats = await prisma.booking.groupBy({
    by: ['creator_type'],
    where: {
      administrator_id: memberId,
      created_at: {
        gte: fifteenDaysAgo
      }
    },
    _count: {
      _all: true
    }
  });
  console.log('\nBreakdown by creator_type:', JSON.stringify(creatorTypeStats, null, 2));
  
  const recentBookings = await prisma.booking.findMany({
    where: {
      administrator_id: memberId,
      created_at: {
        gte: fifteenDaysAgo
      }
    },
    select: {
      id: true,
      booking_id: true,
      created_at: true,
      status: true,
      creator_type: true,
      raw_json: true
    },
    orderBy: {
      created_at: 'desc'
    },
    take: 10
  });

  console.log('\nRecent bookings details:');
  recentBookings.forEach(b => {
    const creator = b.raw_json?.creator_details || 'N/A';
    console.log(`- ID: ${b.booking_id}, Created: ${b.created_at}, Status: ${b.status}, CreatorType: ${b.creator_type}, CreatorDetails: ${JSON.stringify(creator)}`);
  });

  console.log(`\n--- Checking Admin Analytics Daily for Iryna ---`);
  const analytics = await prisma.adminAnalyticsDaily.findMany({
    where: {
      team_member_id: memberId,
      date_pacific: {
        gte: fifteenDaysAgo
      }
    },
    orderBy: {
      date_pacific: 'desc'
    }
  });

  if (analytics.length === 0) {
    console.log('No analytics records found for this period.');
  } else {
    console.log('Analytics records found:');
    analytics.forEach(a => {
      console.log(`- Date: ${a.date_pacific.toISOString().split('T')[0]}, Bookings Created: ${a.bookings_created_count}, Appointments Total: ${a.appointments_total}`);
    });
    const totalInAnalytics = analytics.reduce((sum, a) => sum + a.bookings_created_count, 0);
    console.log(`\nTotal Bookings Created in Analytics Table: ${totalInAnalytics}`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
