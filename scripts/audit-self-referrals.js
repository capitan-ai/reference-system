/**
 * Audit: Find self-referrals and check referrer name resolution
 *
 * 1. Find customers who used their OWN referral code and got $10
 * 2. Find new customers where referrer name can't be resolved (shows "—" in dashboard)
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function audit() {
  console.log('=== SELF-REFERRAL AUDIT ===\n')

  // 1. Find self-referrals in referral_rewards (referrer === referred)
  const selfReferralRewards = await prisma.$queryRaw`
    SELECT
      rr.id,
      rr.referrer_customer_id,
      rr.referred_customer_id,
      rr.reward_amount_cents,
      rr.reward_type,
      rr.status,
      rr.created_at,
      sec_referrer.given_name as referrer_given_name,
      sec_referrer.family_name as referrer_family_name,
      sec_referrer.personal_code as referrer_code
    FROM referral_rewards rr
    LEFT JOIN square_existing_clients sec_referrer
      ON sec_referrer.square_customer_id = rr.referrer_customer_id
      AND sec_referrer.organization_id = rr.organization_id
    WHERE rr.referrer_customer_id = rr.referred_customer_id
    ORDER BY rr.created_at DESC
  `

  console.log(`Self-referral rewards (referrer === referred): ${selfReferralRewards.length}`)
  for (const r of selfReferralRewards) {
    console.log(`  - ${r.referrer_given_name} ${r.referrer_family_name} (${r.referrer_code}) | $${r.reward_amount_cents / 100} | ${r.reward_type} | ${r.status} | ${r.created_at}`)
  }

  // 2. Find customers who used a code that belongs to themselves (code owner === customer)
  const selfCodeUsage = await prisma.$queryRaw`
    SELECT
      sec.square_customer_id,
      sec.given_name,
      sec.family_name,
      sec.used_referral_code,
      sec.personal_code,
      sec.got_signup_bonus,
      sec.first_payment_completed,
      rp.personal_code as rp_personal_code,
      rp.referral_code as rp_referral_code
    FROM square_existing_clients sec
    LEFT JOIN referral_profiles rp
      ON rp.square_customer_id = sec.square_customer_id
      AND rp.organization_id = sec.organization_id
    WHERE sec.used_referral_code IS NOT NULL
      AND (
        LOWER(COALESCE(sec.personal_code, '')) = LOWER(sec.used_referral_code)
        OR LOWER(COALESCE(rp.personal_code, '')) = LOWER(sec.used_referral_code)
        OR LOWER(COALESCE(rp.referral_code, '')) = LOWER(sec.used_referral_code)
      )
    ORDER BY sec.given_name
  `

  console.log(`\nCustomers who used their OWN code: ${selfCodeUsage.length}`)
  for (const c of selfCodeUsage) {
    console.log(`  - ${c.given_name} ${c.family_name} | used: ${c.used_referral_code} | own: ${c.personal_code || c.rp_personal_code} | bonus: ${c.got_signup_bonus} | paid: ${c.first_payment_completed}`)
  }

  // 3. Check if any self-referrers got $10 friend_signup_bonus
  const selfBonuses = await prisma.$queryRaw`
    SELECT
      rr.id,
      rr.referrer_customer_id,
      rr.referred_customer_id,
      rr.reward_amount_cents,
      rr.reward_type,
      rr.status,
      rr.created_at,
      sec.given_name,
      sec.family_name,
      sec.used_referral_code,
      sec.personal_code
    FROM referral_rewards rr
    JOIN square_existing_clients sec
      ON sec.square_customer_id = rr.referred_customer_id
      AND sec.organization_id = rr.organization_id
    WHERE rr.reward_type = 'friend_signup_bonus'
      AND (
        LOWER(COALESCE(sec.personal_code, '')) = LOWER(sec.used_referral_code)
        OR EXISTS (
          SELECT 1 FROM referral_profiles rp
          WHERE rp.square_customer_id = rr.referred_customer_id
            AND rp.organization_id = rr.organization_id
            AND (LOWER(COALESCE(rp.personal_code, '')) = LOWER(sec.used_referral_code)
                 OR LOWER(COALESCE(rp.referral_code, '')) = LOWER(sec.used_referral_code))
        )
      )
    ORDER BY rr.created_at DESC
  `

  console.log(`\nSelf-referral friend_signup_bonuses: ${selfBonuses.length}`)
  for (const b of selfBonuses) {
    console.log(`  - ${b.given_name} ${b.family_name} | code: ${b.used_referral_code} | own: ${b.personal_code} | $${b.reward_amount_cents / 100} | ${b.status} | ${b.created_at}`)
  }

  // 4. Total money lost to self-referrals
  const totalSelfReferralMoney = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int as total_count,
      COALESCE(SUM(rr.reward_amount_cents), 0)::int as total_cents
    FROM referral_rewards rr
    WHERE rr.referrer_customer_id = rr.referred_customer_id
      AND rr.status = 'PAID'
  `

  console.log(`\n=== TOTAL SELF-REFERRAL PAYOUTS ===`)
  console.log(`  Count: ${totalSelfReferralMoney[0]?.total_count || 0}`)
  console.log(`  Amount: $${((totalSelfReferralMoney[0]?.total_cents || 0) / 100).toFixed(2)}`)

  // 5. Check referrer name resolution for new customers
  console.log('\n=== MISSING REFERRER NAMES ===\n')

  const missingReferrerNames = await prisma.$queryRaw`
    SELECT
      sec.given_name as customer_name,
      sec.family_name as customer_family,
      sec.used_referral_code,
      sec_owner.square_customer_id as referrer_id_from_sec,
      TRIM(COALESCE(sec_owner.given_name, '') || ' ' || COALESCE(sec_owner.family_name, '')) as referrer_name_sec,
      rp_owner.square_customer_id as referrer_id_from_rp
    FROM square_existing_clients sec
    LEFT JOIN square_existing_clients sec_owner
      ON sec_owner.organization_id = sec.organization_id
      AND LOWER(COALESCE(sec_owner.personal_code, '')) = LOWER(sec.used_referral_code)
      AND sec_owner.square_customer_id <> sec.square_customer_id
    LEFT JOIN referral_profiles rp_owner
      ON rp_owner.organization_id = sec.organization_id
      AND (LOWER(COALESCE(rp_owner.personal_code, '')) = LOWER(sec.used_referral_code)
           OR LOWER(COALESCE(rp_owner.referral_code, '')) = LOWER(sec.used_referral_code))
      AND rp_owner.square_customer_id <> sec.square_customer_id
    WHERE sec.used_referral_code IS NOT NULL
      AND sec_owner.square_customer_id IS NULL
      AND rp_owner.square_customer_id IS NULL
    ORDER BY sec.given_name
  `

  console.log(`Customers with unresolvable referrer (code owner not found): ${missingReferrerNames.length}`)
  for (const m of missingReferrerNames) {
    console.log(`  - ${m.customer_name} ${m.customer_family} | code: ${m.used_referral_code} | referrer: NOT FOUND`)
  }

  await prisma.$disconnect()
}

audit().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
