/**
 * Diagnose differences between Square report and our salary view
 *
 * Usage: node scripts/diagnose-salary-differences.js
 */

import prisma from '../lib/prisma-client.js'

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
const PERIOD_START = '2026-03-01'
const PERIOD_END = '2026-04-01'

async function main() {
  console.log('=== Salary View Diagnostic ===\n')

  // 1. Check for refunded payments
  const refundedPayments = await prisma.$queryRawUnsafe(`
    SELECT
      p.id,
      p.payment_id,
      p.amount_money_amount,
      p.tip_money_amount,
      p.status,
      p.refund_ids,
      COALESCE(b.technician_id, b2.technician_id) AS technician_id,
      TRIM(COALESCE(tm.given_name, '') || ' ' || COALESCE(tm.family_name, '')) AS tech_name
    FROM payments p
    LEFT JOIN bookings b ON b.id = p.booking_id
    LEFT JOIN orders o ON o.id = p.order_id AND p.booking_id IS NULL
    LEFT JOIN bookings b2 ON b2.id = o.booking_id AND p.booking_id IS NULL
    LEFT JOIN team_members tm ON tm.id = COALESCE(b.technician_id, b2.technician_id)
    WHERE p.organization_id = $1::uuid
      AND p.status = 'COMPLETED'
      AND (p.created_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
      AND (p.created_at AT TIME ZONE 'America/Los_Angeles')::date < $3::date
      AND cardinality(p.refund_ids) > 0
    ORDER BY p.amount_money_amount DESC
  `, ORG_ID, PERIOD_START, PERIOD_END)

  console.log(`── Refunded Payments (status=COMPLETED but has refund_ids) ──`)
  console.log(`Count: ${refundedPayments.length}`)
  const refundGross = refundedPayments.reduce((s, p) => s + Number(p.amount_money_amount), 0)
  const refundTips = refundedPayments.reduce((s, p) => s + Number(p.tip_money_amount || 0), 0)
  console.log(`Total gross: $${(refundGross / 100).toFixed(2)}`)
  console.log(`Total tips: $${(refundTips / 100).toFixed(2)}`)
  for (const p of refundedPayments) {
    console.log(`  ${p.tech_name || 'UNLINKED'}: $${(Number(p.amount_money_amount) / 100).toFixed(2)} gross, $${(Number(p.tip_money_amount || 0) / 100).toFixed(2)} tip, refund_ids=${JSON.stringify(p.refund_ids)}`)
  }

  // 2. Check for duplicate payment_ids
  const dupes = await prisma.$queryRawUnsafe(`
    SELECT payment_id, COUNT(*)::int AS cnt
    FROM payments
    WHERE organization_id = $1::uuid
      AND status = 'COMPLETED'
      AND (created_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
      AND (created_at AT TIME ZONE 'America/Los_Angeles')::date < $3::date
    GROUP BY payment_id
    HAVING COUNT(*) > 1
  `, ORG_ID, PERIOD_START, PERIOD_END)

  console.log(`\n── Duplicate Payment IDs ──`)
  console.log(`Count: ${dupes.length}`)
  for (const d of dupes) {
    console.log(`  payment_id=${d.payment_id}: ${d.cnt} records`)
  }

  // 3. Unlinked payments (no technician via any path)
  const unlinked = await prisma.$queryRawUnsafe(`
    SELECT
      p.id,
      p.payment_id,
      p.amount_money_amount,
      p.tip_money_amount,
      p.booking_id,
      p.order_id
    FROM payments p
    LEFT JOIN bookings b ON b.id = p.booking_id
    LEFT JOIN orders o ON o.id = p.order_id AND p.booking_id IS NULL
    LEFT JOIN bookings b2 ON b2.id = o.booking_id AND b2.technician_id IS NOT NULL AND p.booking_id IS NULL
    WHERE p.organization_id = $1::uuid
      AND p.status = 'COMPLETED'
      AND (p.created_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
      AND (p.created_at AT TIME ZONE 'America/Los_Angeles')::date < $3::date
      AND COALESCE(b.technician_id, b2.technician_id) IS NULL
    ORDER BY p.amount_money_amount DESC
  `, ORG_ID, PERIOD_START, PERIOD_END)

  console.log(`\n── Unlinked Payments (no technician) ──`)
  console.log(`Count: ${unlinked.length}`)
  const unlGross = unlinked.reduce((s, p) => s + Number(p.amount_money_amount), 0)
  const unlTips = unlinked.reduce((s, p) => s + Number(p.tip_money_amount || 0), 0)
  console.log(`Total gross: $${(unlGross / 100).toFixed(2)}`)
  console.log(`Total tips: $${(unlTips / 100).toFixed(2)}`)

  // 4. Per-master totals from our view logic
  const perMaster = await prisma.$queryRawUnsafe(`
    SELECT
      TRIM(COALESCE(tm.given_name, '') || ' ' || COALESCE(tm.family_name, '')) AS name,
      COALESCE(b.technician_id, b2.technician_id) AS tech_id,
      SUM(p.amount_money_amount)::bigint AS gross_cents,
      SUM(COALESCE(p.tip_money_amount, 0))::bigint AS tips_cents,
      COUNT(DISTINCT p.id)::int AS sale_count,
      COUNT(*) FILTER (WHERE cardinality(p.refund_ids) > 0)::int AS refunded_count,
      SUM(p.amount_money_amount) FILTER (WHERE cardinality(p.refund_ids) > 0)::bigint AS refunded_gross
    FROM payments p
    LEFT JOIN bookings b ON b.id = p.booking_id
    LEFT JOIN orders o ON o.id = p.order_id AND p.booking_id IS NULL
    LEFT JOIN bookings b2 ON b2.id = o.booking_id AND b2.technician_id IS NOT NULL AND p.booking_id IS NULL
    LEFT JOIN team_members tm ON tm.id = COALESCE(b.technician_id, b2.technician_id)
    WHERE p.organization_id = $1::uuid
      AND p.status = 'COMPLETED'
      AND (p.created_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
      AND (p.created_at AT TIME ZONE 'America/Los_Angeles')::date < $3::date
      AND COALESCE(b.technician_id, b2.technician_id) IS NOT NULL
    GROUP BY 1, 2
    ORDER BY gross_cents DESC
  `, ORG_ID, PERIOD_START, PERIOD_END)

  console.log(`\n── Per-Master Totals (current, including refunded) ──`)
  console.log(`${'Name'.padEnd(20)} ${'Gross'.padStart(12)} ${'Tips'.padStart(10)} ${'Sales'.padStart(6)} ${'Refunded'.padStart(9)}`)
  console.log('-'.repeat(60))
  let totalGross = 0, totalTips = 0, totalSales = 0
  for (const m of perMaster) {
    console.log(`${(m.name || '???').padEnd(20)} $${(Number(m.gross_cents) / 100).toFixed(2).padStart(11)} $${(Number(m.tips_cents) / 100).toFixed(2).padStart(9)} ${String(m.sale_count).padStart(6)} ${String(m.refunded_count).padStart(5)} ($${(Number(m.refunded_gross || 0) / 100).toFixed(2)})`)
    totalGross += Number(m.gross_cents)
    totalTips += Number(m.tips_cents)
    totalSales += m.sale_count
  }
  console.log('-'.repeat(60))
  console.log(`${'TOTAL'.padEnd(20)} $${(totalGross / 100).toFixed(2).padStart(11)} $${(totalTips / 100).toFixed(2).padStart(9)} ${String(totalSales).padStart(6)}`)

  // 5. Same but EXCLUDING refunded payments
  const perMasterClean = await prisma.$queryRawUnsafe(`
    SELECT
      TRIM(COALESCE(tm.given_name, '') || ' ' || COALESCE(tm.family_name, '')) AS name,
      SUM(p.amount_money_amount)::bigint AS gross_cents,
      SUM(COALESCE(p.tip_money_amount, 0))::bigint AS tips_cents,
      COUNT(DISTINCT p.id)::int AS sale_count
    FROM payments p
    LEFT JOIN bookings b ON b.id = p.booking_id
    LEFT JOIN orders o ON o.id = p.order_id AND p.booking_id IS NULL
    LEFT JOIN bookings b2 ON b2.id = o.booking_id AND b2.technician_id IS NOT NULL AND p.booking_id IS NULL
    LEFT JOIN team_members tm ON tm.id = COALESCE(b.technician_id, b2.technician_id)
    WHERE p.organization_id = $1::uuid
      AND p.status = 'COMPLETED'
      AND cardinality(p.refund_ids) = 0
      AND (p.created_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
      AND (p.created_at AT TIME ZONE 'America/Los_Angeles')::date < $3::date
      AND COALESCE(b.technician_id, b2.technician_id) IS NOT NULL
    GROUP BY 1
    ORDER BY gross_cents DESC
  `, ORG_ID, PERIOD_START, PERIOD_END)

  let cleanGross = 0, cleanTips = 0, cleanSales = 0
  for (const m of perMasterClean) {
    cleanGross += Number(m.gross_cents)
    cleanTips += Number(m.tips_cents)
    cleanSales += m.sale_count
  }

  console.log(`\n── Totals EXCLUDING refunded payments ──`)
  console.log(`Gross: $${(cleanGross / 100).toFixed(2)}`)
  console.log(`Tips:  $${(cleanTips / 100).toFixed(2)}`)
  console.log(`Sales: ${cleanSales}`)

  console.log(`\n── Comparison with Square ──`)
  console.log(`Square:         Gross $152,627.00  Tips $23,953.88  Sales 1,140`)
  console.log(`Current (all):  Gross $${(totalGross / 100).toFixed(2).padStart(10)}  Tips $${(totalTips / 100).toFixed(2).padStart(9)}  Sales ${totalSales}`)
  console.log(`Excl. refunded: Gross $${(cleanGross / 100).toFixed(2).padStart(10)}  Tips $${(cleanTips / 100).toFixed(2).padStart(9)}  Sales ${cleanSales}`)
  console.log(`Unlinked:       Gross $${(unlGross / 100).toFixed(2).padStart(10)}  Tips $${(unlTips / 100).toFixed(2).padStart(9)}  Sales ${unlinked.length}`)

  // 6. Check for non-COMPLETED status payments
  const otherStatuses = await prisma.$queryRawUnsafe(`
    SELECT status, COUNT(*)::int AS cnt, SUM(amount_money_amount)::bigint AS total
    FROM payments
    WHERE organization_id = $1::uuid
      AND (created_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
      AND (created_at AT TIME ZONE 'America/Los_Angeles')::date < $3::date
    GROUP BY status
    ORDER BY cnt DESC
  `, ORG_ID, PERIOD_START, PERIOD_END)

  console.log(`\n── Payment Status Breakdown ──`)
  for (const s of otherStatuses) {
    console.log(`  ${s.status}: ${s.cnt} payments, $${(Number(s.total) / 100).toFixed(2)}`)
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
