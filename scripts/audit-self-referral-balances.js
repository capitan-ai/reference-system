/**
 * Audit: Check actual gift card balances for self-referral customers
 * Uses Square API to get real-time balances and full activity history
 */

// Load .env.local first (for DATABASE_URL etc), then .env
// dotenv won't override already-set vars, so order matters
require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })
// .env.local token lacks Gift Card API permissions — force use .env token
const dotenv = require('dotenv')
const envFile = dotenv.config({ path: '.env' })
if (envFile.parsed?.SQUARE_ACCESS_TOKEN) {
  process.env.SQUARE_ACCESS_TOKEN = envFile.parsed.SQUARE_ACCESS_TOKEN
}
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

function getSquareClient() {
  let accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (accessToken && accessToken.startsWith('Bearer ')) {
    accessToken = accessToken.slice(7)
  }
  console.log(`Square token: ${accessToken?.substring(0, 8)}... (${accessToken?.length} chars)\n`)
  return new Client({
    accessToken,
    environment: Environment.Production,
  })
}

async function getSquareBalance(giftCardsApi, giftCardActivitiesApi, squareGiftCardId) {
  try {
    const { result } = await giftCardsApi.retrieveGiftCard(squareGiftCardId)
    const gc = result.giftCard
    const balanceCents = Number(gc.balanceMoney?.amount || 0)

    // Get activities
    const activitiesResult = await giftCardActivitiesApi.listGiftCardActivities(squareGiftCardId)
    const activities = (activitiesResult.result.giftCardActivities || [])
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

    let totalLoaded = 0
    let totalRedeemed = 0
    let totalRefunded = 0
    const activityLog = []

    for (const act of activities) {
      const balAfter = Number(act.giftCardBalanceMoney?.amount || 0)
      const date = act.createdAt?.split('T')[0] || '—'
      const type = act.type

      if (type === 'ACTIVATE' || type === 'LOAD') {
        const amt = Number(act.activateActivityDetails?.amountMoney?.amount || act.loadActivityDetails?.amountMoney?.amount || 0)
        totalLoaded += amt
        activityLog.push(`        ${date} | ${type.padEnd(18)} | +$${(amt / 100).toFixed(2).padEnd(7)} | bal: $${(balAfter / 100).toFixed(2)}`)
      } else if (type === 'REDEEM') {
        const amt = Number(act.redeemActivityDetails?.amountMoney?.amount || 0)
        totalRedeemed += amt
        const paymentId = act.redeemActivityDetails?.paymentId || ''
        const paySuffix = paymentId ? ` | pay: ...${paymentId.slice(-6)}` : ''
        activityLog.push(`        ${date} | ${type.padEnd(18)} | -$${(amt / 100).toFixed(2).padEnd(7)} | bal: $${(balAfter / 100).toFixed(2)}${paySuffix}`)
      } else if (type === 'REFUND') {
        const amt = Number(act.refundActivityDetails?.amountMoney?.amount || 0)
        totalRefunded += amt
        activityLog.push(`        ${date} | ${type.padEnd(18)} | +$${(amt / 100).toFixed(2).padEnd(7)} (refund) | bal: $${(balAfter / 100).toFixed(2)}`)
      } else if (type === 'ADJUST_INCREMENT') {
        const amt = Number(act.adjustIncrementActivityDetails?.amountMoney?.amount || 0)
        totalLoaded += amt
        activityLog.push(`        ${date} | ${type.padEnd(18)} | +$${(amt / 100).toFixed(2).padEnd(7)} | bal: $${(balAfter / 100).toFixed(2)}`)
      } else if (type === 'ADJUST_DECREMENT') {
        const amt = Number(act.adjustDecrementActivityDetails?.amountMoney?.amount || 0)
        totalRedeemed += amt
        activityLog.push(`        ${date} | ${type.padEnd(18)} | -$${(amt / 100).toFixed(2).padEnd(7)} | bal: $${(balAfter / 100).toFixed(2)}`)
      } else {
        activityLog.push(`        ${date} | ${type.padEnd(18)} | bal: $${(balAfter / 100).toFixed(2)}`)
      }
    }

    return {
      balanceCents,
      state: gc.state,
      gan: gc.gan,
      totalLoaded,
      totalRedeemed,
      totalRefunded,
      activityLog,
      activityCount: activities.length
    }
  } catch (err) {
    return { error: err.message }
  }
}

async function audit() {
  const squareClient = getSquareClient()
  const giftCardsApi = squareClient.giftCardsApi
  const giftCardActivitiesApi = squareClient.giftCardActivitiesApi

  console.log('=== SELF-REFERRAL GIFT CARD BALANCE AUDIT (Square API) ===\n')

  const selfReferrals = await prisma.$queryRaw`
    SELECT
      sec.square_customer_id,
      sec.given_name,
      sec.family_name,
      sec.used_referral_code,
      sec.personal_code,
      sec.got_signup_bonus,
      sec.first_payment_completed,
      sec.gift_card_id AS friend_gift_card_sq_id,
      sec.gift_card_gan AS friend_gift_card_gan,
      sec.activated_as_referrer,
      sec.total_rewards,
      rp.personal_code AS rp_personal_code,
      rp.referral_code AS rp_referral_code
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

  console.log(`Found ${selfReferrals.length} self-referral customers\n`)

  let grandTotalLoaded = 0
  let grandTotalRedeemed = 0
  let grandTotalRefunded = 0
  let grandTotalBalance = 0

  for (const customer of selfReferrals) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`👤 ${customer.given_name} ${customer.family_name}`)
    console.log(`   Square ID: ${customer.square_customer_id}`)
    console.log(`   Used code: ${customer.used_referral_code} | Own code: ${customer.personal_code || customer.rp_personal_code || '—'}`)
    console.log(`   Signup bonus: ${customer.got_signup_bonus} | First payment: ${customer.first_payment_completed} | Referrer: ${customer.activated_as_referrer}`)

    // Collect all Square gift card IDs for this customer
    const allGiftCardIds = new Set()

    // From square_existing_clients
    if (customer.friend_gift_card_sq_id) {
      allGiftCardIds.add(customer.friend_gift_card_sq_id)
    }

    // From gift_cards table
    const dbGiftCards = await prisma.$queryRaw`
      SELECT square_gift_card_id, reward_type, initial_amount_cents, current_balance_cents
      FROM gift_cards
      WHERE square_customer_id = ${customer.square_customer_id}
    `
    for (const gc of dbGiftCards) {
      allGiftCardIds.add(gc.square_gift_card_id)
    }

    // From referral_rewards (referrer gift card)
    const referrerRewards = await prisma.$queryRaw`
      SELECT DISTINCT gc.square_gift_card_id
      FROM referral_rewards rr
      JOIN gift_cards gc ON gc.square_customer_id = rr.referrer_customer_id
        AND gc.organization_id = rr.organization_id
        AND gc.reward_type = 'REFERRER_REWARD'
      WHERE rr.referrer_customer_id = ${customer.square_customer_id}
    `
    for (const rw of referrerRewards) {
      allGiftCardIds.add(rw.square_gift_card_id)
    }

    console.log(`\n   Found ${allGiftCardIds.size} gift card(s) to check via Square API:`)

    for (const gcId of allGiftCardIds) {
      const dbInfo = dbGiftCards.find(g => g.square_gift_card_id === gcId)
      const typeLabel = dbInfo?.reward_type === 'REFERRER_REWARD' ? '🏆 REFERRER REWARD' : '🎁 FRIEND SIGNUP BONUS'

      console.log(`\n   ${typeLabel} — ${gcId}`)
      if (dbInfo) {
        console.log(`      DB: initial=$${((dbInfo.initial_amount_cents || 0) / 100).toFixed(2)} | current=$${((dbInfo.current_balance_cents || 0) / 100).toFixed(2)}`)
      }

      const sq = await getSquareBalance(giftCardsApi, giftCardActivitiesApi, gcId)

      if (sq.error) {
        console.log(`      ❌ Square API error: ${sq.error}`)
        // Fallback to DB data
        if (dbInfo) {
          grandTotalBalance += (dbInfo.current_balance_cents || 0)
          grandTotalLoaded += (dbInfo.initial_amount_cents || 0)
        }
        continue
      }

      console.log(`      Square: balance=$${(sq.balanceCents / 100).toFixed(2)} | state=${sq.state} | GAN=...${(sq.gan || '').slice(-4)}`)
      console.log(`      Loaded: $${(sq.totalLoaded / 100).toFixed(2)} | Redeemed: $${(sq.totalRedeemed / 100).toFixed(2)} | Refunded: $${(sq.totalRefunded / 100).toFixed(2)}`)

      if (sq.activityLog.length > 0) {
        console.log(`      Activities (${sq.activityCount}):`)
        for (const line of sq.activityLog) {
          console.log(line)
        }
      }

      grandTotalLoaded += sq.totalLoaded
      grandTotalRedeemed += sq.totalRedeemed
      grandTotalRefunded += sq.totalRefunded
      grandTotalBalance += sq.balanceCents
    }

    // Reward records
    const rewards = await prisma.$queryRaw`
      SELECT
        rr.reward_type, rr.reward_amount_cents, rr.status, rr.created_at,
        CASE
          WHEN rr.referrer_customer_id = rr.referred_customer_id THEN 'SELF-REF'
          WHEN rr.referrer_customer_id = ${customer.square_customer_id} THEN 'REFERRER'
          WHEN rr.referred_customer_id = ${customer.square_customer_id} THEN 'REFERRED'
          ELSE 'OTHER'
        END AS role
      FROM referral_rewards rr
      WHERE rr.referrer_customer_id = ${customer.square_customer_id}
         OR rr.referred_customer_id = ${customer.square_customer_id}
      ORDER BY rr.created_at
    `
    if (rewards.length > 0) {
      console.log(`\n   📋 Reward records:`)
      for (const rw of rewards) {
        const tag = rw.role === 'SELF-REF' ? ' ⚠️' : ''
        console.log(`      ${rw.role.padEnd(8)} | $${(rw.reward_amount_cents / 100).toFixed(2)} | ${rw.reward_type} | ${rw.status} | ${rw.created_at}${tag}`)
      }
    }

    console.log('')
  }

  // Grand total
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`📊 TOTAL SELF-REFERRAL IMPACT (Square API):`)
  console.log(``)
  console.log(`   Total loaded:              $${(grandTotalLoaded / 100).toFixed(2)}`)
  console.log(`   Total redeemed (spent):    $${(grandTotalRedeemed / 100).toFixed(2)}`)
  console.log(`   Total refunded:            $${(grandTotalRefunded / 100).toFixed(2)}`)
  console.log(`   Current balance:           $${(grandTotalBalance / 100).toFixed(2)}`)
  console.log(``)
  console.log(`   💰 NET COST (loaded - refunded):  $${((grandTotalLoaded - grandTotalRefunded) / 100).toFixed(2)}`)
  console.log(`   💸 ALREADY SPENT (redeemed):       $${(grandTotalRedeemed / 100).toFixed(2)}`)
  console.log(`   💳 CAN RECOVER (current balance):  $${(grandTotalBalance / 100).toFixed(2)}`)

  await prisma.$disconnect()
}

audit().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
