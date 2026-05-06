const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const views = [
    'analytics_appointments_by_location_daily',
    'analytics_customer_segments',
    'analytics_master_performance_daily',
    'analytics_overview_daily',
    'analytics_service_performance_daily',
    'v_master_salary_monthly',
  ];

  for (const v of views) {
    const def = await prisma.$queryRawUnsafe(
      `SELECT pg_get_viewdef('public.${v}'::regclass, true) AS def`
    );
    console.log(`\n=========== ${v} ===========`);
    console.log(def[0].def);
  }

  await prisma.$disconnect();
})();
