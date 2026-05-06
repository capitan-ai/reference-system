/**
 * Audit: Classify all PENDING $0 REFERRER_REWARD gift cards.
 *
 * For each stuck placeholder card, decide whether it represents:
 *   - REAL_REFERRAL_REWARD_RECORD_BUT_NO_GC: there is a paid referral_rewards row
 *     but the gift card was never funded (highest priority — we owe money)
 *   - REAL_REFERRAL_UNFUNDED: a friend used the code and paid, but no rewards row exists
 *   - FRIEND_USED_CODE_BUT_NEVER_PAID: someone typed the code but never completed a payment
 *   - SELF_REFERRAL: friend === referrer (excluded by design)
 *   - PHANTOM_SHELL: nobody ever used this code (the common case — placeholder is fine PENDING)
 *
 * READ-ONLY. No DB writes, no Square API mutations.
 *
 * Usage: node scripts/audit-stuck-referrer-cards.js
 */
require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

const prisma = new PrismaClient()

const BUCKETS = {
  REAL_REFERRAL_REWARD_RECORD_BUT_NO_GC: 'REAL_REFERRAL_REWARD_RECORD_BUT_NO_GC',
  REAL_REFERRAL_UNFUNDED: 'REAL_REFERRAL_UNFUNDED',
  FRIEND_USED_CODE_BUT_NEVER_PAID: 'FRIEND_USED_CODE_BUT_NEVER_PAID',
  SELF_REFERRAL: 'SELF_REFERRAL',
  PHANTOM_SHELL: 'PHANTOM_SHELL',
}

function dollars(cents) {
  return '$' + (Number(cents || 0) / 100).toFixed(2)
}

function name(p) {
  return `${p?.given_name || ''} ${p?.family_name || ''}`.trim() || '(unknown)'
}

async function loadStuckCards() {
  return prisma.$queryRaw`
    SELECT gc.id            AS gc_db_id,
           gc.square_gift_card_id,
           gc.gift_card_gan,
           gc.square_customer_id AS owner_customer_id,
           gc.organization_id,
           gc.created_at      AS gc_created_at,
           gc.state           AS gc_state,
           gc.current_balance_cents,
           gc.initial_amount_cents
    FROM gift_cards gc
    WHERE gc.reward_type = 'REFERRER_REWARD'
      AND gc.state = 'PENDING'
      AND gc.current_balance_cents = 0
    ORDER BY gc.created_at ASC
  `
}

async function loadCustomerInfo(customerIds, organizationId) {
  if (customerIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw`
    SELECT sec.square_customer_id, sec.given_name, sec.family_name,
           sec.email_address, sec.phone_number,
           sec.personal_code, sec.used_referral_code,
           sec.first_payment_completed, sec.organization_id,
           rp.personal_code  AS rp_personal_code,
           rp.referral_code  AS rp_referral_code
    FROM square_existing_clients sec
    LEFT JOIN referral_profiles rp
      ON rp.square_customer_id = sec.square_customer_id
     AND rp.organization_id   = sec.organization_id
    WHERE sec.organization_id = ${organizationId}::uuid
      AND sec.square_customer_id = ANY(${customerIds}::text[])
  `
  const map = new Map()
  for (const r of rows) map.set(r.square_customer_id, r)
  return map
}

async function loadFriendsUsingCode(personalCode, referralCode, organizationId) {
  const codes = [personalCode, referralCode].filter(Boolean).map((c) => c.toUpperCase())
  if (codes.length === 0) return []
  return prisma.$queryRaw`
    SELECT sec.square_customer_id, sec.given_name, sec.family_name,
           sec.email_address, sec.phone_number,
           sec.used_referral_code, sec.first_payment_completed,
           sec.created_at AS customer_created_at
    FROM square_existing_clients sec
    WHERE sec.organization_id = ${organizationId}::uuid
      AND UPPER(TRIM(sec.used_referral_code)) = ANY(${codes}::text[])
  `
}

async function loadCompletedPayments(customerIds) {
  if (customerIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw`
    SELECT customer_id, payment_id, total_money_amount, created_at
    FROM payments
    WHERE customer_id = ANY(${customerIds}::text[])
      AND status = 'COMPLETED'
    ORDER BY created_at ASC
  `
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.customer_id)) map.set(r.customer_id, [])
    map.get(r.customer_id).push(r)
  }
  return map
}

async function loadRewardRecords(referrerIds, organizationId) {
  if (referrerIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw`
    SELECT rr.id, rr.referrer_customer_id, rr.referred_customer_id,
           rr.status, rr.reward_amount_cents, rr.reward_type,
           rr.gift_card_id, rr.metadata, rr.created_at, rr.paid_at,
           gc.state AS linked_gc_state, gc.current_balance_cents AS linked_gc_balance
    FROM referral_rewards rr
    LEFT JOIN gift_cards gc ON gc.id = rr.gift_card_id
    WHERE rr.organization_id = ${organizationId}::uuid
      AND rr.reward_type = 'referrer_reward'
      AND rr.referrer_customer_id = ANY(${referrerIds}::text[])
  `
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.referrer_customer_id)) map.set(r.referrer_customer_id, [])
    map.get(r.referrer_customer_id).push(r)
  }
  return map
}

function isSelfReferral(referrer, friend) {
  if (!referrer || !friend) return false
  if (referrer.square_customer_id === friend.square_customer_id) return true
  const refEmail = (referrer.email_address || '').toLowerCase().trim()
  const friendEmail = (friend.email_address || '').toLowerCase().trim()
  if (refEmail && friendEmail && refEmail === friendEmail) return true
  const refPhone = (referrer.phone_number || '').replace(/\D/g, '')
  const friendPhone = (friend.phone_number || '').replace(/\D/g, '')
  if (refPhone && friendPhone && refPhone.slice(-10) === friendPhone.slice(-10)) return true
  return false
}

async function main() {
  console.log('Loading stuck PENDING $0 REFERRER_REWARD gift cards...')
  const cards = await loadStuckCards()
  console.log(`Found ${cards.length} cards.\n`)

  const orgIds = [...new Set(cards.map((c) => c.organization_id).filter(Boolean))]
  console.log(`Spans ${orgIds.length} organization(s).\n`)

  const results = []
  let processed = 0

  for (const orgId of orgIds) {
    const orgCards = cards.filter((c) => c.organization_id === orgId)
    const ownerIds = [...new Set(orgCards.map((c) => c.owner_customer_id).filter(Boolean))]
    const owners = await loadCustomerInfo(ownerIds, orgId)
    const rewardsByReferrer = await loadRewardRecords(ownerIds, orgId)

    for (const card of orgCards) {
      processed += 1
      if (processed % 50 === 0) console.log(`  ...processed ${processed}/${cards.length}`)

      const owner = owners.get(card.owner_customer_id)
      const personalCode = owner?.personal_code || owner?.rp_personal_code || null
      const referralCode = owner?.rp_referral_code || null

      const friends = await loadFriendsUsingCode(personalCode, referralCode, orgId)
      const friendIds = friends.map((f) => f.square_customer_id)
      const paymentsByFriend = await loadCompletedPayments(friendIds)
      const rewardRecords = rewardsByReferrer.get(card.owner_customer_id) || []

      const enrichedFriends = friends.map((f) => ({
        ...f,
        completed_payments: paymentsByFriend.get(f.square_customer_id) || [],
        is_self_referral: isSelfReferral(owner, f),
      }))

      const realFriends = enrichedFriends.filter(
        (f) => !f.is_self_referral && f.completed_payments.length > 0
      )
      const friendsUsedButNotPaid = enrichedFriends.filter(
        (f) => !f.is_self_referral && f.completed_payments.length === 0
      )
      const selfReferrals = enrichedFriends.filter((f) => f.is_self_referral)

      let bucket
      if (realFriends.length > 0) {
        const realFriendIds = new Set(realFriends.map((f) => f.square_customer_id))
        const matchingReward = rewardRecords.find((rr) => realFriendIds.has(rr.referred_customer_id))
        if (
          matchingReward &&
          matchingReward.status === 'PAID' &&
          (matchingReward.gift_card_id === null ||
            matchingReward.linked_gc_state === 'PENDING' ||
            (matchingReward.linked_gc_balance ?? 0) === 0)
        ) {
          bucket = BUCKETS.REAL_REFERRAL_REWARD_RECORD_BUT_NO_GC
        } else {
          bucket = BUCKETS.REAL_REFERRAL_UNFUNDED
        }
      } else if (friendsUsedButNotPaid.length > 0) {
        bucket = BUCKETS.FRIEND_USED_CODE_BUT_NEVER_PAID
      } else if (selfReferrals.length > 0 && enrichedFriends.length === selfReferrals.length) {
        bucket = BUCKETS.SELF_REFERRAL
      } else {
        bucket = BUCKETS.PHANTOM_SHELL
      }

      results.push({
        bucket,
        gc_db_id: card.gc_db_id,
        square_gift_card_id: card.square_gift_card_id,
        gift_card_gan: card.gift_card_gan,
        gc_created_at: card.gc_created_at,
        organization_id: orgId,
        referrer: owner
          ? {
              square_customer_id: owner.square_customer_id,
              name: name(owner),
              email: owner.email_address,
              personal_code: personalCode,
              referral_code: referralCode,
            }
          : null,
        friends_using_code: enrichedFriends.map((f) => ({
          square_customer_id: f.square_customer_id,
          name: name(f),
          email: f.email_address,
          first_payment_completed: f.first_payment_completed,
          completed_payment_count: f.completed_payments.length,
          first_completed_payment_at: f.completed_payments[0]?.created_at || null,
          is_self_referral: f.is_self_referral,
        })),
        reward_records: rewardRecords.map((rr) => ({
          id: rr.id,
          referred_customer_id: rr.referred_customer_id,
          status: rr.status,
          gift_card_id: rr.gift_card_id,
          linked_gc_state: rr.linked_gc_state,
          linked_gc_balance_cents: rr.linked_gc_balance,
          backfilled: rr.metadata?.backfilled === true,
          created_at: rr.created_at,
        })),
      })
    }
  }

  const counts = {}
  for (const r of results) counts[r.bucket] = (counts[r.bucket] || 0) + 1

  console.log('\n=== Bucket counts ===')
  for (const b of Object.values(BUCKETS)) {
    console.log(`  ${b.padEnd(40)}  ${counts[b] || 0}`)
  }
  console.log(`  ${'TOTAL'.padEnd(40)}  ${results.length}`)

  const priority = results.filter((r) => r.bucket === BUCKETS.REAL_REFERRAL_REWARD_RECORD_BUT_NO_GC)
  if (priority.length > 0) {
    console.log(`\n=== Priority shortlist: ${priority.length} cards owe a real reward ===`)
    for (const r of priority) {
      const friend = r.friends_using_code.find((f) => f.completed_payment_count > 0)
      console.log(
        `  GAN ${r.gift_card_gan || '(none)'} | referrer: ${r.referrer?.name} | friend: ${friend?.name} | first paid: ${friend?.first_completed_payment_at?.toISOString?.() || friend?.first_completed_payment_at}`
      )
    }
  }

  const realUnfunded = results.filter((r) => r.bucket === BUCKETS.REAL_REFERRAL_UNFUNDED)
  if (realUnfunded.length > 0) {
    console.log(`\n=== Real referrals with NO reward record at all: ${realUnfunded.length} ===`)
    for (const r of realUnfunded.slice(0, 20)) {
      const friend = r.friends_using_code.find((f) => f.completed_payment_count > 0)
      console.log(
        `  GAN ${r.gift_card_gan || '(none)'} | referrer: ${r.referrer?.name} | friend: ${friend?.name} | first paid: ${friend?.first_completed_payment_at?.toISOString?.() || friend?.first_completed_payment_at}`
      )
    }
    if (realUnfunded.length > 20) console.log(`  ... and ${realUnfunded.length - 20} more`)
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = `/tmp/stuck-cards-audit-${ts}.json`
  fs.writeFileSync(outPath, JSON.stringify({ counts, results }, null, 2))
  console.log(`\nFull results written to: ${outPath}`)

  // Cross-check: confirm Alex's card lands in the priority bucket
  const ALEX_GC_ID = 'gftc:3b0621d6a5e24269aee6084c78542e8a'
  const alex = results.find((r) => r.square_gift_card_id === ALEX_GC_ID)
  if (alex) {
    console.log(`\nSanity check (Alex's card): bucket = ${alex.bucket}`)
  } else {
    console.log(`\nSanity check: Alex's card not in result set (was it activated?)`)
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('Error:', err.message)
    console.error(err.stack)
    await prisma.$disconnect()
    process.exit(1)
  })
