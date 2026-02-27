const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkIrynaData() {
  try {
    console.log('--- Checking Iryna Kitnovska in team_members ---');
    const iryna = await prisma.teamMember.findFirst({
      where: {
        given_name: 'Iryna',
        family_name: 'Kitnovska'
      }
    });

    if (!iryna) {
      console.log('❌ Iryna Kitnovska not found in team_members table.');
      return;
    }

    console.log('✅ Found Iryna Kitnovska:', JSON.stringify(iryna, null, 2));

    console.log('\n--- Checking Iryna Kitnovska in admin_analytics_daily ---');
    const analytics = await prisma.$queryRaw`
      SELECT date_pacific, appointments_total, appointments_accepted, creator_revenue_cents, updated_at 
      FROM admin_analytics_daily 
      WHERE team_member_id = ${iryna.id}::uuid
      ORDER BY date_pacific DESC 
      LIMIT 10;
    `;

    if (analytics.length === 0) {
      console.log('❌ No analytics data found for Iryna Kitnovska in admin_analytics_daily.');
    } else {
      console.log('✅ Found analytics data:');
      console.table(analytics);
    }

    console.log('\n--- Checking ALL bookings for Iryna Kitnovska ---');
    const allBookings = await prisma.booking.findMany({
      where: {
        administrator_id: iryna.id,
      },
      orderBy: {
        start_at: 'desc'
      }
    });

    if (allBookings.length === 0) {
      console.log('❌ No bookings found for Iryna Kitnovska as administrator.');
    } else {
      console.log(`✅ Found ${allBookings.length} total bookings as administrator:`);
      allBookings.slice(0, 10).forEach(b => {
          console.log(`- ID: ${b.id}, Status: ${b.status}, Start At: ${b.start_at}`);
      });
    }

    console.log('\n--- Checking ALL analytics data for Iryna Kitnovska ---');
    const allAnalytics = await prisma.$queryRaw`
      SELECT date_pacific, appointments_total, appointments_accepted, creator_revenue_cents, updated_at 
      FROM admin_analytics_daily 
      WHERE team_member_id = ${iryna.id}::uuid
      ORDER BY date_pacific DESC;
    `;

    if (allAnalytics.length === 0) {
      console.log('❌ No analytics data found for Iryna Kitnovska in admin_analytics_daily.');
    } else {
      console.log(`✅ Found ${allAnalytics.length} analytics rows:`);
      console.table(allAnalytics);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkIrynaData();

