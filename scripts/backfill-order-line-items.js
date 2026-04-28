#!/usr/bin/env node
/**
 * Backfill missing order_line_items from Square API.
 *
 * The webhook line-item save silently failed from ~Jan 30, 2026 onward.
 * This script finds orders in the DB that have zero line items, fetches
 * each from Square, and inserts the line items via raw SQL.
 *
 * Usage:
 *   node scripts/backfill-order-line-items.js --dry-run
 *   node scripts/backfill-order-line-items.js --from 2026-01-30 --to 2026-04-16
 *   node scripts/backfill-order-line-items.js              # defaults: Jan 30 → today
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const prisma = require('../lib/prisma-client')
const https = require('https')
const crypto = require('crypto')

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
const DRY_RUN = process.argv.includes('--dry-run')
const FROM = getArg('--from') || '2026-01-30'
const TO = getArg('--to') || new Date().toISOString().slice(0, 10)

function getArg(flag) {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1] : null
}

function getSquareToken() {
  let token = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (token?.startsWith('Bearer ')) token = token.slice(7)
  return token
}

function fetchSquareOrder(squareOrderId) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://connect.squareup.com/v2/orders/${squareOrderId}`,
      { headers: { Authorization: `Bearer ${getSquareToken()}`, 'Content-Type': 'application/json' }, timeout: 15000 },
      (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { resolve(null) }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

/** Convert BigInt values to Number (Square SDK returns BigInt for money amounts) */
function sanitize(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => typeof v === 'bigint' ? Number(v) : v))
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj, (_, v) => typeof v === 'bigint' ? Number(v) : v)
  } catch { return null }
}

async function resolveTechnician(orderId, serviceVariationId, customerId, orderCreatedAt) {
  if (!serviceVariationId) return { technicianId: null, administratorId: null }

  // Try booking_segments first (preferred source of truth)
  const segments = await prisma.$queryRaw`
    SELECT bs.technician_id
    FROM booking_segments bs
    JOIN bookings b ON b.id = bs.booking_id
    WHERE b.organization_id = ${ORG_ID}::uuid
      AND bs.square_service_variation_id = ${serviceVariationId}
      AND bs.is_active = true
      AND b.customer_id = ${customerId}
      AND ABS(EXTRACT(EPOCH FROM b.start_at - ${orderCreatedAt}::timestamptz)) < 86400
    ORDER BY ABS(EXTRACT(EPOCH FROM b.start_at - ${orderCreatedAt}::timestamptz))
    LIMIT 1
  `
  if (segments.length > 0 && segments[0].technician_id) {
    return { technicianId: segments[0].technician_id, administratorId: null }
  }

  // Fallback: match booking by customer + date
  if (customerId && orderCreatedAt) {
    const bookings = await prisma.$queryRaw`
      SELECT b.technician_id
      FROM bookings b
      WHERE b.organization_id = ${ORG_ID}::uuid
        AND b.customer_id = ${customerId}
        AND b.technician_id IS NOT NULL
        AND b.status = 'ACCEPTED'
        AND ABS(EXTRACT(EPOCH FROM b.start_at - ${orderCreatedAt}::timestamptz)) < 86400
      ORDER BY ABS(EXTRACT(EPOCH FROM b.start_at - ${orderCreatedAt}::timestamptz))
      LIMIT 1
    `
    if (bookings.length > 0) {
      return { technicianId: bookings[0].technician_id, administratorId: null }
    }
  }

  return { technicianId: null, administratorId: null }
}

async function main() {
  console.log('=== Backfill Order Line Items ===')
  console.log(`Organization: ${ORG_ID}`)
  console.log(`Period: ${FROM} to ${TO}`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  // Find all orders with 0 line items in the date range
  const ordersWithoutItems = await prisma.$queryRaw`
    SELECT o.id AS order_uuid, o.order_id AS square_order_id,
           o.customer_id, o.location_id, o.state,
           o.created_at
    FROM orders o
    WHERE o.organization_id = ${ORG_ID}::uuid
      AND o.created_at >= ${FROM}::date
      AND o.created_at < (${TO}::date + INTERVAL '1 day')
      AND NOT EXISTS (
        SELECT 1 FROM order_line_items oli WHERE oli.order_id = o.id
      )
    ORDER BY o.created_at
  `

  console.log(`Found ${ordersWithoutItems.length} orders missing line items\n`)

  if (ordersWithoutItems.length === 0) {
    console.log('Nothing to backfill.')
    await prisma.$disconnect()
    return
  }

  const stats = { fetched: 0, inserted: 0, skipped: 0, failed: 0, noItems: 0 }

  for (const row of ordersWithoutItems) {
    const sqOrderId = row.square_order_id
    if (!sqOrderId) {
      console.log(`  SKIP: order ${row.order_uuid} — no square_order_id`)
      stats.skipped++
      continue
    }

    try {
      const res = await fetchSquareOrder(sqOrderId)
      const order = res?.order
      stats.fetched++

      if (!order) {
        console.log(`  SKIP: ${sqOrderId} — Square returned no data`)
        stats.skipped++
        continue
      }

      const lineItems = order.line_items || order.lineItems || []
      if (lineItems.length === 0) {
        console.log(`  EMPTY: ${sqOrderId} — order has 0 line items in Square`)
        stats.noItems++
        continue
      }

      const orderSafe = sanitize(order)
      const customerId = order.customer_id || order.customerId || row.customer_id
      const locationId = order.location_id || order.locationId || row.location_id
      const orderCreatedAt = order.created_at || order.createdAt || row.created_at?.toISOString()
      const orderUpdatedAt = order.updated_at || order.updatedAt || null
      const orderClosedAt = order.closed_at || order.closedAt || null
      const orderState = order.state || row.state || null
      const orderVersion = order.version != null ? Number(order.version) : null

      // Build discount name map
      const discountNameMap = new Map()
      const orderDiscounts = order.discounts || []
      orderDiscounts.forEach(d => {
        const uid = d.uid || d.discount_uid
        const name = d.name || d.discount_name
        if (uid && name) discountNameMap.set(uid, name)
      })

      const names = lineItems.map(li => li.name || '(unnamed)').join(', ')
      console.log(`  ORDER: ${sqOrderId} — ${lineItems.length} items — ${names}`)

      if (DRY_RUN) {
        stats.inserted += lineItems.length
        continue
      }

      for (const li of lineItems) {
        const liSafe = sanitize(li)
        const serviceVariationId = li.catalog_object_id || li.catalogObjectId || null
        const { technicianId, administratorId } = await resolveTechnician(
          row.order_uuid, serviceVariationId, customerId, orderCreatedAt
        )

        // Extract discount names for this line item
        const appliedDiscounts = li.applied_discounts || li.appliedDiscounts || []
        const discountNames = []
        if (Array.isArray(appliedDiscounts)) {
          appliedDiscounts.forEach(ad => {
            const uid = ad.discount_uid || ad.discountUid
            if (uid && discountNameMap.has(uid)) discountNames.push(discountNameMap.get(uid))
          })
        }
        const discountName = discountNames.length > 0 ? discountNames.join(', ') : null

        const amt = (field) => {
          const v = li[field]?.amount ?? li[field.replace(/_/g, '')]?.amount ?? null
          return v != null ? Number(v) : null
        }
        const cur = (field) => li[field]?.currency || li[field.replace(/_/g, '')]?.currency || 'USD'
        const oAmt = (field) => {
          const v = orderSafe[field]?.amount ?? orderSafe[field.replace(/_/g, '')]?.amount ?? null
          return v != null ? Number(v) : null
        }
        const oCur = (field) => orderSafe[field]?.currency || orderSafe[field.replace(/_/g, '')]?.currency || 'USD'

        try {
          // Try UPDATE first — line items may exist with wrong/NULL order_id
          const uid = liSafe.uid || null
          let updated = 0
          if (uid) {
            updated = await prisma.$executeRaw`
              UPDATE order_line_items SET
                order_id = ${row.order_uuid}::uuid,
                location_id = ${locationId},
                customer_id = ${customerId},
                technician_id = ${technicianId}::uuid,
                administrator_id = ${administratorId}::uuid,
                service_variation_id = ${serviceVariationId},
                discount_name = ${discountName},
                base_price_money_amount = ${amt('base_price_money')},
                base_price_money_currency = ${cur('base_price_money')},
                gross_sales_money_amount = ${amt('gross_sales_money')},
                gross_sales_money_currency = ${cur('gross_sales_money')},
                total_tax_money_amount = COALESCE(${amt('total_tax_money')}, 0),
                total_tax_money_currency = ${cur('total_tax_money')},
                total_discount_money_amount = COALESCE(${amt('total_discount_money')}, 0),
                total_discount_money_currency = ${cur('total_discount_money')},
                total_money_amount = ${amt('total_money')},
                total_money_currency = ${cur('total_money')},
                variation_total_price_money_amount = ${amt('variation_total_price_money')},
                variation_total_price_money_currency = ${cur('variation_total_price_money')},
                total_service_charge_money_amount = COALESCE(${amt('total_service_charge_money')}, 0),
                total_service_charge_money_currency = ${cur('total_service_charge_money')},
                total_card_surcharge_money_amount = COALESCE(${amt('total_card_surcharge_money')}, 0),
                total_card_surcharge_money_currency = ${cur('total_card_surcharge_money')},
                order_state = ${orderState},
                order_version = ${orderVersion},
                order_created_at = ${orderCreatedAt ? new Date(orderCreatedAt) : null},
                order_updated_at = ${orderUpdatedAt ? new Date(orderUpdatedAt) : null},
                order_closed_at = ${orderClosedAt ? new Date(orderClosedAt) : null},
                order_total_tax_money_amount = ${oAmt('total_tax_money')},
                order_total_tax_money_currency = ${oCur('total_tax_money')},
                order_total_discount_money_amount = ${oAmt('total_discount_money')},
                order_total_discount_money_currency = ${oCur('total_discount_money')},
                order_total_tip_money_amount = ${oAmt('total_tip_money')},
                order_total_tip_money_currency = ${oCur('total_tip_money')},
                order_total_money_amount = ${oAmt('total_money')},
                order_total_money_currency = ${oCur('total_money')},
                order_total_service_charge_money_amount = ${oAmt('total_service_charge_money')},
                order_total_service_charge_money_currency = ${oCur('total_service_charge_money')},
                order_total_card_surcharge_money_amount = ${oAmt('total_card_surcharge_money')},
                order_total_card_surcharge_money_currency = ${oCur('total_card_surcharge_money')},
                raw_json = ${safeStringify(liSafe)}::jsonb,
                updated_at = NOW()
              WHERE organization_id = ${ORG_ID}::uuid AND uid = ${uid}
            `
          }

          // If no existing row found, INSERT new
          if (updated === 0) {
            const newId = crypto.randomUUID()
            await prisma.$executeRaw`
              INSERT INTO order_line_items (
                id, organization_id, order_id, location_id, customer_id,
                technician_id, administrator_id, uid,
                service_variation_id, catalog_version, quantity, name, variation_name, item_type, discount_name,
                metadata, custom_attributes, fulfillments, applied_taxes, applied_discounts, applied_service_charges,
                note, modifiers,
                base_price_money_amount, base_price_money_currency,
                gross_sales_money_amount, gross_sales_money_currency,
                total_tax_money_amount, total_tax_money_currency,
                total_discount_money_amount, total_discount_money_currency,
                total_money_amount, total_money_currency,
                variation_total_price_money_amount, variation_total_price_money_currency,
                total_service_charge_money_amount, total_service_charge_money_currency,
                total_card_surcharge_money_amount, total_card_surcharge_money_currency,
                order_state, order_version, order_created_at, order_updated_at, order_closed_at,
                order_total_tax_money_amount, order_total_tax_money_currency,
                order_total_discount_money_amount, order_total_discount_money_currency,
                order_total_tip_money_amount, order_total_tip_money_currency,
                order_total_money_amount, order_total_money_currency,
                order_total_service_charge_money_amount, order_total_service_charge_money_currency,
                order_total_card_surcharge_money_amount, order_total_card_surcharge_money_currency,
                raw_json, created_at, updated_at
              ) VALUES (
                ${newId}::uuid, ${ORG_ID}::uuid, ${row.order_uuid}::uuid, ${locationId}, ${customerId},
                ${technicianId}::uuid, ${administratorId}::uuid, ${uid},
                ${serviceVariationId}, ${liSafe.catalog_version != null ? Number(liSafe.catalog_version) : null},
                ${liSafe.quantity || null}, ${liSafe.name || null}, ${liSafe.variation_name || null},
                ${liSafe.item_type || null}, ${discountName},
                ${liSafe.metadata ? safeStringify(liSafe.metadata) : null}::jsonb,
                ${liSafe.custom_attributes ? safeStringify(liSafe.custom_attributes) : null}::jsonb,
                ${liSafe.fulfillments ? safeStringify(liSafe.fulfillments) : null}::jsonb,
                ${liSafe.applied_taxes ? safeStringify(liSafe.applied_taxes) : null}::jsonb,
                ${liSafe.applied_discounts ? safeStringify(liSafe.applied_discounts) : null}::jsonb,
                ${liSafe.applied_service_charges ? safeStringify(liSafe.applied_service_charges) : null}::jsonb,
                ${liSafe.note || null},
                ${liSafe.modifiers ? safeStringify(liSafe.modifiers) : null}::jsonb,
                ${amt('base_price_money')}, ${cur('base_price_money')},
                ${amt('gross_sales_money')}, ${cur('gross_sales_money')},
                ${amt('total_tax_money') ?? 0}, ${cur('total_tax_money')},
                ${amt('total_discount_money') ?? 0}, ${cur('total_discount_money')},
                ${amt('total_money')}, ${cur('total_money')},
                ${amt('variation_total_price_money')}, ${cur('variation_total_price_money')},
                ${amt('total_service_charge_money') ?? 0}, ${cur('total_service_charge_money')},
                ${amt('total_card_surcharge_money') ?? 0}, ${cur('total_card_surcharge_money')},
                ${orderState}, ${orderVersion},
                ${orderCreatedAt ? new Date(orderCreatedAt) : null},
                ${orderUpdatedAt ? new Date(orderUpdatedAt) : null},
                ${orderClosedAt ? new Date(orderClosedAt) : null},
                ${oAmt('total_tax_money')}, ${oCur('total_tax_money')},
                ${oAmt('total_discount_money')}, ${oCur('total_discount_money')},
                ${oAmt('total_tip_money')}, ${oCur('total_tip_money')},
                ${oAmt('total_money')}, ${oCur('total_money')},
                ${oAmt('total_service_charge_money')}, ${oCur('total_service_charge_money')},
                ${oAmt('total_card_surcharge_money')}, ${oCur('total_card_surcharge_money')},
                ${safeStringify(liSafe)}::jsonb, NOW(), NOW()
              )
            `
          }
          stats.inserted++
        } catch (err) {
          console.error(`    ERROR on line item ${liSafe.uid || '?'}: ${err.message}`)
          stats.failed++
        }
      }

      // Update order raw_json if empty
      await prisma.$queryRaw`
        UPDATE orders SET raw_json = ${safeStringify(orderSafe)}::jsonb, updated_at = NOW()
        WHERE id = ${row.order_uuid}::uuid AND raw_json IS NULL
      `
    } catch (err) {
      console.error(`  ERROR: ${sqOrderId} — ${err.message}`)
      stats.failed++
    }

    // Rate limit Square API calls
    await new Promise(r => setTimeout(r, 150))
  }

  console.log('\n=== Summary ===')
  console.log(`Orders fetched from Square: ${stats.fetched}`)
  console.log(`Line items inserted:        ${stats.inserted}`)
  console.log(`Orders with 0 items:        ${stats.noItems}`)
  console.log(`Skipped:                    ${stats.skipped}`)
  console.log(`Failed:                     ${stats.failed}`)
  if (DRY_RUN) console.log('\n(dry-run, no changes were made)')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
