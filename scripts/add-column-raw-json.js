const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('--- Adding raw_json column to payments table ---');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE public.payments 
      ADD COLUMN IF NOT EXISTS raw_json JSONB;
    `);
    console.log('✅ Column raw_json added successfully (or already exists).');

    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payments' AND table_schema = 'public' AND column_name = 'raw_json';
    `;
    console.log('Verification:', JSON.stringify(columns, null, 2));
  } catch (error) {
    console.error('❌ Error adding column:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


