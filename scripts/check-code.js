const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const code = 'LEMON7638';
  
  console.log(`\n--- Checking if code ${code} is a personal_code ---`);
  const referrers = await prisma.$queryRaw`
    SELECT square_customer_id, given_name, family_name, personal_code
    FROM square_existing_clients 
    WHERE personal_code = ${code}
  `;
  console.log(JSON.stringify(referrers, null, 2));

  console.log(`\n--- Checking square_existing_clients for usage of code: ${code} ---`);
  const clients = await prisma.$queryRaw`
    SELECT square_customer_id, given_name, family_name, used_referral_code, got_signup_bonus, created_at
    FROM square_existing_clients 
    WHERE used_referral_code = ${code}
  `;
  console.log(JSON.stringify(clients, null, 2));

  console.log(`\n--- Checking referral_rewards for code: ${code} ---`);
  const rewards = await prisma.$queryRaw`
    SELECT id, referrer_customer_id, referred_customer_id, reward_amount_cents, status, created_at, metadata
    FROM referral_rewards
    WHERE metadata->>'referral_code' = ${code}
  `;
  console.log(JSON.stringify(rewards, null, 2));

  console.log(`\n--- Checking bookings for code: ${code} in raw_json ---`);
  const bookings = await prisma.$queryRaw`
    SELECT id, booking_id, customer_id, status, created_at
    FROM bookings
    WHERE raw_json::text LIKE ${'%' + code + '%'}
    LIMIT 5
  `;
  console.log(JSON.stringify(bookings, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());

