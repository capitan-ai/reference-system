require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const orgId = 'd0e24178-2f94-4033-bc91-41f22df58278';

async function getJanuaryAppointments() {
  try {
    console.log('📅 January 2026 Appointments by Location\n');
    console.log('='.repeat(100));

    const appointmentsByLocation = await prisma.$queryRawUnsafe(`
      SELECT 
        location_id,
        l.name as location_name,
        SUM(appointments_count)::int as accepted_appointments,
        SUM(cancelled_appointments)::int as cancelled,
        SUM(no_show_appointments)::int as no_show,
        COUNT(DISTINCT DATE(date))::int as operating_days,
        COUNT(DISTINCT customer_id)::int as unique_customers
      FROM analytics_appointments_by_location_daily
      LEFT JOIN locations l ON location_id = l.id
      WHERE organization_id = $1::uuid
        AND DATE(date) >= '2026-01-01'::date
        AND DATE(date) <= '2026-01-31'::date
      GROUP BY location_id, l.name
      ORDER BY location_name
    `, orgId);

    let totalAppts = 0;
    appointmentsByLocation.forEach(al => {
      const locName = al.location_name || 'Unknown';
      const appts = al.accepted_appointments || 0;
      totalAppts += appts;
      console.log(`\n📍 ${locName}`);
      console.log(`  Accepted appointments: ${appts}`);
      console.log(`  Cancelled: ${al.cancelled || 0}`);
      console.log(`  No-show: ${al.no_show || 0}`);
      console.log(`  Operating days: ${al.operating_days}`);
      console.log(`  Unique customers: ${al.unique_customers}`);
    });

    console.log(`\n${'='.repeat(100)}`);
    console.log(`\n💼 January Total: ${totalAppts} accepted appointments`);

    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

getJanuaryAppointments();
