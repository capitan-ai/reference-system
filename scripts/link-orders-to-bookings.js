require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'

async function main() {
  console.log('══════════════════════════════════════════════════════════════════')
  console.log('  LINK ORDERS → BOOKINGS + CASCADE')
  console.log('══════════════════════════════════════════════════════════════════\n')

  // Pre-flight counts
  const before = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(booking_id) as with_booking,
      COUNT(CASE WHEN booking_id IS NULL THEN 1 END) as without_booking
    FROM orders WHERE organization_id = $1::uuid
  `, ORG_ID)
  const b = before[0]
  console.log(`Before: ${Number(b.total)} orders, ${Number(b.with_booking)} with booking, ${Number(b.without_booking)} without\n`)

  // ─── Step 0: Clear stale booking_ids on orders ───
  console.log('Step 0: Clear stale booking_ids on orders...')
  const stale = await prisma.$executeRawUnsafe(`
    UPDATE orders SET booking_id = NULL, updated_at = NOW()
    WHERE organization_id = $1::uuid
    AND booking_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = orders.booking_id)
  `, ORG_ID)
  console.log(`  Cleared: ${stale} stale booking_ids\n`)

  // ─── Step 1: Link via order metadata bookingId (highest confidence) ───
  console.log('Step 1: Link via order metadata bookingId...')
  const step1 = await prisma.$executeRawUnsafe(`
    UPDATE orders o SET booking_id = b.id, updated_at = NOW()
    FROM bookings b
    WHERE o.organization_id = $1::uuid AND b.organization_id = $1::uuid
    AND o.booking_id IS NULL
    AND o.raw_json IS NOT NULL
    AND o.raw_json->'metadata'->>'bookingId' IS NOT NULL
    AND b.booking_id = o.raw_json->'metadata'->>'bookingId'
  `, ORG_ID)
  console.log(`  Linked: ${step1} orders via metadata bookingId\n`)

  // ─── Step 2: Link via booking raw_json orderId (reverse reference) ───
  console.log('Step 2: Link via booking raw_json orderId...')
  const step2 = await prisma.$executeRawUnsafe(`
    UPDATE orders o SET booking_id = b.id, updated_at = NOW()
    FROM bookings b
    WHERE o.organization_id = $1::uuid AND b.organization_id = $1::uuid
    AND o.booking_id IS NULL
    AND b.raw_json IS NOT NULL
    AND b.raw_json->>'orderId' IS NOT NULL
    AND o.order_id = b.raw_json->>'orderId'
  `, ORG_ID)
  console.log(`  Linked: ${step2} orders via booking raw_json orderId\n`)

  // ─── Step 3: Link via exact 1:1 customer+location+time match ───
  console.log('Step 3: Link via exact 1:1 customer+location+time match (2h window)...')
  const step3 = await prisma.$executeRawUnsafe(`
    WITH exact_matches AS (
      SELECT o.id AS order_id, MIN(b.id::text)::uuid AS booking_id
      FROM orders o
      JOIN bookings b ON o.customer_id = b.customer_id AND o.location_id = b.location_id
      WHERE o.organization_id = $1::uuid
      AND o.booking_id IS NULL AND o.customer_id IS NOT NULL
      AND b.start_at IS NOT NULL AND o.closed_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at))) < 7200
      GROUP BY o.id HAVING COUNT(DISTINCT b.id) = 1
    )
    UPDATE orders o SET booking_id = em.booking_id, updated_at = NOW()
    FROM exact_matches em WHERE o.id = em.order_id
  `, ORG_ID)
  console.log(`  Linked: ${step3} orders via exact 1:1 match\n`)

  // ─── Step 4: Link ambiguous via closest-time match ───
  console.log('Step 4: Link ambiguous orders via closest-time match...')
  const step4 = await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT o.id AS order_id, b.id AS booking_id,
        ROW_NUMBER() OVER (
          PARTITION BY o.id
          ORDER BY ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at)))
        ) AS rn
      FROM orders o
      JOIN bookings b ON o.customer_id = b.customer_id AND o.location_id = b.location_id
      WHERE o.organization_id = $1::uuid
      AND o.booking_id IS NULL AND o.customer_id IS NOT NULL
      AND b.start_at IS NOT NULL AND o.closed_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at))) < 7200
    )
    UPDATE orders o SET booking_id = r.booking_id, updated_at = NOW()
    FROM ranked r WHERE o.id = r.order_id AND r.rn = 1
  `, ORG_ID)
  console.log(`  Linked: ${step4} orders via closest-time match\n`)

  // ─── Step 5: Cascade booking_id → payments ───
  console.log('Step 5: Cascade booking_id to payments...')
  const step5 = await prisma.$executeRawUnsafe(`
    UPDATE payments p SET booking_id = o.booking_id, updated_at = NOW()
    FROM orders o
    WHERE p.organization_id = $1::uuid
    AND p.order_id = o.id AND p.booking_id IS NULL AND o.booking_id IS NOT NULL
  `, ORG_ID)
  console.log(`  Cascaded: ${step5} payments got booking_id\n`)

  // ─── Step 6: Cascade booking_id → order_line_items ───
  console.log('Step 6: Cascade booking_id to order_line_items...')
  const step6 = await prisma.$executeRawUnsafe(`
    UPDATE order_line_items li SET booking_id = o.booking_id, updated_at = NOW()
    FROM orders o
    WHERE li.organization_id = $1::uuid
    AND li.order_id = o.id AND li.booking_id IS NULL AND o.booking_id IS NOT NULL
  `, ORG_ID)
  console.log(`  Cascaded: ${step6} line items got booking_id\n`)

  // ─── Step 7: Cascade technician_id → orders (from bookings) ───
  console.log('Step 7: Cascade technician_id to orders from bookings...')
  const step7 = await prisma.$executeRawUnsafe(`
    UPDATE orders o SET technician_id = b.technician_id, updated_at = NOW()
    FROM bookings b
    WHERE o.organization_id = $1::uuid
    AND o.booking_id = b.id AND o.technician_id IS NULL AND b.technician_id IS NOT NULL
  `, ORG_ID)
  console.log(`  Cascaded: ${step7} orders got technician_id\n`)

  // ─── Step 8: Cascade technician_id → payments (from bookings) ───
  console.log('Step 8: Cascade technician_id to payments from bookings...')
  const step8 = await prisma.$executeRawUnsafe(`
    UPDATE payments p SET technician_id = b.technician_id, updated_at = NOW()
    FROM bookings b
    WHERE p.organization_id = $1::uuid
    AND p.booking_id = b.id AND p.technician_id IS NULL AND b.technician_id IS NOT NULL
  `, ORG_ID)
  console.log(`  Cascaded: ${step8} payments got technician_id\n`)

  // ─── Step 9: Cascade technician_id → order_line_items (from bookings) ───
  console.log('Step 9: Cascade technician_id to line items from bookings...')
  const step9 = await prisma.$executeRawUnsafe(`
    UPDATE order_line_items li SET technician_id = b.technician_id, updated_at = NOW()
    FROM bookings b
    WHERE li.organization_id = $1::uuid
    AND li.booking_id = b.id AND li.technician_id IS NULL AND b.technician_id IS NOT NULL
  `, ORG_ID)
  console.log(`  Cascaded: ${step9} line items got technician_id\n`)

  // ─── FINAL STATS ───
  console.log('══════════════════════════════════════════════════════════════════')
  console.log('  FINAL STATE')
  console.log('══════════════════════════════════════════════════════════════════\n')

  const orderStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(booking_id) as with_booking,
      COUNT(technician_id) as with_technician,
      COUNT(CASE WHEN booking_id IS NULL AND customer_id IS NOT NULL THEN 1 END) as unlinked_with_customer,
      COUNT(CASE WHEN booking_id IS NULL AND customer_id IS NULL THEN 1 END) as unlinked_no_customer
    FROM orders WHERE organization_id = $1::uuid
  `, ORG_ID)
  const o = orderStats[0]
  console.log('Orders:')
  console.log(`  Total:                  ${Number(o.total)}`)
  console.log(`  With booking_id:        ${Number(o.with_booking)}`)
  console.log(`  With technician_id:     ${Number(o.with_technician)}`)
  console.log(`  Unlinked (has customer): ${Number(o.unlinked_with_customer)}`)
  console.log(`  Unlinked (no customer): ${Number(o.unlinked_no_customer)}`)

  const payStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(booking_id) as with_booking,
      COUNT(technician_id) as with_technician,
      COUNT(order_id) as with_order
    FROM payments WHERE organization_id = $1::uuid
  `, ORG_ID)
  const p = payStats[0]
  console.log('\nPayments:')
  console.log(`  Total:              ${Number(p.total)}`)
  console.log(`  With order_id:      ${Number(p.with_order)}`)
  console.log(`  With booking_id:    ${Number(p.with_booking)}`)
  console.log(`  With technician_id: ${Number(p.with_technician)}`)

  const liStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(booking_id) as with_booking,
      COUNT(technician_id) as with_technician,
      COUNT(order_id) as with_order
    FROM order_line_items WHERE organization_id = $1::uuid
  `, ORG_ID)
  const li = liStats[0]
  console.log('\nLine Items:')
  console.log(`  Total:              ${Number(li.total)}`)
  console.log(`  With order_id:      ${Number(li.with_order)}`)
  console.log(`  With booking_id:    ${Number(li.with_booking)}`)
  console.log(`  With technician_id: ${Number(li.with_technician)}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); prisma.$disconnect() })
