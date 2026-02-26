const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Listing all tables in the public schema...');
    const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`;
    console.log('Tables in public schema:', JSON.stringify(tables, null, 2));

    const paymentsTable = tables.find(t => t.table_name === 'payments');
    if (paymentsTable) {
      console.log('Adding raw_json column to public.payments...');
      await prisma.$executeRawUnsafe('ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS raw_json JSONB;');
      console.log('Column added successfully.');
    } else {
      console.log('Table public.payments not found. Creating it...');
      // This is a simplified creation, assuming other tables might be missing too
      // But let's just try to add the column if it exists or report it's missing.
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
