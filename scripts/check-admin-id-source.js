const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('--- Checking administrator_id and raw_json in payments ---');
    
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        COUNT(administrator_id) as has_admin_id,
        COUNT(*) FILTER (WHERE raw_json->>'employee_id' IS NOT NULL) as has_employee_id_in_json,
        COUNT(*) FILTER (WHERE raw_json->>'team_member_id' IS NOT NULL) as has_team_member_id_in_json
      FROM payments;
    `;
    console.log('Stats:', JSON.stringify(stats, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));

    console.log('\n--- Sample records ---');
    const samples = await prisma.$queryRaw`
      SELECT 
        id, 
        administrator_id, 
        raw_json->>'employee_id' as employee_id,
        raw_json->>'team_member_id' as team_member_id
      FROM payments 
      WHERE raw_json->>'employee_id' IS NOT NULL OR raw_json->>'team_member_id' IS NOT NULL
      LIMIT 5;
    `;
    console.log(JSON.stringify(samples, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();


