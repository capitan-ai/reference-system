/**
 * Backfill: Create missing friend_signup_bonus reward records
 * and fix PENDING referrer rewards that have active gift cards
 */

require('dotenv').config({ path: '.env.local' })
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function backfill() {
  console.log('=== BACKFILL: friend_signup_bonus rewards + fix PENDING ===\n')

  // 1. Find FRIEND_SIGNUP_BONUS gift cards without reward records
  const missingRewards = await prisma.$queryRaw`
    SELECT
      gc.id as gift_card_db_id,
      gc.square_gift_card_id,
      gc.square_customer_id,
      gc.initial_amount_cents,
      gc.current_balance_cents,
      gc.organization_id,
      gc.created_at,
      sec.given_name,
      sec.family_name,
      sec.used_referral_code
    FROM gift_cards gc
    JOIN square_existing_clients sec
      ON sec.square_customer_id = gc.square_customer_id
      AND sec.organization_id = gc.organization_id
    LEFT JOIN referral_rewards rr
      ON rr.referred_customer_id = gc.square_customer_id
      AND rr.organization_id = gc.organization_id
      AND rr.reward_type = 'friend_signup_bonus'
    WHERE gc.reward_type = 'FRIEND_SIGNUP_BONUS'
      AND gc.initial_amount_cents > 0
      AND rr.id IS NULL
    ORDER BY gc.created_at DESC
  `

  console.log(`Missing friend_signup_bonus records (with loaded gift cards): ${missingRewards.length}\n`)

  let created = 0
  for (const gc of missingRewards) {
    // Find referrer by code
    let referrerId = null
    if (gc.used_referral_code) {
      const referrer = await prisma.$queryRaw`
        SELECT rp.square_customer_id
        FROM referral_profiles rp
        WHERE rp.organization_id = ${gc.organization_id}::uuid
          AND (LOWER(COALESCE(rp.personal_code, '')) = LOWER(${gc.used_referral_code})
               OR LOWER(COALESCE(rp.referral_code, '')) = LOWER(${gc.used_referral_code}))
          AND rp.square_customer_id <> ${gc.square_customer_id}
        LIMIT 1
      `
      if (referrer.length > 0) {
        referrerId = referrer[0].square_customer_id
      } else {
        const secReferrer = await prisma.$queryRaw`
          SELECT sec.square_customer_id
          FROM square_existing_clients sec
          WHERE sec.organization_id = ${gc.organization_id}::uuid
            AND LOWER(COALESCE(sec.personal_code, '')) = LOWER(${gc.used_referral_code})
            AND sec.square_customer_id <> ${gc.square_customer_id}
          LIMIT 1
        `
        if (secReferrer.length > 0) {
          referrerId = secReferrer[0].square_customer_id
        }
      }
    }

    if (!referrerId) {
      console.log(`  SKIP ${gc.given_name} ${gc.family_name} — no referrer found for code ${gc.used_referral_code}`)
      continue
    }

    try {
      await prisma.referralReward.create({
        data: {
          organization_id: gc.organization_id,
          referrer_customer_id: referrerId,
          referred_customer_id: gc.square_customer_id,
          reward_amount_cents: gc.initial_amount_cents,
          status: 'PAID',
          gift_card_id: gc.gift_card_db_id,
          reward_type: 'friend_signup_bonus',
          paid_at: gc.created_at,
          metadata: {
            source: 'backfill',
            gift_card_square_id: gc.square_gift_card_id
          }
        }
      })
      created++
      console.log(`  ✅ ${gc.given_name} ${gc.family_name} | referrer: ${referrerId} | $${gc.initial_amount_cents / 100}`)
    } catch (err) {
      if (err.code === 'P2002') {
        console.log(`  SKIP ${gc.given_name} ${gc.family_name} — already exists (unique constraint)`)
      } else {
        console.log(`  ❌ ${gc.given_name} ${gc.family_name} — ${err.message}`)
      }
    }
  }
  console.log(`\nCreated ${created} friend_signup_bonus records\n`)

  // 2. Fix PENDING referrer rewards where gift card exists
  console.log('=== FIX PENDING REWARDS ===\n')

  const pendingRewards = await prisma.$queryRaw`
    SELECT
      rr.id,
      rr.referrer_customer_id,
      rr.referred_customer_id,
      rr.organization_id,
      rr.reward_amount_cents,
      gc.id as gift_card_db_id,
      gc.square_gift_card_id,
      gc.current_balance_cents,
      sec.given_name as referrer_name,
      sec.family_name as referrer_family
    FROM referral_rewards rr
    LEFT JOIN gift_cards gc
      ON gc.square_customer_id = rr.referrer_customer_id
      AND gc.organization_id = rr.organization_id
      AND gc.reward_type = 'REFERRER_REWARD'
    LEFT JOIN square_existing_clients sec
      ON sec.square_customer_id = rr.referrer_customer_id
      AND sec.organization_id = rr.organization_id
    WHERE rr.status = 'PENDING'
  `

  console.log(`PENDING rewards: ${pendingRewards.length}`)

  for (const rw of pendingRewards) {
    if (rw.gift_card_db_id) {
      // Gift card exists — reward should be PAID
      await prisma.referralReward.update({
        where: { id: rw.id },
        data: {
          status: 'PAID',
          gift_card_id: rw.gift_card_db_id,
          paid_at: new Date(),
          metadata: {
            source: 'backfill_pending_to_paid',
            gift_card_square_id: rw.square_gift_card_id
          }
        }
      })
      console.log(`  ✅ PAID: ${rw.referrer_name} ${rw.referrer_family} | GC balance: $${(rw.current_balance_cents || 0) / 100}`)
    } else {
      console.log(`  ⚠️  STILL PENDING: ${rw.referrer_name} ${rw.referrer_family} — no gift card found`)
    }
  }

  // 3. Update GAN in gift_cards where missing
  console.log('\n=== UPDATE MISSING GANs ===\n')
  const missingGans = await prisma.$queryRaw`
    UPDATE gift_cards gc
    SET gift_card_gan = sec.gift_card_gan
    FROM square_existing_clients sec
    WHERE sec.square_customer_id = gc.square_customer_id
      AND sec.organization_id = gc.organization_id
      AND gc.gift_card_gan IS NULL
      AND sec.gift_card_gan IS NOT NULL
      AND gc.square_gift_card_id = sec.gift_card_id
    RETURNING gc.square_customer_id, gc.gift_card_gan
  `
  console.log(`Updated ${missingGans.length} GANs from square_existing_clients`)

  await prisma.$disconnect()
  console.log('\nDone!')
}

backfill().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
