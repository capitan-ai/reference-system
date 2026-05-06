/**
 * Backfill Missing Ledger Entries
 *
 * Finds COMPLETED payments with booking_id that have NO SERVICE_COMMISSION
 * in master_earnings_ledger, then creates the missing entries.
 *
 * Strategy:
 *   1. Reset booking_snapshots.base_processed = false for snapshots that exist
 *   2. Create missing snapshots for bookings that don't have one
 *   3. Run the earnings worker to process everything through the normal pipeline
 *
 * Usage:
 *   node scripts/backfill-missing-ledger-entries.js [--dry-run] [--period 2026-03]
 */

import prisma from '../lib/prisma-client.js'
import { processMasterEarnings } from '../lib/workers/master-earnings-worker.js'

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
const DRY_RUN = process.argv.includes('--dry-run')
const periodArg = process.argv.find((a, i) => process.argv[i - 1] === '--period') || '2026-03'

async function main() {
  console.log(`\n=== Backfill Missing Ledger Entries ===`)
  console.log(`Organization: ${ORG_ID}`)
  console.log(`Period: ${periodArg}`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)
  console.log()

  const [year, month] = periodArg.split('-').map(Number)
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`

  // ── Step 1: Find payments with booking_id but no SERVICE_COMMISSION ──
  const missingPayments = await prisma.$queryRawUnsafe(`
    SELECT
      p.id AS payment_id,
      p.payment_id AS square_payment_id,
      p.booking_id,
      p.order_id,
      p.amount_money_amount,
      p.tip_money_amount,
      p.created_at,
      b.technician_id,
      b.customer_id,
      b.location_id,
      b.start_at,
      b.duration_minutes,
      b.status AS booking_status
    FROM payments p
    JOIN bookings b ON b.id = p.booking_id
    WHERE p.organization_id = $1::uuid
      AND p.status = 'COMPLETED'
      AND b.technician_id IS NOT NULL
      AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
      AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date < $3::date
      AND NOT EXISTS (
        SELECT 1 FROM master_earnings_ledger mel
        WHERE mel.booking_id = p.booking_id
          AND mel.entry_type = 'SERVICE_COMMISSION'
      )
    ORDER BY p.created_at
  `, ORG_ID, startDate, endDate)

  console.log(`Found ${missingPayments.length} payments with booking_id but no SERVICE_COMMISSION\n`)

  if (missingPayments.length === 0) {
    console.log('Nothing to backfill!')
    await prisma.$disconnect()
    return
  }

  // ── Step 2: Check which bookings have snapshots ──
  const bookingIds = missingPayments.map(p => p.booking_id)
  const existingSnapshots = await prisma.bookingSnapshot.findMany({
    where: { booking_id: { in: bookingIds } },
    select: { booking_id: true, base_processed: true, price_snapshot_amount: true, commission_rate_snapshot: true, technician_id: true }
  })
  const snapshotMap = new Map(existingSnapshots.map(s => [s.booking_id, s]))

  const withSnapshot = missingPayments.filter(p => snapshotMap.has(p.booking_id))
  const withoutSnapshot = missingPayments.filter(p => !snapshotMap.has(p.booking_id))

  console.log(`  With existing snapshot: ${withSnapshot.length}`)
  console.log(`  Without snapshot (need to create): ${withoutSnapshot.length}\n`)

  // ── Step 3: Load master_settings for commission rates ──
  const techIds = [...new Set(missingPayments.map(p => p.technician_id))]
  const settings = await prisma.masterSettings.findMany({
    where: { team_member_id: { in: techIds } },
    select: { team_member_id: true, commission_rate: true, category: true, location_code: true }
  })
  const settingsMap = new Map(settings.map(s => [s.team_member_id, s]))

  // ── Step 4: Load service variations for price data ──
  // We need these for snapshots that don't exist
  const bookingsNeedingSnapshots = withoutSnapshot.map(p => p.booking_id)
  let serviceVarMap = new Map()
  if (bookingsNeedingSnapshots.length > 0) {
    const bookingServices = await prisma.$queryRawUnsafe(`
      SELECT
        b.id AS booking_id,
        sv.price_amount,
        sv.duration_minutes AS sv_duration
      FROM bookings b
      LEFT JOIN service_variations sv ON sv.id = b.service_variation_id
      WHERE b.id = ANY($1::uuid[])
    `, bookingsNeedingSnapshots)
    serviceVarMap = new Map(bookingServices.map(bs => [bs.booking_id, bs]))
  }

  if (DRY_RUN) {
    console.log('── DRY RUN: Summary of what would happen ──\n')

    // Show stats
    let totalGross = 0, totalTips = 0, totalCommission = 0
    for (const p of missingPayments) {
      const snap = snapshotMap.get(p.booking_id)
      const ms = settingsMap.get(p.technician_id)
      const sv = serviceVarMap.get(p.booking_id)

      const price = snap?.price_snapshot_amount || sv?.price_amount || Number(p.amount_money_amount)
      const rate = snap?.commission_rate_snapshot || ms?.commission_rate || 40
      const commission = Math.round(price * rate / 100)

      totalGross += Number(p.amount_money_amount)
      totalTips += Number(p.tip_money_amount || 0)
      totalCommission += commission
    }

    console.log(`  Payments to process: ${missingPayments.length}`)
    console.log(`  Snapshots to reset:  ${withSnapshot.length}`)
    console.log(`  Snapshots to create: ${withoutSnapshot.length}`)
    console.log(`  Total gross:         $${(totalGross / 100).toFixed(2)}`)
    console.log(`  Total tips:          $${(totalTips / 100).toFixed(2)}`)
    console.log(`  Estimated commission: $${(totalCommission / 100).toFixed(2)}`)
    console.log('\nRun without --dry-run to execute.')
    await prisma.$disconnect()
    return
  }

  // ── Step 5: Reset existing snapshots to base_processed = false ──
  if (withSnapshot.length > 0) {
    const resetIds = withSnapshot.map(p => p.booking_id)
    const resetCount = await prisma.bookingSnapshot.updateMany({
      where: { booking_id: { in: resetIds } },
      data: { base_processed: false }
    })
    console.log(`Reset ${resetCount.count} snapshots to base_processed = false`)
  }

  // ── Step 6: Create missing snapshots ──
  if (withoutSnapshot.length > 0) {
    let created = 0
    for (const p of withoutSnapshot) {
      const ms = settingsMap.get(p.technician_id)
      const sv = serviceVarMap.get(p.booking_id)

      // Use service variation price if available, else payment amount
      const price = sv?.price_amount || Number(p.amount_money_amount)
      const rate = ms?.commission_rate || 40
      const duration = Number(p.duration_minutes) || sv?.sv_duration || 60

      try {
        await prisma.bookingSnapshot.create({
          data: {
            booking_id: p.booking_id,
            organization_id: ORG_ID,
            location_id: p.location_id,
            technician_id: p.technician_id,
            category_snapshot: ms?.category || 'MASTER',
            price_snapshot_amount: price,
            commission_rate_snapshot: rate,
            duration_minutes_snapshot: duration,
            status: p.booking_status || 'ACCEPTED',
            is_fix: false,
            base_processed: false,
            discount_processed: false
          }
        })
        created++
      } catch (err) {
        // Might already exist (race condition) — skip
        if (err.code === 'P2002') {
          console.log(`  Snapshot already exists for booking ${p.booking_id}, skipping`)
        } else {
          console.error(`  Error creating snapshot for booking ${p.booking_id}:`, err.message)
        }
      }
    }
    console.log(`Created ${created} new booking snapshots`)
  }

  // ── Step 7: Ensure all these bookings have COMPLETED orders ──
  // The earnings worker requires: snapshot + booking + order(COMPLETED) + payment(COMPLETED)
  // Check if any bookings are missing orders
  const missingOrders = await prisma.$queryRawUnsafe(`
    SELECT p.booking_id, p.order_id
    FROM payments p
    WHERE p.booking_id = ANY($1::uuid[])
      AND p.status = 'COMPLETED'
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.booking_id = p.booking_id AND o.state = 'COMPLETED'
      )
  `, bookingIds)

  if (missingOrders.length > 0) {
    console.log(`\n${missingOrders.length} bookings have no COMPLETED order — linking via payment.order_id...`)
    let linked = 0
    for (const mo of missingOrders) {
      if (mo.order_id) {
        // Update the order to point to this booking
        try {
          await prisma.$queryRawUnsafe(`
            UPDATE orders SET booking_id = $1::uuid WHERE id = $2::uuid AND booking_id IS NULL
          `, mo.booking_id, mo.order_id)
          linked++
        } catch (err) {
          // ignore constraint errors
        }
      }
    }
    console.log(`Linked ${linked} orders to bookings`)
  }

  // ── Step 8: Run the earnings worker with large batch ──
  console.log(`\nRunning earnings worker (batch=2000)...`)
  process.env.EARNINGS_VERBOSE = '1'
  await processMasterEarnings(ORG_ID, 2000)

  // ── Step 9: Verify results ──
  const afterCount = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS cnt
    FROM payments p
    JOIN bookings b ON b.id = p.booking_id
    WHERE p.organization_id = $1::uuid
      AND p.status = 'COMPLETED'
      AND b.technician_id IS NOT NULL
      AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
      AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date < $3::date
      AND NOT EXISTS (
        SELECT 1 FROM master_earnings_ledger mel
        WHERE mel.booking_id = p.booking_id
          AND mel.entry_type = 'SERVICE_COMMISSION'
      )
  `, ORG_ID, startDate, endDate)

  const remaining = afterCount[0]?.cnt || 0
  const processed = missingPayments.length - remaining

  console.log(`\n=== Results ===`)
  console.log(`Processed: ${processed} / ${missingPayments.length}`)
  console.log(`Remaining without ledger entries: ${remaining}`)

  if (remaining > 0) {
    console.log(`\n${remaining} payments still missing ledger entries.`)
    console.log(`These likely have broken order chains. Creating entries directly...`)

    // Direct backfill for stubborn ones
    const stillMissing = await prisma.$queryRawUnsafe(`
      SELECT
        p.booking_id,
        p.amount_money_amount,
        p.tip_money_amount,
        b.technician_id,
        bs.price_snapshot_amount,
        bs.commission_rate_snapshot
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      LEFT JOIN booking_snapshots bs ON bs.booking_id = p.booking_id
      WHERE p.organization_id = $1::uuid
        AND p.status = 'COMPLETED'
        AND b.technician_id IS NOT NULL
        AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
        AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date < $3::date
        AND NOT EXISTS (
          SELECT 1 FROM master_earnings_ledger mel
          WHERE mel.booking_id = p.booking_id
            AND mel.entry_type = 'SERVICE_COMMISSION'
        )
    `, ORG_ID, startDate, endDate)

    let directCreated = 0
    for (const row of stillMissing) {
      const ms = settingsMap.get(row.technician_id)
      const price = row.price_snapshot_amount || Number(row.amount_money_amount)
      const rate = row.commission_rate_snapshot || ms?.commission_rate || 40
      const commission = Math.round(price * rate / 100)
      const tips = Number(row.tip_money_amount || 0)

      const entries = []
      if (commission > 0) {
        entries.push({
          organization_id: ORG_ID,
          team_member_id: row.technician_id,
          booking_id: row.booking_id,
          entry_type: 'SERVICE_COMMISSION',
          amount_amount: commission,
          source_engine: 'BACKFILL',
          meta_json: { price_used: price, rate, backfill: true }
        })
      }
      if (tips > 0) {
        entries.push({
          organization_id: ORG_ID,
          team_member_id: row.technician_id,
          booking_id: row.booking_id,
          entry_type: 'TIP',
          amount_amount: tips,
          source_engine: 'BACKFILL',
          meta_json: { backfill: true }
        })
      }

      if (entries.length > 0) {
        try {
          await prisma.masterEarningsLedger.createMany({ data: entries })
          directCreated++
        } catch (err) {
          console.error(`  Error creating entries for booking ${row.booking_id}:`, err.message)
        }
      }
    }
    console.log(`Direct-created ledger entries for ${directCreated} bookings`)
  }

  // Final totals
  const finalStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(DISTINCT mel.booking_id)::int AS total_bookings,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'SERVICE_COMMISSION')::bigint AS total_commission,
      SUM(mel.amount_amount) FILTER (WHERE mel.entry_type = 'TIP')::bigint AS total_tips
    FROM master_earnings_ledger mel
    LEFT JOIN bookings b ON b.id = mel.booking_id
    WHERE mel.organization_id = $1::uuid
      AND (
        (b.id IS NOT NULL
          AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
          AND (b.start_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date < $3::date)
        OR
        (b.id IS NULL
          AND (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
          AND (mel.created_at AT TIME ZONE 'America/Los_Angeles')::date < $3::date)
      )
  `, ORG_ID, startDate, endDate)

  const stats = finalStats[0]
  console.log(`\n=== Final Ledger Totals for ${periodArg} ===`)
  console.log(`Bookings with entries: ${stats.total_bookings}`)
  console.log(`Total commission: $${(Number(stats.total_commission || 0) / 100).toFixed(2)}`)
  console.log(`Total tips (ledger): $${(Number(stats.total_tips || 0) / 100).toFixed(2)}`)

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
