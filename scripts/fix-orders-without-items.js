#!/usr/bin/env node
/**
 * Fix order-only payments — fetch from Square API to identify gift cards vs services
 *
 * Problem 2: 27 payments have order_id but no booking_id. These could be:
 *   - Gift cards (not salon services, correctly unlinked)
 *   - Services that need a technician
 *   - Orders with no line items in DB (webhook missed them)
 *
 * For each: fetch order from Square → identify type → update line items →
 * if service, try to resolve technician.
 *
 * Usage:
 *   node scripts/fix-orders-without-items.js [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const prisma = require('../lib/prisma-client')
const https = require('https')

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

const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'
const DRY_RUN = process.argv.includes('--dry-run')
const periodArg = process.argv.find((a, i) => process.argv[i - 1] === '--period') || '2026-03'
const [YEAR, MONTH] = periodArg.split('-').map(Number)
const START_DATE = `${YEAR}-${String(MONTH).padStart(2, '0')}-01`
const END_DATE = MONTH === 12 ? `${YEAR + 1}-01-01` : `${YEAR}-${String(MONTH + 1).padStart(2, '0')}-01`

// Gift card item types or name patterns
const GIFT_CARD_PATTERNS = [
  /gift\s*card/i,
  /egift/i,
  /reload/i,
  /^GC\b/i,
]

function isGiftCard(lineItem) {
  const itemType = lineItem.itemType || lineItem.item_type || ''
  if (itemType === 'GIFT_CARD') return true

  const name = lineItem.name || ''
  return GIFT_CARD_PATTERNS.some(re => re.test(name))
}

function orderToJson(order) {
  return JSON.parse(
    JSON.stringify(order, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  )
}

async function main() {
  console.log('=== Fix Order-Only Payments ===')
  console.log(`Organization: ${ORG_ID}`)
  console.log(`Period: ${periodArg} (${START_DATE} to ${END_DATE})`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  // Find payments with order_id but no booking_id and no technician, in the given period
  const orphanPayments = await prisma.$queryRawUnsafe(`
    SELECT
      p.id AS payment_uuid,
      p.payment_id AS square_payment_id,
      p.order_id AS order_uuid,
      p.amount_money_amount,
      p.tip_money_amount,
      p.created_at,
      o.order_id AS square_order_id,
      o.id AS order_db_id,
      (SELECT COUNT(*)::int FROM order_line_items oli WHERE oli.order_id = o.id) AS line_item_count
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE p.organization_id = $1::uuid
      AND p.status = 'COMPLETED'
      AND p.booking_id IS NULL
      AND p.technician_id IS NULL
      AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date >= $2::date
      AND (p.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date < $3::date
    ORDER BY p.amount_money_amount DESC
  `, ORG_ID, START_DATE, END_DATE)

  console.log(`Found ${orphanPayments.length} order-only payments without booking/technician\n`)

  if (orphanPayments.length === 0) {
    console.log('Nothing to fix.')
    await prisma.$disconnect()
    return
  }

  const stats = { giftCard: 0, service: 0, unknown: 0, fixed: 0, failed: 0 }

  for (const row of orphanPayments) {
    const sqOrderId = row.square_order_id
    const gross = (Number(row.amount_money_amount) / 100).toFixed(2)
    const tips = (Number(row.tip_money_amount || 0) / 100).toFixed(2)

    if (!sqOrderId) {
      console.log(`  SKIP: payment ${row.payment_uuid} — order has no square_order_id`)
      stats.unknown++
      continue
    }

    try {
      const res = await fetchSquareOrder(sqOrderId)
      const order = res?.order

      if (!order) {
        console.log(`  SKIP: ${sqOrderId} — Square returned no data`)
        stats.unknown++
        continue
      }

      const lineItems = order.lineItems || order.line_items || []
      const fulfillments = order.fulfillments || []

      // Identify type
      const allGiftCards = lineItems.length > 0 && lineItems.every(li => isGiftCard(li))
      const hasServices = lineItems.some(li => {
        const itemType = li.itemType || li.item_type || ''
        return itemType === 'ITEM' || itemType === 'CUSTOM_AMOUNT'
      })

      const itemNames = lineItems.map(li => li.name || '(unnamed)').join(', ')

      if (allGiftCards) {
        console.log(`  GIFT CARD: ${sqOrderId} — $${gross} — ${itemNames}`)
        stats.giftCard++
        continue // Nothing to fix — gift cards correctly have no technician
      }

      // Try to find technician from fulfillments
      let technicianId = null
      let techName = null

      for (const f of fulfillments) {
        const segments = f.appointmentDetails?.appointmentSegments
          || f.appointment_details?.appointment_segments || []
        for (const seg of segments) {
          const sqTeamId = seg.teamMemberId || seg.team_member_id
          if (sqTeamId) {
            const tm = await prisma.teamMember.findFirst({
              where: { square_team_member_id: sqTeamId, organization_id: ORG_ID },
              select: { id: true, given_name: true, family_name: true },
            })
            if (tm) {
              technicianId = tm.id
              techName = `${tm.given_name || ''} ${tm.family_name || ''}`.trim()
              break
            }
          }
        }
        if (technicianId) break
      }

      // Fallback: match booking by customer + date (within 1 day)
      if (!technicianId) {
        const customerId = order.customerId || order.customer_id
        const orderCreatedAt = order.createdAt || order.created_at
        if (customerId && orderCreatedAt) {
          const matchedBookings = await prisma.$queryRawUnsafe(`
            SELECT b.id, b.technician_id,
                   TRIM(COALESCE(tm.given_name, '') || ' ' || COALESCE(tm.family_name, '')) AS tech_name
            FROM bookings b
            JOIN team_members tm ON tm.id = b.technician_id
            WHERE b.organization_id = $1::uuid
              AND b.customer_id = $2
              AND b.technician_id IS NOT NULL
              AND b.status = 'ACCEPTED'
              AND ABS(EXTRACT(EPOCH FROM b.start_at - $3::timestamptz)) < 86400
            ORDER BY ABS(EXTRACT(EPOCH FROM b.start_at - $3::timestamptz))
            LIMIT 1
          `, ORG_ID, customerId, orderCreatedAt)
          if (matchedBookings.length > 0) {
            technicianId = matchedBookings[0].technician_id
            techName = matchedBookings[0].tech_name
          }
        }
      }

      if (hasServices && technicianId) {
        console.log(`  SERVICE: ${sqOrderId} — $${gross} tip $${tips} — ${itemNames} → ${techName}`)
        stats.service++
        stats.fixed++

        if (!DRY_RUN) {
          // Set technician on payment
          await prisma.$queryRawUnsafe(`
            UPDATE payments SET technician_id = $1::uuid, updated_at = NOW()
            WHERE id = $2::uuid
          `, technicianId, row.payment_uuid)
        }
      } else if (hasServices) {
        console.log(`  SERVICE (no tech): ${sqOrderId} — $${gross} tip $${tips} — ${itemNames}`)
        stats.service++
      } else {
        console.log(`  UNKNOWN: ${sqOrderId} — $${gross} tip $${tips} — items: ${lineItems.length} — ${itemNames}`)
        stats.unknown++
      }

      // Save line items to DB if missing
      if (!DRY_RUN && row.line_item_count === 0 && lineItems.length > 0) {
        for (const li of lineItems) {
          const liName = li.name || null
          const itemType = li.itemType || li.item_type || null
          const quantity = li.quantity || '1'
          const basePriceAmount = li.basePriceMoney?.amount || li.base_price_money?.amount || null
          const grossSalesAmount = li.grossSalesMoney?.amount || li.gross_sales_money?.amount || null
          const totalAmount = li.totalMoney?.amount || li.total_money?.amount || null
          const variationName = li.variationName || li.variation_name || null
          const catalogObjectId = li.catalogObjectId || li.catalog_object_id || null
          const catalogVersion = li.catalogVersion || li.catalog_version || null

          // Resolve service_variation_id from catalog_object_id
          let svId = null
          if (catalogObjectId) {
            const sv = await prisma.serviceVariation.findFirst({
              where: { square_variation_id: catalogObjectId, organization_id: ORG_ID },
              select: { uuid: true },
            })
            svId = sv?.uuid || null
          }

          try {
            await prisma.orderLineItem.create({
              data: {
                order_id: row.order_db_id,
                organization_id: ORG_ID,
                name: liName,
                variation_name: variationName,
                item_type: itemType,
                quantity: quantity,
                service_variation_id: svId,
                catalog_version: catalogVersion ? BigInt(catalogVersion) : null,
                base_price_money_amount: basePriceAmount ? Number(basePriceAmount) : null,
                gross_sales_money_amount: grossSalesAmount ? Number(grossSalesAmount) : null,
                total_money_amount: totalAmount ? Number(totalAmount) : null,
                technician_id: technicianId,
                raw_json: orderToJson(li),
              },
            })
          } catch (err) {
            // Ignore duplicates
            if (err.code !== 'P2002') {
              console.error(`    Error saving line item for order ${sqOrderId}: ${err.message}`)
            }
          }
        }
        console.log(`    Saved ${lineItems.length} line items to DB`)
      }

      // Update order raw_json if it was empty
      if (!DRY_RUN) {
        await prisma.$queryRawUnsafe(`
          UPDATE orders SET raw_json = $1::jsonb, updated_at = NOW()
          WHERE id = $2::uuid AND raw_json IS NULL
        `, JSON.stringify(orderToJson(order)), row.order_db_id)
      }
    } catch (err) {
      console.error(`  ERROR: ${sqOrderId} — ${err.message}`)
      stats.failed++
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 150))
  }

  console.log(`\n=== Summary ===`)
  console.log(`Gift cards (correctly unlinked): ${stats.giftCard}`)
  console.log(`Services (with technician fixed): ${stats.fixed}`)
  console.log(`Services (no tech found): ${stats.service - stats.fixed}`)
  console.log(`Unknown: ${stats.unknown}`)
  console.log(`Failed: ${stats.failed}`)
  if (DRY_RUN) console.log('\n(dry-run, no changes were made)')
}

main()
  .catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
