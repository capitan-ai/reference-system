require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { captureClientNote } = require('../lib/sync/capture-client-note')

/**
 * Backfill client_notes from existing data:
 *   - bookings.customer_note / seller_note  → booking_customer_note / booking_seller_note
 *   - order_line_items.note                 → order_line_item_note
 *   - orders.raw_json -> note               → order_note
 *   - payments.raw_json -> note             → payment_note
 *   - square_existing_clients.raw_json -> note → customer_card_note
 *
 * Idempotent: the unique index on client_notes drops duplicates.
 *
 * Run:   node scripts/backfill-client-notes.js
 *        node scripts/backfill-client-notes.js --dry-run
 */

const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_SIZE = 500

function log(msg) {
  console.log(`[backfill-client-notes] ${msg}`)
}

async function backfillBookings() {
  log('--- bookings ---')
  let cursor = null
  let total = 0
  let written = 0
  for (;;) {
    const rows = await prisma.booking.findMany({
      where: {
        customer_id: { not: null },
        OR: [
          { customer_note: { not: null } },
          { seller_note: { not: null } },
        ],
      },
      select: {
        id: true,
        organization_id: true,
        booking_id: true,
        customer_id: true,
        customer_note: true,
        seller_note: true,
        start_at: true,
        status: true,
        location_id: true,
        updated_at: true,
        raw_json: true,
        segments: {
          where: { is_active: true },
          orderBy: { segment_index: 'asc' },
          select: {
            square_team_member_id: true,
            square_service_variation_id: true,
          },
        },
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (rows.length === 0) break

    const allSquareSvIds = [
      ...new Set(rows.flatMap((b) => b.segments.map((s) => s.square_service_variation_id).filter(Boolean))),
    ]
    const svs = allSquareSvIds.length
      ? await prisma.serviceVariation.findMany({
          where: { square_variation_id: { in: allSquareSvIds } },
          select: { square_variation_id: true, name: true, service_name: true, organization_id: true },
        })
      : []
    const svKey = (orgId, sqId) => `${orgId}:${sqId}`
    const nameByKey = new Map(svs.map((sv) => [svKey(sv.organization_id, sv.square_variation_id), sv.name || sv.service_name || null]))

    for (const b of rows) {
      const serviceNames = b.segments
        .map((s) => s.square_service_variation_id ? nameByKey.get(svKey(b.organization_id, s.square_service_variation_id)) : null)
        .filter(Boolean)
      const staffMemberId = b.segments[0]?.square_team_member_id || null
      const baseNote = {
        organizationId: b.organization_id,
        squareCustomerId: b.customer_id,
        sourceId: b.booking_id,
        occurredAt: b.start_at,
        status: b.status,
        serviceNames,
        staffMemberId,
        locationId: null,
        rawContext: b.raw_json || {},
        squareUpdatedAt: b.updated_at,
      }
      if (b.customer_note) {
        if (!DRY_RUN) {
          const r = await captureClientNote({ ...baseNote, source: 'booking_customer_note', text: b.customer_note })
          if (r.written) written++
        }
        total++
      }
      if (b.seller_note) {
        if (!DRY_RUN) {
          const r = await captureClientNote({ ...baseNote, source: 'booking_seller_note', text: b.seller_note })
          if (r.written) written++
        }
        total++
      }
    }

    cursor = rows[rows.length - 1].id
    log(`  bookings cursor=${cursor}, processed_so_far=${total}, written=${written}`)
  }
  log(`bookings: scanned=${total} written=${written}`)
}

async function backfillOrderLineItems() {
  log('--- order_line_items.note ---')
  let cursor = null
  let total = 0
  let written = 0
  for (;;) {
    const rows = await prisma.orderLineItem.findMany({
      where: {
        note: { not: null },
        customer_id: { not: null },
        order_id: { not: null },
      },
      select: {
        id: true,
        organization_id: true,
        customer_id: true,
        note: true,
        uid: true,
        name: true,
        total_money_amount: true,
        order_state: true,
        order_created_at: true,
        order_updated_at: true,
        raw_json: true,
        order_id: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (rows.length === 0) break

    const orderUuids = [...new Set(rows.map((r) => r.order_id).filter(Boolean))]
    const orders = orderUuids.length
      ? await prisma.order.findMany({
          where: { id: { in: orderUuids } },
          select: { id: true, order_id: true },
        })
      : []
    const squareOrderById = new Map(orders.map((o) => [o.id, o.order_id]))

    for (const li of rows) {
      const squareOrderId = squareOrderById.get(li.order_id)
      if (!squareOrderId) continue
      total++
      if (DRY_RUN) continue
      const r = await captureClientNote({
        organizationId: li.organization_id,
        squareCustomerId: li.customer_id,
        source: 'order_line_item_note',
        sourceId: squareOrderId,
        sourceLineItemUid: li.uid || null,
        text: li.note,
        occurredAt: li.order_created_at || new Date(),
        status: li.order_state || null,
        amountCents: li.total_money_amount ?? null,
        serviceNames: li.name ? [li.name] : [],
        rawContext: li.raw_json || {},
        squareUpdatedAt: li.order_updated_at || null,
      })
      if (r.written) written++
    }
    cursor = rows[rows.length - 1].id
    log(`  line items cursor=${cursor}, processed_so_far=${total}, written=${written}`)
  }
  log(`order_line_items: scanned=${total} written=${written}`)
}

async function backfillOrders() {
  log('--- orders.raw_json -> note ---')
  let cursor = null
  let total = 0
  let written = 0
  for (;;) {
    const rows = cursor
      ? await prisma.$queryRaw`
          SELECT id::text AS id, order_id, organization_id::text AS organization_id, customer_id, state,
                 created_at, updated_at, total_money_amount, raw_json
          FROM orders
          WHERE customer_id IS NOT NULL
            AND raw_json IS NOT NULL
            AND raw_json ? 'note'
            AND COALESCE(raw_json->>'note', '') <> ''
            AND id > ${cursor}::uuid
          ORDER BY id ASC
          LIMIT ${BATCH_SIZE}
        `
      : await prisma.$queryRaw`
          SELECT id::text AS id, order_id, organization_id::text AS organization_id, customer_id, state,
                 created_at, updated_at, total_money_amount, raw_json
          FROM orders
          WHERE customer_id IS NOT NULL
            AND raw_json IS NOT NULL
            AND raw_json ? 'note'
            AND COALESCE(raw_json->>'note', '') <> ''
          ORDER BY id ASC
          LIMIT ${BATCH_SIZE}
        `
    if (rows.length === 0) break

    for (const o of rows) {
      total++
      if (DRY_RUN) continue
      const lineItems = Array.isArray(o.raw_json?.line_items) ? o.raw_json.line_items : []
      const serviceNames = lineItems.map((li) => li.name).filter(Boolean)
      const r = await captureClientNote({
        organizationId: o.organization_id,
        squareCustomerId: o.customer_id,
        source: 'order_note',
        sourceId: o.order_id,
        text: o.raw_json.note,
        occurredAt: o.created_at,
        status: o.state || null,
        amountCents: o.total_money_amount ?? null,
        serviceNames,
        rawContext: o.raw_json,
        squareUpdatedAt: o.updated_at,
      })
      if (r.written) written++
    }
    cursor = rows[rows.length - 1].id
    log(`  orders cursor=${cursor}, processed_so_far=${total}, written=${written}`)
    if (rows.length < BATCH_SIZE) break
  }
  log(`orders: scanned=${total} written=${written}`)
}

async function backfillPayments() {
  log('--- payments.raw_json -> note ---')
  let cursor = null
  let total = 0
  let written = 0
  for (;;) {
    const rows = cursor
      ? await prisma.$queryRaw`
          SELECT id::text AS id, payment_id, organization_id::text AS organization_id, customer_id,
                 status, created_at, updated_at, amount_money_amount, raw_json
          FROM payments
          WHERE customer_id IS NOT NULL
            AND raw_json IS NOT NULL
            AND raw_json ? 'note'
            AND COALESCE(raw_json->>'note', '') <> ''
            AND id > ${cursor}::uuid
          ORDER BY id ASC
          LIMIT ${BATCH_SIZE}
        `
      : await prisma.$queryRaw`
          SELECT id::text AS id, payment_id, organization_id::text AS organization_id, customer_id,
                 status, created_at, updated_at, amount_money_amount, raw_json
          FROM payments
          WHERE customer_id IS NOT NULL
            AND raw_json IS NOT NULL
            AND raw_json ? 'note'
            AND COALESCE(raw_json->>'note', '') <> ''
          ORDER BY id ASC
          LIMIT ${BATCH_SIZE}
        `
    if (rows.length === 0) break

    for (const p of rows) {
      total++
      if (DRY_RUN) continue
      const r = await captureClientNote({
        organizationId: p.organization_id,
        squareCustomerId: p.customer_id,
        source: 'payment_note',
        sourceId: p.payment_id,
        text: p.raw_json.note,
        occurredAt: p.created_at,
        status: p.status || null,
        amountCents: p.amount_money_amount ?? null,
        rawContext: p.raw_json,
        squareUpdatedAt: p.updated_at,
      })
      if (r.written) written++
    }
    cursor = rows[rows.length - 1].id
    log(`  payments cursor=${cursor}, processed_so_far=${total}, written=${written}`)
    if (rows.length < BATCH_SIZE) break
  }
  log(`payments: scanned=${total} written=${written}`)
}

async function backfillCustomerCards() {
  log('--- square_existing_clients.raw_json -> note ---')
  const rows = await prisma.$queryRaw`
    SELECT id, organization_id, square_customer_id, raw_json, updated_at
    FROM square_existing_clients
    WHERE raw_json IS NOT NULL
      AND raw_json ? 'note'
      AND COALESCE(raw_json->>'note', '') <> ''
  `
  let total = 0
  let written = 0
  for (const c of rows) {
    total++
    if (DRY_RUN) continue
    const r = await captureClientNote({
      organizationId: c.organization_id,
      squareCustomerId: c.square_customer_id,
      source: 'customer_card_note',
      sourceId: c.square_customer_id,
      text: c.raw_json.note,
      occurredAt: c.updated_at || new Date(),
      rawContext: c.raw_json,
      squareUpdatedAt: c.updated_at || null,
    })
    if (r.written) written++
  }
  log(`customer cards: scanned=${total} written=${written}`)
}

async function main() {
  log(DRY_RUN ? 'DRY RUN — no rows will be written' : 'LIVE RUN — rows will be written')
  await backfillBookings()
  await backfillOrderLineItems()
  await backfillOrders()
  await backfillPayments()
  await backfillCustomerCards()
  log('done')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
