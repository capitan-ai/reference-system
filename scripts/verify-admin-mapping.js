const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('--- Verifying administrator_id Mapping Accuracy ---');
    
    // Check for any mismatches between administrator_id and raw_json
    const mismatches = await prisma.$queryRaw`
      SELECT 
        p.id as payment_id,
        p.administrator_id as current_admin_uuid,
        tm.square_team_member_id as mapped_square_id,
        p.raw_json->>'employee_id' as json_employee_id,
        p.raw_json->>'team_member_id' as json_team_member_id
      FROM public.payments p
      JOIN public.team_members tm ON p.administrator_id = tm.id
      WHERE 
        (p.raw_json->>'employee_id' IS NOT NULL AND p.raw_json->>'employee_id' != tm.square_team_member_id)
        OR
        (p.raw_json->>'team_member_id' IS NOT NULL AND p.raw_json->>'team_member_id' != tm.square_team_member_id)
      LIMIT 10;
    `;

    if (mismatches.length === 0) {
      console.log('✅ Success: All mapped administrator_ids match the Square IDs in raw_json.');
    } else {
      console.log('❌ Found Mismatches:', JSON.stringify(mismatches, null, 2));
    }

    // Check for payments that HAVE a Square ID in JSON but NO administrator_id in DB
    const missingMappings = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as count,
        array_agg(DISTINCT p.raw_json->>'employee_id') FILTER (WHERE p.raw_json->>'employee_id' IS NOT NULL) as missing_employee_ids
      FROM public.payments p
      WHERE p.administrator_id IS NULL 
      AND (p.raw_json->>'employee_id' IS NOT NULL OR p.raw_json->>'team_member_id' IS NOT NULL);
    `;

    const missingCount = Number(missingMappings[0].count);
    if (missingCount === 0) {
      console.log('✅ Success: No payments with Square IDs are missing an administrator_id mapping.');
    } else {
      console.log(`⚠️ Warning: ${missingCount} payments have a Square ID in JSON but no administrator_id in DB.`);
      console.log('This usually means these Square IDs do not exist in our team_members table.');
      console.log('Missing Square IDs sample:', missingMappings[0].missing_employee_ids?.slice(0, 5));
    }

    // Sample check of names to be human-readable
    console.log('\n--- Sample Mapping Check (Human Readable) ---');
    const samples = await prisma.$queryRaw`
      SELECT 
        tm.given_name || ' ' || tm.family_name as team_member_name,
        tm.square_team_member_id,
        COUNT(*) as payment_count
      FROM public.payments p
      JOIN public.team_members tm ON p.administrator_id = tm.id
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT 5;
    `;
    console.log('Top 5 administrators by payment count:');
    console.table(samples);

  } catch (error) {
    console.error('❌ Error during verification:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();


