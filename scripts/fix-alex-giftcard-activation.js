/**
 * Fix: Activate Alex Robertson's referrer reward gift card with $10
 *
 * Context: Madison Sarro used Alex's referral code 4D9SOV0B and paid for
 * service on 2026-04-10. The reward record was backfilled as PAID, but the
 * actual Square gift card (created 2026-03-02) was never activated.
 *
 * This script:
 *   1. ACTIVATEs the PENDING Square gift card with $1000 cents (owner-funded)
 *   2. Updates the local gift_cards row (state, balance, initial_amount)
 *   3. Logs an ACTIVATE row in gift_card_transactions
 *   4. Links the gift card to the existing referral_rewards row
 *
 * Run with --dry-run first to preview, then re-run without it to apply.
 */
process.stdout.write('Starting...\n')
require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })
const dotenv = require('dotenv')
const envFile = dotenv.config({ path: '.env' })
if (envFile.parsed?.SQUARE_ACCESS_TOKEN) {
  process.env.SQUARE_ACCESS_TOKEN = envFile.parsed.SQUARE_ACCESS_TOKEN
}
const { PrismaClient } = require('@prisma/client')
const crypto = require('crypto')

const prisma = new PrismaClient()
const SQUARE_API = 'https://connect.squareup.com/v2'

const ALEX_CUSTOMER_ID = 'CZPKQN50QKM2JC7CZWBFMVTMYG'
const ALEX_GIFT_CARD_ID = 'gftc:3b0621d6a5e24269aee6084c78542e8a'
const ALEX_GC_DB_ID = '0b36e1ab-be4c-4799-8169-01abfe80c32c'
const REWARD_ID = '494ef509-e346-476b-84f9-c2ec19fb38a2'
const AMOUNT_CENTS = 1000

const dryRun = process.argv.includes('--dry-run')

async function main() {
  let accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (accessToken?.startsWith('Bearer ')) accessToken = accessToken.slice(7)
  const locationId = process.env.SQUARE_LOCATION_ID?.trim()
  if (!locationId) throw new Error('SQUARE_LOCATION_ID missing')

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-04-17',
  }

  process.stdout.write(`Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}\n`)
  process.stdout.write(`Location: ${locationId}\n\n`)

  process.stdout.write('Step 1/4: Re-check current Square state\n')
  const checkRes = await fetch(`${SQUARE_API}/gift-cards/${encodeURIComponent(ALEX_GIFT_CARD_ID)}`, { headers })
  const checkJson = await checkRes.json()
  const gc = checkJson.gift_card
  process.stdout.write(`  state=${gc.state} balance=$${(Number(gc.balance_money?.amount || 0) / 100).toFixed(2)}\n`)
  if (gc.state !== 'PENDING') {
    process.stdout.write(`  Card is no longer PENDING (state=${gc.state}). Aborting.\n`)
    return
  }
  if (Number(gc.balance_money?.amount || 0) > 0) {
    process.stdout.write(`  Card already has a balance. Aborting.\n`)
    return
  }

  process.stdout.write('\nStep 2/4: ACTIVATE gift card via Square API\n')
  const idempotencyKey = `fix-activate-alex-${REWARD_ID}-${ALEX_GIFT_CARD_ID}`
  const activateBody = {
    idempotency_key: idempotencyKey,
    gift_card_activity: {
      gift_card_id: ALEX_GIFT_CARD_ID,
      type: 'ACTIVATE',
      location_id: locationId,
      activate_activity_details: {
        amount_money: { amount: AMOUNT_CENTS, currency: 'USD' },
        reference_id: 'Referrer reward gift card (manual backfill)',
        buyer_payment_instrument_ids: ['OWNER_FUNDED'],
      },
    },
  }

  if (dryRun) {
    process.stdout.write('  [DRY-RUN] Would POST to /gift-cards/activities:\n')
    process.stdout.write(JSON.stringify(activateBody, null, 2) + '\n')
  } else {
    const actRes = await fetch(`${SQUARE_API}/gift-cards/activities`, {
      method: 'POST',
      headers,
      body: JSON.stringify(activateBody),
    })
    const actJson = await actRes.json()
    if (!actJson.gift_card_activity) {
      process.stdout.write(`  ERROR from Square: ${JSON.stringify(actJson)}\n`)
      throw new Error('Square ACTIVATE failed')
    }
    const activity = actJson.gift_card_activity
    const balanceAfter = Number(activity.gift_card_balance_money?.amount || 0)
    process.stdout.write(`  Activity ID: ${activity.id}\n`)
    process.stdout.write(`  Balance after: $${(balanceAfter / 100).toFixed(2)}\n`)

    process.stdout.write('\nStep 3/4: Update local gift_cards row\n')
    await prisma.giftCard.update({
      where: { id: ALEX_GC_DB_ID },
      data: {
        state: 'ACTIVE',
        current_balance_cents: balanceAfter,
        initial_amount_cents: AMOUNT_CENTS,
        last_balance_check_at: new Date(),
        updated_at: new Date(),
      },
    })
    process.stdout.write('  gift_cards row updated\n')

    process.stdout.write('\nStep 4/4: Log ACTIVATE transaction + link to reward\n')
    await prisma.giftCardTransaction.create({
      data: {
        gift_card_id: ALEX_GC_DB_ID,
        organization_id: null,
        transaction_type: 'ACTIVATE',
        amount_cents: AMOUNT_CENTS,
        balance_before_cents: 0,
        balance_after_cents: balanceAfter,
        square_activity_id: activity.id,
        reason: 'COMPLIMENTARY',
        context_label: 'Referrer reward gift card (manual backfill)',
        metadata: { square_activity: activity, fix_script: 'fix-alex-giftcard-activation' },
      },
    })
    process.stdout.write('  gift_card_transactions row inserted\n')

    await prisma.referralReward.update({
      where: { id: REWARD_ID },
      data: {
        gift_card_id: ALEX_GC_DB_ID,
        metadata: {
          code_used: '4D9SOV0B',
          backfilled: true,
          activation_fix: { script: 'fix-alex-giftcard-activation', activity_id: activity.id, at: new Date().toISOString() },
        },
      },
    })
    process.stdout.write('  referral_rewards row linked to gift card\n')
  }

  process.stdout.write('\nDone.\n')
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0) })
  .catch(async (err) => {
    process.stderr.write(`Error: ${err.message}\n${err.stack}\n`)
    await prisma.$disconnect()
    process.exit(1)
  })
