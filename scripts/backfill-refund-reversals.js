require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('══════════════════════════════════════════════════════════════════')
  console.log('  BACKFILL REFUND REVERSALS')
  console.log('══════════════════════════════════════════════════════════════════\n')

  // Get Square client for fetching refund details
  const { getSquareClient } = require('../lib/utils/square-client')
  const client = getSquareClient()

  // ─── Step 1: Find all payments with refund_ids ───
  console.log('Step 1: Finding payments with refund_ids...')
  const refundedPayments = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.payment_id, p.booking_id, p.total_money_amount, p.refund_ids,
      p.organization_id
    FROM payments p
    WHERE p.organization_id = $1::uuid
    AND array_length(p.refund_ids, 1) > 0
  `, ORG_ID)
  console.log(`  Total refunded payments: ${refundedPayments.length}`)
  console.log(`  With booking_id: ${refundedPayments.filter(p => p.booking_id).length}`)
  console.log(`  Without booking_id: ${refundedPayments.filter(p => !p.booking_id).length}\n`)

  // ─── Step 2: Fetch refund details from Square API ───
  console.log('Step 2: Fetching refund details from Square API...')
  let totalReversals = 0
  let skippedNoBooking = 0
  let skippedNoLedger = 0
  let skippedAlreadyExists = 0
  let fetchFailed = 0
  let created = 0

  for (const payment of refundedPayments) {
    if (!payment.booking_id) {
      skippedNoBooking++
      continue
    }

    for (const refundId of payment.refund_ids) {
      // Idempotency: check if REVERSAL already exists for this refund
      const existing = await prisma.$queryRawUnsafe(`
        SELECT id FROM master_earnings_ledger
        WHERE entry_type = 'REVERSAL'
        AND meta_json->>'refund_id' = $1
        LIMIT 1
      `, refundId)
      if (existing.length > 0) {
        skippedAlreadyExists++
        continue
      }

      // Fetch refund from Square API
      let refundAmountCents = 0
      let refundStatus = null
      try {
        await sleep(120) // rate limit
        const resp = await client.refunds.get({ refundId })
        const refund = resp.refund || resp
        refundAmountCents = refund.amountMoney?.amount || refund.amount_money?.amount || 0
        if (typeof refundAmountCents === 'bigint') refundAmountCents = Number(refundAmountCents)
        else refundAmountCents = Number(refundAmountCents)
        refundStatus = refund.status
      } catch (err) {
        // Try the payment's raw_json as fallback
        fetchFailed++
        console.log(`  ⚠️ Could not fetch refund ${refundId}: ${err.message}`)
        continue
      }

      // Only process completed/approved refunds
      if (refundStatus && !['COMPLETED', 'APPROVED'].includes(refundStatus)) {
        console.log(`  Refund ${refundId} status=${refundStatus}, skipping`)
        continue
      }

      // Find original ledger entries for this booking
      const originalEntries = await prisma.masterEarningsLedger.findMany({
        where: {
          booking_id: payment.booking_id,
          entry_type: { in: ['SERVICE_COMMISSION', 'TIP', 'DISCOUNT_ADJUSTMENT'] }
        }
      })

      if (originalEntries.length === 0) {
        skippedNoLedger++
        continue
      }

      // Determine refund ratio
      const totalPaymentAmount = Number(payment.total_money_amount) || 0
      const isFullRefund = refundAmountCents >= totalPaymentAmount || refundAmountCents === 0
      const refundRatio = isFullRefund ? 1.0 : (totalPaymentAmount > 0 ? refundAmountCents / totalPaymentAmount : 1.0)

      // Create REVERSAL entries
      const reversalEntries = []
      for (const entry of originalEntries) {
        const reversalAmount = isFullRefund
          ? -entry.amount_amount
          : -Math.round(entry.amount_amount * refundRatio)

        if (reversalAmount === 0) continue

        reversalEntries.push({
          organization_id: entry.organization_id,
          team_member_id: entry.team_member_id,
          booking_id: entry.booking_id,
          entry_type: 'REVERSAL',
          amount_amount: reversalAmount,
          source_engine: 'REFUND_ENGINE',
          meta_json: {
            refund_id: refundId,
            refund_payment_id: payment.payment_id,
            refund_amount_cents: refundAmountCents,
            refund_ratio: refundRatio,
            reversed_entry_id: entry.id,
            reversed_entry_type: entry.entry_type,
            reversed_amount: entry.amount_amount,
            backfill: true
          }
        })
      }

      if (reversalEntries.length > 0) {
        await prisma.masterEarningsLedger.createMany({ data: reversalEntries })
        created += reversalEntries.length
        console.log(`  ✅ Payment ${payment.payment_id}: ${reversalEntries.length} REVERSAL entries (ratio: ${refundRatio.toFixed(2)}, refund: $${(refundAmountCents / 100).toFixed(2)})`)
      }
    }

    totalReversals++
    if (totalReversals % 20 === 0) {
      console.log(`  Progress: ${totalReversals} payments processed...`)
    }
  }

  // ─── Step 3: Also update raw_json for refunded payments from Square API ───
  console.log('\nStep 3: Refreshing raw_json for refunded payments...')
  let rawUpdated = 0
  for (const payment of refundedPayments) {
    try {
      await sleep(120)
      const resp = await client.payments.get({ paymentId: payment.payment_id })
      const paymentData = resp.payment || resp
      if (paymentData) {
        const jsonStr = JSON.stringify(paymentData, (_, v) => typeof v === 'bigint' ? String(v) : v)
        await prisma.$executeRawUnsafe(`
          UPDATE payments SET raw_json = $1::jsonb, updated_at = NOW()
          WHERE organization_id = $2::uuid AND payment_id = $3
        `, jsonStr, ORG_ID, payment.payment_id)
        rawUpdated++
      }
    } catch (err) {
      // Payment might not exist anymore
    }
    if (rawUpdated % 20 === 0 && rawUpdated > 0) {
      console.log(`  Refreshed ${rawUpdated} of ${refundedPayments.length}...`)
    }
  }
  console.log(`  Refreshed: ${rawUpdated} payment raw_json records\n`)

  // ─── SUMMARY ───
  console.log('══════════════════════════════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('══════════════════════════════════════════════════════════════════\n')
  console.log(`  Refunded payments:         ${refundedPayments.length}`)
  console.log(`  Skipped (no booking):      ${skippedNoBooking}`)
  console.log(`  Skipped (no ledger):       ${skippedNoLedger}`)
  console.log(`  Skipped (already exists):  ${skippedAlreadyExists}`)
  console.log(`  Fetch failed:              ${fetchFailed}`)
  console.log(`  REVERSAL entries created:  ${created}`)
  console.log(`  Raw JSON refreshed:        ${rawUpdated}`)

  // Final ledger state
  const ledgerState = await prisma.$queryRawUnsafe(`
    SELECT entry_type, COUNT(*) as c, SUM(amount_amount) as total_cents
    FROM master_earnings_ledger
    WHERE organization_id = $1::uuid
    GROUP BY entry_type ORDER BY entry_type
  `, ORG_ID)
  console.log('\n  Ledger state:')
  ledgerState.forEach(l => {
    console.log(`    ${l.entry_type}: ${Number(l.c)} entries, $${(Number(l.total_cents) / 100).toFixed(2)}`)
  })

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); prisma.$disconnect() })
