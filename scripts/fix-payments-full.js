require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { getPaymentsApi } = require('../lib/utils/square-client')
const prisma = new PrismaClient()
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('══════════════════════════════════════════════════════════════════')
  console.log('  FIX PAYMENTS - FULL CLEANUP')
  console.log('══════════════════════════════════════════════════════════════════\n')

  // ─── 1. Clear 30,149 stale booking_ids ───
  console.log('Step 1: Clear stale booking_ids (point to non-existent bookings)...')
  const staleBookings = await prisma.$queryRawUnsafe(`
    UPDATE payments SET booking_id = NULL, updated_at = NOW()
    WHERE organization_id = $1::uuid
    AND booking_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = payments.booking_id)
  `, ORG_ID)
  console.log(`  Cleared: ${staleBookings} stale booking_ids\n`)

  // ─── 2. Clear 510 stale order_ids ───
  console.log('Step 2: Clear stale order_ids (point to non-existent orders)...')
  const staleOrders = await prisma.$queryRawUnsafe(`
    UPDATE payments SET order_id = NULL, updated_at = NOW()
    WHERE organization_id = $1::uuid
    AND order_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = payments.order_id)
  `, ORG_ID)
  console.log(`  Cleared: ${staleOrders} stale order_ids\n`)

  // ─── 3. Re-link payments to orders using Square order_id from raw_json ───
  console.log('Step 3: Re-link payments to orders (using raw_json order reference)...')
  const relinked = await prisma.$queryRawUnsafe(`
    UPDATE payments p SET
      order_id = o.id,
      updated_at = NOW()
    FROM orders o
    WHERE p.organization_id = $1::uuid
    AND p.order_id IS NULL
    AND p.raw_json IS NOT NULL
    AND o.organization_id = $1::uuid
    AND (
      o.order_id = COALESCE(p.raw_json->>'orderId', p.raw_json->>'order_id')
    )
  `, ORG_ID)
  console.log(`  Re-linked: ${relinked} payments to orders via raw_json\n`)

  // ─── 4. Fill missing raw_json from Square API ───
  console.log('Step 4: Fill missing raw_json from Square API...')
  const missingRawJson = await prisma.$queryRawUnsafe(`
    SELECT payment_id FROM payments
    WHERE organization_id = $1::uuid AND raw_json IS NULL
  `, ORG_ID)
  console.log(`  Payments missing raw_json: ${missingRawJson.length}`)

  if (missingRawJson.length > 0) {
    const paymentsApi = getPaymentsApi()
    let filled = 0, failed = 0

    for (const row of missingRawJson) {
      try {
        await sleep(120)
        const resp = await paymentsApi.get({ paymentId: row.payment_id })
        const payment = resp.payment || resp
        if (payment) {
          const jsonStr = JSON.stringify(payment, (_, v) => typeof v === 'bigint' ? String(v) : v)
          await prisma.$queryRawUnsafe(`
            UPDATE payments SET raw_json = $1::jsonb, updated_at = NOW()
            WHERE organization_id = $2::uuid AND payment_id = $3
          `, jsonStr, ORG_ID, row.payment_id)
          filled++
        }
      } catch (err) {
        // Payment might not exist in Square anymore (FAILED payments get purged)
        failed++
      }
      if ((filled + failed) % 200 === 0) {
        console.log(`    Progress: ${filled} filled, ${failed} failed of ${missingRawJson.length}`)
      }
    }
    console.log(`  Filled: ${filled}, Unretrievable: ${failed}\n`)
  }

  // ─── 5. Re-link order_id for payments that still have none but raw_json has it ───
  console.log('Step 5: Link remaining payments without order_id...')
  const linkedMore = await prisma.$queryRawUnsafe(`
    UPDATE payments p SET
      order_id = o.id,
      updated_at = NOW()
    FROM orders o
    WHERE p.organization_id = $1::uuid
    AND p.order_id IS NULL
    AND p.raw_json IS NOT NULL
    AND o.organization_id = $1::uuid
    AND o.order_id = COALESCE(p.raw_json->>'orderId', p.raw_json->>'order_id')
  `, ORG_ID)
  console.log(`  Linked: ${linkedMore} more payments to orders\n`)

  // ─── 6. Propagate booking_id from orders that have it ───
  console.log('Step 6: Propagate booking_id from orders...')
  const propagated = await prisma.$queryRawUnsafe(`
    UPDATE payments p SET
      booking_id = o.booking_id,
      updated_at = NOW()
    FROM orders o
    WHERE p.organization_id = $1::uuid
    AND p.order_id = o.id
    AND p.booking_id IS NULL
    AND o.booking_id IS NOT NULL
  `, ORG_ID)
  console.log(`  Propagated: ${propagated} booking_ids from orders\n`)

  // ─── 7. Propagate technician_id from bookings ───
  console.log('Step 7: Propagate technician_id from bookings...')
  const techPropagated = await prisma.$queryRawUnsafe(`
    UPDATE payments p SET
      technician_id = b.technician_id,
      updated_at = NOW()
    FROM bookings b
    WHERE p.organization_id = $1::uuid
    AND p.booking_id = b.id
    AND p.technician_id IS NULL
    AND b.technician_id IS NOT NULL
  `, ORG_ID)
  console.log(`  Propagated: ${techPropagated} technician_ids from bookings\n`)

  // ─── FINAL STATS ───
  console.log('══════════════════════════════════════════════════════════════════')
  console.log('  FINAL PAYMENT STATE')
  console.log('══════════════════════════════════════════════════════════════════\n')

  const stats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(order_id) as with_order,
      COUNT(booking_id) as with_booking,
      COUNT(technician_id) as with_technician,
      COUNT(raw_json) as with_raw_json,
      COUNT(CASE WHEN order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = payments.order_id) THEN 1 END) as stale_order,
      COUNT(CASE WHEN booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = payments.booking_id) THEN 1 END) as stale_booking
    FROM payments WHERE organization_id = $1::uuid
  `, ORG_ID)
  const s = stats[0]
  console.log(`  Total:             ${Number(s.total)}`)
  console.log(`  With order_id:     ${Number(s.with_order)}`)
  console.log(`  With booking_id:   ${Number(s.with_booking)}`)
  console.log(`  With technician_id:${Number(s.with_technician)}`)
  console.log(`  With raw_json:     ${Number(s.with_raw_json)}`)
  console.log(`  Stale order links: ${Number(s.stale_order)}`)
  console.log(`  Stale booking links: ${Number(s.stale_booking)}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); prisma.$disconnect() })
