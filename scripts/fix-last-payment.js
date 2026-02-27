const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN?.trim();
  
  try {
    const payments = await prisma.$queryRaw`SELECT payment_id FROM payments WHERE raw_json IS NULL;`;
    if (payments.length === 0) {
      console.log('✅ All payments already have raw_json.');
      return;
    }

    const payment_id = payments[0].payment_id;
    console.log(`Trying to fetch last payment: ${payment_id}`);

    const response = await fetch(`https://connect.squareup.com/v2/payments/${payment_id}`, {
      headers: {
        'Square-Version': '2026-01-22',
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      await prisma.$executeRaw`UPDATE payments SET raw_json = ${data.payment} WHERE payment_id = ${payment_id};`;
      console.log('✅ Successfully fixed the last payment.');
    } else {
      const text = await response.text();
      console.error(`❌ Still failing for ${payment_id}. Status: ${response.status}`);
      console.error('Response snippet:', text.substring(0, 200));
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();


