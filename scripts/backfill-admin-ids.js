const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('--- Updating administrator_id from raw_json (employee_id/team_member_id) ---');
    
    // This query matches Square IDs from raw_json to our team_members table
    // and updates the administrator_id with our internal UUID.
    const result = await prisma.$executeRaw`
      UPDATE public.payments p
      SET 
        administrator_id = tm.id,
        updated_at = NOW()
      FROM public.team_members tm
      WHERE (
        p.raw_json->>'employee_id' = tm.square_team_member_id 
        OR 
        p.raw_json->>'team_member_id' = tm.square_team_member_id
      )
      AND p.organization_id = tm.organization_id
      AND (p.administrator_id IS NULL OR p.administrator_id != tm.id);
    `;

    console.log(`✅ Successfully updated ${result} payment records with the correct administrator_id.`);

    // Final check
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        COUNT(administrator_id) as has_admin_id,
        COUNT(*) FILTER (WHERE administrator_id IS NULL AND (raw_json->>'employee_id' IS NOT NULL OR raw_json->>'team_member_id' IS NOT NULL)) as still_missing_but_has_id_in_json
      FROM payments;
    `;
    console.log('\nPost-update Stats:', JSON.stringify(stats, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));

  } catch (error) {
    console.error('❌ Error during update:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();


