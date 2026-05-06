#!/usr/bin/env node
/**
 * One-time cleanup: collapse `<canonical>-<segment-uuid>` duplicate rows in `bookings`
 * onto their canonical-id sibling. Re-links FK / soft references, then deletes
 * the suffixed rows. Idempotent — running again on a clean DB is a no-op.
 *
 * Usage:
 *   node scripts/cleanup-duplicate-booking-rows.js              # dry-run (default)
 *   node scripts/cleanup-duplicate-booking-rows.js --apply      # actually mutate
 *
 * Strategy:
 *   For each canonical group (>1 booking row sharing split_part(booking_id, '-', 1)):
 *     1. Identify the canonical-id row (booking_id = canonical_part) as the survivor.
 *        If only suffixed rows exist (no exact-canonical row), skip the group with a warning.
 *     2. For tables with a UNIQUE/PK constraint on booking_id:
 *        - admin_created_booking_facts (PK on booking_id, no FK to bookings):
 *            DELETE suffix rows there (canonical's row stays).
 *     3. For tables with soft references (no unique constraint), UPDATE booking_id from suffix → canonical:
 *        - orders, order_line_items, payments, master_earnings_ledger,
 *          master_adjustments (booking_id, original_booking_id), package_usages,
 *          booking_snapshots.original_booking_id
 *     4. DELETE FROM bookings WHERE id IN suffix_ids. ON DELETE CASCADE handles
 *        booking_segments and booking_snapshots.booking_id automatically.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const prisma = require('../lib/prisma-client')

const APPLY = process.argv.includes('--apply')

const RELINK_TARGETS = [
  { table: 'orders',                       col: 'booking_id' },
  { table: 'order_line_items',             col: 'booking_id' },
  { table: 'payments',                     col: 'booking_id' },
  { table: 'master_earnings_ledger',       col: 'booking_id' },
  { table: 'master_adjustments',           col: 'booking_id' },
  { table: 'master_adjustments',           col: 'original_booking_id' },
  { table: 'package_usages',               col: 'booking_id' },
  { table: 'booking_snapshots',            col: 'original_booking_id' },
]

async function main() {
  console.log(APPLY ? '⚠️  APPLY MODE — changes will be committed' : 'DRY-RUN MODE — no changes\n')

  const groups = await prisma.$queryRaw`
    SELECT split_part(booking_id, '-', 1) AS canonical,
           COUNT(*)::int AS rows_in_group
    FROM bookings
    GROUP BY split_part(booking_id, '-', 1)
    HAVING COUNT(*) > 1
    ORDER BY canonical
  `
  console.log(`Found ${groups.length} duplicate canonical groups`)

  if (groups.length === 0) {
    console.log('✅ Nothing to clean up.')
    await prisma.$disconnect()
    return
  }

  let totalSuffixDeleted = 0
  let totalAcbfDeleted = 0
  const relinkCounts = {}
  for (const t of RELINK_TARGETS) relinkCounts[`${t.table}.${t.col}`] = 0
  let groupsSkipped = 0

  await prisma.$transaction(async (tx) => {
    for (const g of groups) {
      // (loop body unchanged)
      const rows = await tx.$queryRawUnsafe(
        `SELECT id::text AS id, booking_id FROM bookings
         WHERE split_part(booking_id, '-', 1) = $1
         ORDER BY length(booking_id), booking_id`,
        g.canonical
      )

      const canonicalRow = rows.find((r) => r.booking_id === g.canonical)
      if (!canonicalRow) {
        console.warn(`  ⚠️  [${g.canonical}] no canonical-id row exists — skipping`)
        groupsSkipped++
        continue
      }
      const suffixRows = rows.filter((r) => r.booking_id !== g.canonical)
      if (suffixRows.length === 0) continue

      const suffixIds = suffixRows.map((r) => r.id)

      // 1. admin_created_booking_facts: PK on booking_id, soft reference (no FK).
      //    Delete suffix rows; canonical's row remains.
      const acbfDeleted = await tx.$executeRawUnsafe(
        `DELETE FROM admin_created_booking_facts WHERE booking_id = ANY($1::uuid[])`,
        suffixIds
      )
      totalAcbfDeleted += Number(acbfDeleted)

      // 2. Soft-FK tables: UPDATE booking_id from suffix → canonical
      for (const t of RELINK_TARGETS) {
        const result = await tx.$executeRawUnsafe(
          `UPDATE ${t.table} SET ${t.col} = $1::uuid WHERE ${t.col} = ANY($2::uuid[])`,
          canonicalRow.id,
          suffixIds
        )
        relinkCounts[`${t.table}.${t.col}`] += Number(result)
      }

      // 3. Delete suffix booking rows. CASCADE handles booking_segments + booking_snapshots.
      const deleted = await tx.$executeRawUnsafe(
        `DELETE FROM bookings WHERE id = ANY($1::uuid[])`,
        suffixIds
      )
      if (Number(deleted) !== suffixIds.length) {
        throw new Error(`[${g.canonical}] expected to delete ${suffixIds.length} rows, deleted ${deleted}`)
      }
      totalSuffixDeleted += Number(deleted)
    }

    if (!APPLY) {
      throw new Error('__DRY_RUN_ROLLBACK__')
    }
  }, { maxWait: 10_000, timeout: 120_000 }).catch((err) => {
    if (err.message === '__DRY_RUN_ROLLBACK__') return
    throw err
  })

  console.log(`\n${APPLY ? 'Applied' : 'Would apply'}:`)
  console.log(`  Groups processed:                     ${groups.length - groupsSkipped} (skipped ${groupsSkipped})`)
  console.log(`  Suffix rows ${APPLY ? 'deleted' : 'to delete'}:                ${totalSuffixDeleted}`)
  console.log(`  admin_created_booking_facts cleaned:  ${totalAcbfDeleted}`)
  console.log(`  Re-link UPDATE counts:`)
  Object.entries(relinkCounts)
    .filter(([, n]) => n > 0)
    .forEach(([k, n]) => console.log(`    ${k}: ${n}`))
  const zero = Object.entries(relinkCounts).filter(([, n]) => n === 0).map(([k]) => k)
  if (zero.length) console.log(`    (no rows in: ${zero.join(', ')})`)

  // Verify post-state
  const after = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS dup_groups
    FROM (
      SELECT split_part(booking_id, '-', 1) AS canonical
      FROM bookings
      GROUP BY split_part(booking_id, '-', 1)
      HAVING COUNT(*) > 1
    ) x
  `
  console.log(`\nDuplicate groups remaining ${APPLY ? 'after cleanup' : '(should be unchanged in dry-run)'}: ${after[0].dup_groups}`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
