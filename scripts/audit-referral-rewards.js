require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278';

function banner(title) {
  console.log('\n' + '='.repeat(80));
  console.log(`  ${title}`);
  console.log('='.repeat(80));
}

function table(rows, headers) {
  if (!rows || rows.length === 0) {
    console.log('  (no rows)');
    return;
  }
  const keys = headers || Object.keys(rows[0]);
  const widths = keys.map(k => {
    const maxVal = rows.reduce((mx, r) => {
      const v = String(r[k] ?? '');
      return v.length > mx ? v.length : mx;
    }, 0);
    return Math.max(k.length, maxVal) + 2;
  });
  const headerLine = keys.map((k, i) => k.padEnd(widths[i])).join('| ');
  console.log('  ' + headerLine);
  console.log('  ' + widths.map(w => '-'.repeat(w)).join('+-'));
  for (const row of rows) {
    const line = keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('| ');
    console.log('  ' + line);
  }
}

function dollars(cents) {
  if (cents === null || cents === undefined) return '$0.00';
  return '$' + (Number(cents) / 100).toFixed(2);
}

async function main() {
  // =========================================================================
  // 1. TOTAL NEW CUSTOMERS VIA REFERRAL
  // =========================================================================
  banner('1. TOTAL NEW CUSTOMERS VIA REFERRAL');

  const referredCustomers = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM square_existing_clients
    WHERE organization_id = ${ORG_ID}::uuid
      AND used_referral_code IS NOT NULL
      AND used_referral_code != ''
  `;
  console.log(`  Total customers with used_referral_code: ${referredCustomers[0].count}`);

  // =========================================================================
  // 2. FRIEND SIGNUP BONUS BREAKDOWN
  // =========================================================================
  banner('2. FRIEND SIGNUP BONUS BREAKDOWN');

  // All referred customers
  const allReferred = await prisma.$queryRaw`
    SELECT square_customer_id, given_name, family_name, used_referral_code,
           first_payment_completed, got_signup_bonus
    FROM square_existing_clients
    WHERE organization_id = ${ORG_ID}::uuid
      AND used_referral_code IS NOT NULL
      AND used_referral_code != ''
  `;

  // Gift cards with FRIEND_SIGNUP_BONUS
  const friendGiftCards = await prisma.$queryRaw`
    SELECT gc.square_customer_id, gc.initial_amount_cents, gc.current_balance_cents,
           gc.square_gift_card_id, gc.created_at
    FROM gift_cards gc
    WHERE gc.organization_id = ${ORG_ID}::uuid
      AND gc.reward_type = 'FRIEND_SIGNUP_BONUS'
  `;

  // Referral rewards with friend_signup_bonus
  const friendRewards = await prisma.$queryRaw`
    SELECT rr.referred_customer_id, rr.reward_amount_cents, rr.status, rr.created_at
    FROM referral_rewards rr
    WHERE rr.organization_id = ${ORG_ID}::uuid
      AND rr.reward_type = 'friend_signup_bonus'
  `;

  const gcCustomerSet = new Set(friendGiftCards.map(g => g.square_customer_id));
  const rrCustomerSet = new Set(friendRewards.map(r => r.referred_customer_id));

  const missingGiftCard = allReferred.filter(c => !gcCustomerSet.has(c.square_customer_id));
  const missingRRRecord = allReferred.filter(c => !rrCustomerSet.has(c.square_customer_id));

  const totalFriendBonusCents = friendGiftCards.reduce((s, g) => s + (g.initial_amount_cents || 0), 0);

  console.log(`  Referred customers total:                     ${allReferred.length}`);
  console.log(`  Have FRIEND_SIGNUP_BONUS gift card:            ${friendGiftCards.length}`);
  console.log(`  Have friend_signup_bonus referral_reward:      ${friendRewards.length}`);
  console.log(`  MISSING gift card:                             ${missingGiftCard.length}`);
  console.log(`  MISSING referral_rewards record:               ${missingRRRecord.length}`);
  console.log(`  Total $ issued as friend_signup_bonus:         ${dollars(totalFriendBonusCents)}`);

  if (missingGiftCard.length > 0) {
    console.log('\n  Customers MISSING friend_signup_bonus gift card:');
    table(missingGiftCard.map(c => ({
      customer_id: c.square_customer_id,
      name: `${c.given_name || ''} ${c.family_name || ''}`.trim(),
      used_code: c.used_referral_code,
      got_signup_bonus: c.got_signup_bonus,
    })));
  }

  if (missingRRRecord.length > 0) {
    console.log('\n  Customers MISSING friend_signup_bonus referral_rewards record:');
    table(missingRRRecord.map(c => ({
      customer_id: c.square_customer_id,
      name: `${c.given_name || ''} ${c.family_name || ''}`.trim(),
      used_code: c.used_referral_code,
    })));
  }

  // =========================================================================
  // 3. REFERRER REWARDS BREAKDOWN
  // =========================================================================
  banner('3. REFERRER REWARDS BREAKDOWN');

  const referrerRewards = await prisma.$queryRaw`
    SELECT rr.referrer_customer_id, rr.referred_customer_id, rr.reward_amount_cents,
           rr.status, rr.created_at, rr.reward_type
    FROM referral_rewards rr
    WHERE rr.organization_id = ${ORG_ID}::uuid
      AND rr.reward_type = 'referrer_reward'
  `;

  const rrByStatus = {};
  for (const r of referrerRewards) {
    rrByStatus[r.status] = (rrByStatus[r.status] || 0) + 1;
  }

  const totalReferrerCents = referrerRewards.reduce((s, r) => s + (r.reward_amount_cents || 0), 0);

  // Who SHOULD have gotten a referrer reward: customers who were referred AND have first_payment_completed = true
  // The referrer is found via used_referral_code -> matching referral_code in square_existing_clients
  const shouldHaveReferrerReward = await prisma.$queryRaw`
    SELECT referred.square_customer_id as referred_customer_id,
           referred.given_name as referred_given_name,
           referred.family_name as referred_family_name,
           referred.used_referral_code,
           referred.first_payment_completed,
           referrer.square_customer_id as referrer_customer_id,
           referrer.given_name as referrer_given_name,
           referrer.family_name as referrer_family_name
    FROM square_existing_clients referred
    JOIN square_existing_clients referrer
      ON referrer.organization_id = ${ORG_ID}::uuid
      AND referrer.referral_code = referred.used_referral_code
    WHERE referred.organization_id = ${ORG_ID}::uuid
      AND referred.used_referral_code IS NOT NULL
      AND referred.used_referral_code != ''
      AND referred.first_payment_completed = true
  `;

  // Check which of those actually got a referrer_reward
  const referrerRewardSet = new Set(referrerRewards.map(r => r.referred_customer_id));
  const missingReferrerReward = shouldHaveReferrerReward.filter(s => !referrerRewardSet.has(s.referred_customer_id));

  console.log(`  Total referral_rewards with reward_type='referrer_reward': ${referrerRewards.length}`);
  console.log(`  Status breakdown:`);
  for (const [status, count] of Object.entries(rrByStatus)) {
    console.log(`    ${status}: ${count}`);
  }
  console.log(`  Referrers who SHOULD have a reward (referred customer first_payment_completed=true): ${shouldHaveReferrerReward.length}`);
  console.log(`  Referrers MISSING a reward entirely: ${missingReferrerReward.length}`);
  console.log(`  Total $ issued as referrer_reward: ${dollars(totalReferrerCents)}`);

  if (missingReferrerReward.length > 0) {
    console.log('\n  Referrers MISSING referrer_reward:');
    table(missingReferrerReward.map(r => ({
      referrer: `${r.referrer_given_name || ''} ${r.referrer_family_name || ''}`.trim(),
      referrer_id: r.referrer_customer_id,
      referred: `${r.referred_given_name || ''} ${r.referred_family_name || ''}`.trim(),
      referred_id: r.referred_customer_id,
      used_code: r.used_referral_code,
    })));
  }

  // =========================================================================
  // 4. GIFT CARD USAGE STATS
  // =========================================================================
  banner('4. GIFT CARD USAGE STATS');

  const usageStats = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE current_balance_cents < initial_amount_cents) as used_count,
      COUNT(*) FILTER (WHERE current_balance_cents = initial_amount_cents) as untouched_count,
      COUNT(*) FILTER (WHERE current_balance_cents = 0) as zero_balance_count,
      COUNT(*) as total
    FROM gift_cards
    WHERE organization_id = ${ORG_ID}::uuid
      AND reward_type = 'FRIEND_SIGNUP_BONUS'
  `;

  const stats = usageStats[0];
  console.log(`  Total FRIEND_SIGNUP_BONUS gift cards:  ${stats.total}`);
  console.log(`  Used (balance < initial):              ${stats.used_count}`);
  console.log(`  Untouched (balance = initial):         ${stats.untouched_count}`);
  console.log(`  $0 balance:                            ${stats.zero_balance_count}`);

  // List untouched ones with customer names
  const untouchedCards = await prisma.$queryRaw`
    SELECT gc.square_customer_id, gc.square_gift_card_id, gc.gift_card_gan,
           gc.initial_amount_cents, gc.current_balance_cents, gc.created_at,
           sec.given_name, sec.family_name, sec.email_address
    FROM gift_cards gc
    LEFT JOIN square_existing_clients sec
      ON sec.organization_id = ${ORG_ID}::uuid
      AND sec.square_customer_id = gc.square_customer_id
    WHERE gc.organization_id = ${ORG_ID}::uuid
      AND gc.reward_type = 'FRIEND_SIGNUP_BONUS'
      AND gc.current_balance_cents = gc.initial_amount_cents
    ORDER BY gc.created_at DESC
  `;

  if (untouchedCards.length > 0) {
    console.log('\n  Untouched FRIEND_SIGNUP_BONUS gift cards:');
    table(untouchedCards.map(c => ({
      name: `${c.given_name || ''} ${c.family_name || ''}`.trim(),
      customer_id: c.square_customer_id,
      gift_card_id: c.square_gift_card_id,
      gan: c.gift_card_gan || '',
      initial: dollars(c.initial_amount_cents),
      balance: dollars(c.current_balance_cents),
      created: c.created_at ? new Date(c.created_at).toISOString().split('T')[0] : '',
    })));
  }

  // =========================================================================
  // 5. IANA ZORINA SPECIFIC CASE
  // =========================================================================
  banner('5. IANA ZORINA SPECIFIC CASE');

  // Find Iana Zorina
  console.log('\n  --- Iana Zorina ---');
  const ianaResults = await prisma.$queryRaw`
    SELECT square_customer_id, given_name, family_name, email_address, phone_number,
           referral_code, used_referral_code, first_payment_completed, got_signup_bonus,
           activated_as_referrer, total_referrals, total_rewards, personal_code
    FROM square_existing_clients
    WHERE organization_id = ${ORG_ID}::uuid
      AND (given_name ILIKE '%Iana%' OR family_name ILIKE '%Iana%')
      AND (given_name ILIKE '%Zorina%' OR family_name ILIKE '%Zorina%')
  `;
  if (ianaResults.length > 0) {
    for (const iana of ianaResults) {
      console.log(`  Name: ${iana.given_name} ${iana.family_name}`);
      console.log(`  Customer ID: ${iana.square_customer_id}`);
      console.log(`  Email: ${iana.email_address}`);
      console.log(`  Phone: ${iana.phone_number}`);
      console.log(`  Referral Code: ${iana.referral_code}`);
      console.log(`  Personal Code: ${iana.personal_code}`);
      console.log(`  Used Referral Code: ${iana.used_referral_code}`);
      console.log(`  First Payment Completed: ${iana.first_payment_completed}`);
      console.log(`  Got Signup Bonus: ${iana.got_signup_bonus}`);
      console.log(`  Activated as Referrer: ${iana.activated_as_referrer}`);
      console.log(`  Total Referrals: ${iana.total_referrals}`);
      console.log(`  Total Rewards: ${iana.total_rewards}`);
    }
  } else {
    console.log('  Iana Zorina NOT FOUND');
  }

  // Find Manager Zorina and all Zorinas
  console.log('\n  --- All "Zorina" or "Manager" matches ---');
  const zorinaResults = await prisma.$queryRaw`
    SELECT square_customer_id, given_name, family_name, email_address, phone_number,
           referral_code, used_referral_code, first_payment_completed, got_signup_bonus,
           activated_as_referrer, total_referrals, total_rewards, personal_code
    FROM square_existing_clients
    WHERE organization_id = ${ORG_ID}::uuid
      AND (given_name ILIKE '%Manager%' OR family_name ILIKE '%Manager%'
           OR given_name ILIKE '%Zorina%' OR family_name ILIKE '%Zorina%')
  `;
  if (zorinaResults.length > 0) {
    table(zorinaResults.map(z => ({
      name: `${z.given_name || ''} ${z.family_name || ''}`.trim(),
      customer_id: z.square_customer_id,
      referral_code: z.referral_code || '',
      used_referral_code: z.used_referral_code || '',
      first_payment: z.first_payment_completed,
      got_bonus: z.got_signup_bonus,
      activated_referrer: z.activated_as_referrer,
    })));
  } else {
    console.log('  No Zorina/Manager matches found.');
  }

  // Check if Manager Zorina used Iana's referral code
  console.log('\n  --- Manager Zorina referral link to Iana ---');
  const managerZorina = zorinaResults.find(z =>
    (z.given_name && z.given_name.toLowerCase().includes('manager')) ||
    (z.family_name && z.family_name.toLowerCase().includes('manager'))
  );
  const ianaZorina = ianaResults[0];

  if (managerZorina && ianaZorina) {
    const usedIanasCode = managerZorina.used_referral_code === ianaZorina.referral_code;
    console.log(`  Manager Zorina's used_referral_code: ${managerZorina.used_referral_code}`);
    console.log(`  Iana Zorina's referral_code: ${ianaZorina.referral_code}`);
    console.log(`  Did Manager use Iana's code? ${usedIanasCode ? 'YES' : 'NO'}`);

    // Manager Zorina's first_payment_completed
    console.log(`  Manager Zorina first_payment_completed: ${managerZorina.first_payment_completed}`);

    // Check Manager's friend_signup_bonus gift card
    console.log('\n  --- Manager Zorina friend_signup_bonus gift card ---');
    const managerGC = await prisma.$queryRaw`
      SELECT gc.*
      FROM gift_cards gc
      WHERE gc.organization_id = ${ORG_ID}::uuid
        AND gc.square_customer_id = ${managerZorina.square_customer_id}
        AND gc.reward_type = 'FRIEND_SIGNUP_BONUS'
    `;
    if (managerGC.length > 0) {
      for (const gc of managerGC) {
        console.log(`  Gift Card ID: ${gc.square_gift_card_id}`);
        console.log(`  GAN: ${gc.gift_card_gan}`);
        console.log(`  Initial Amount: ${dollars(gc.initial_amount_cents)}`);
        console.log(`  Current Balance: ${dollars(gc.current_balance_cents)}`);
        console.log(`  State: ${gc.state}`);
        console.log(`  Created: ${gc.created_at}`);
      }
    } else {
      console.log('  Manager Zorina has NO FRIEND_SIGNUP_BONUS gift card');
    }

    // Check if Iana has a referrer_reward for Manager Zorina
    console.log('\n  --- Iana referrer_reward for Manager Zorina ---');
    const ianaReferrerReward = await prisma.$queryRaw`
      SELECT rr.*
      FROM referral_rewards rr
      WHERE rr.organization_id = ${ORG_ID}::uuid
        AND rr.referrer_customer_id = ${ianaZorina.square_customer_id}
        AND rr.referred_customer_id = ${managerZorina.square_customer_id}
    `;
    if (ianaReferrerReward.length > 0) {
      for (const rr of ianaReferrerReward) {
        console.log(`  Reward ID: ${rr.id}`);
        console.log(`  Reward Type: ${rr.reward_type}`);
        console.log(`  Amount: ${dollars(rr.reward_amount_cents)}`);
        console.log(`  Status: ${rr.status}`);
        console.log(`  Created: ${rr.created_at}`);
        console.log(`  Paid At: ${rr.paid_at}`);
      }
    } else {
      console.log('  Iana has NO referrer_reward for Manager Zorina');
    }

    // Manager Zorina's bookings
    console.log('\n  --- Manager Zorina bookings ---');
    const managerBookings = await prisma.$queryRaw`
      SELECT booking_id, status, start_at, created_at, source, creator_type
      FROM bookings
      WHERE organization_id = ${ORG_ID}::uuid
        AND customer_id = ${managerZorina.square_customer_id}
      ORDER BY start_at DESC
      LIMIT 20
    `;
    if (managerBookings.length > 0) {
      table(managerBookings.map(b => ({
        booking_id: b.booking_id,
        status: b.status,
        start_at: b.start_at ? new Date(b.start_at).toISOString() : '',
        source: b.source || '',
        creator: b.creator_type || '',
      })));
    } else {
      console.log('  No bookings found for Manager Zorina');
    }

    // Manager Zorina's payments
    console.log('\n  --- Manager Zorina payments ---');
    const managerPayments = await prisma.$queryRaw`
      SELECT payment_id, status, amount_money_amount, tip_money_amount, total_money_amount,
             created_at, source_type, event_type
      FROM payments
      WHERE organization_id = ${ORG_ID}::uuid
        AND customer_id = ${managerZorina.square_customer_id}
      ORDER BY created_at DESC
      LIMIT 20
    `;
    if (managerPayments.length > 0) {
      table(managerPayments.map(p => ({
        payment_id: p.payment_id,
        status: p.status,
        amount: dollars(p.amount_money_amount),
        tip: dollars(p.tip_money_amount),
        total: dollars(p.total_money_amount),
        created: p.created_at ? new Date(p.created_at).toISOString() : '',
        source: p.source_type || '',
        event: p.event_type || '',
      })));
    } else {
      console.log('  No payments found for Manager Zorina');
    }
  } else {
    if (!managerZorina) console.log('  Manager Zorina NOT FOUND');
    if (!ianaZorina) console.log('  Iana Zorina NOT FOUND (cannot check linkage)');
  }

  // =========================================================================
  // 6. GAP ANALYSIS
  // =========================================================================
  banner('6. GAP ANALYSIS: WHO SHOULD HAVE REWARDS BUT DIDN\'T?');

  // 6a: Referred customers with NO FRIEND_SIGNUP_BONUS gift card
  console.log('\n  --- 6a. Referred customers with NO friend_signup_bonus gift card ---');
  const missingFriendGC = await prisma.$queryRaw`
    SELECT sec.square_customer_id, sec.given_name, sec.family_name,
           sec.used_referral_code, sec.got_signup_bonus, sec.email_address
    FROM square_existing_clients sec
    WHERE sec.organization_id = ${ORG_ID}::uuid
      AND sec.used_referral_code IS NOT NULL
      AND sec.used_referral_code != ''
      AND NOT EXISTS (
        SELECT 1 FROM gift_cards gc
        WHERE gc.organization_id = ${ORG_ID}::uuid
          AND gc.square_customer_id = sec.square_customer_id
          AND gc.reward_type = 'FRIEND_SIGNUP_BONUS'
      )
    ORDER BY sec.created_at DESC
  `;
  console.log(`  Count: ${missingFriendGC.length}`);
  if (missingFriendGC.length > 0) {
    table(missingFriendGC.map(c => ({
      name: `${c.given_name || ''} ${c.family_name || ''}`.trim(),
      customer_id: c.square_customer_id,
      used_code: c.used_referral_code,
      got_signup_bonus_flag: c.got_signup_bonus,
      email: c.email_address || '',
    })));
  }

  // 6b: Referrers missing referrer_reward where referred customer has first_payment_completed=true
  console.log('\n  --- 6b. Referrers MISSING referrer_reward (referred customer paid) ---');
  const missingReferrerRewards = await prisma.$queryRaw`
    SELECT
      referrer.square_customer_id as referrer_customer_id,
      referrer.given_name as referrer_given_name,
      referrer.family_name as referrer_family_name,
      referred.square_customer_id as referred_customer_id,
      referred.given_name as referred_given_name,
      referred.family_name as referred_family_name,
      referred.used_referral_code,
      referred.first_payment_completed
    FROM square_existing_clients referred
    JOIN square_existing_clients referrer
      ON referrer.organization_id = ${ORG_ID}::uuid
      AND referrer.referral_code = referred.used_referral_code
    WHERE referred.organization_id = ${ORG_ID}::uuid
      AND referred.used_referral_code IS NOT NULL
      AND referred.used_referral_code != ''
      AND referred.first_payment_completed = true
      AND NOT EXISTS (
        SELECT 1 FROM referral_rewards rr
        WHERE rr.organization_id = ${ORG_ID}::uuid
          AND rr.referred_customer_id = referred.square_customer_id
          AND rr.reward_type = 'referrer_reward'
      )
    ORDER BY referred.family_name
  `;
  console.log(`  Count: ${missingReferrerRewards.length}`);
  if (missingReferrerRewards.length > 0) {
    table(missingReferrerRewards.map(r => ({
      referrer: `${r.referrer_given_name || ''} ${r.referrer_family_name || ''}`.trim(),
      referrer_id: r.referrer_customer_id,
      referred: `${r.referred_given_name || ''} ${r.referred_family_name || ''}`.trim(),
      referred_id: r.referred_customer_id,
      used_code: r.used_referral_code,
    })));
  }

  banner('AUDIT COMPLETE');
}

main()
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
