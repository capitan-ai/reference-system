const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('--- Checking Payments Table Structure ---');
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'payments' AND table_schema = 'public';
    `;
    console.log('Columns in payments table:', JSON.stringify(columns, null, 2));

    const rawJsonColumn = columns.find(c => c.column_name === 'raw_json');
    if (rawJsonColumn) {
      console.log('\n✅ raw_json column exists.');
      
      const stats = await prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_payments,
          COUNT(raw_json) as payments_with_json,
          COUNT(*) - COUNT(raw_json) as payments_without_json
        FROM payments;
      `;
      console.log('Payment Stats:', JSON.stringify(stats, null, 2));
      
      if (stats[0].payments_with_json > 0) {
        console.log('\nSample raw_json content:');
        const sample = await prisma.$queryRaw`
          SELECT id, raw_json 
          FROM payments 
          WHERE raw_json IS NOT NULL 
          LIMIT 1;
        `;
        console.log(JSON.stringify(sample, null, 2));
      }
    } else {
      console.log('\n❌ raw_json column does NOT exist in the database.');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

