require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const ORG_ID = 'd0e24178-2f94-4033-bc91-41f22df58278'

async function main() {
  console.log('══════════════════════════════════════════════════════════════════')
  console.log('  FULL DATABASE AUDIT')
  console.log('══════════════════════════════════════════════════════════════════\n')

  // ─── TOTALS ───
  const [bookings, orders, payments, lineItems, customers, locations, teamMembers] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM bookings WHERE organization_id = $1::uuid`, ORG_ID),
    prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM orders WHERE organization_id = $1::uuid`, ORG_ID),
    prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM payments WHERE organization_id = $1::uuid`, ORG_ID),
    prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM order_line_items WHERE organization_id = $1::uuid`, ORG_ID),
    prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM customer_analytics WHERE organization_id = $1::uuid`, ORG_ID),
    prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM locations WHERE organization_id = $1::uuid`, ORG_ID),
    prisma.$queryRawUnsafe(`SELECT COUNT(*) as c FROM team_members WHERE organization_id = $1::uuid`, ORG_ID),
  ])

  console.log('── ENTITY COUNTS ──')
  console.log(`  Bookings:       ${Number(bookings[0].c).toLocaleString()}`)
  console.log(`  Orders:         ${Number(orders[0].c).toLocaleString()}`)
  console.log(`  Payments:       ${Number(payments[0].c).toLocaleString()}`)
  console.log(`  Line Items:     ${Number(lineItems[0].c).toLocaleString()}`)
  console.log(`  Customers:      ${Number(customers[0].c).toLocaleString()}`)
  console.log(`  Locations:      ${Number(locations[0].c).toLocaleString()}`)
  console.log(`  Team Members:   ${Number(teamMembers[0].c).toLocaleString()}`)

  // ─── BOOKINGS STRUCTURE ───
  console.log('\n── BOOKINGS ──')
  const bStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(customer_id) as with_customer,
      COUNT(location_id) as with_location,
      COUNT(technician_id) as with_technician,
      COUNT(administrator_id) as with_admin,
      COUNT(service_variation_id) as with_service,
      COUNT(start_at) as with_start_at,
      COUNT(raw_json) as with_raw_json,
      COUNT(DISTINCT customer_id) as unique_customers,
      COUNT(DISTINCT technician_id) as unique_technicians,
      COUNT(DISTINCT location_id) as unique_locations,
      COUNT(DISTINCT status) as unique_statuses
    FROM bookings WHERE organization_id = $1::uuid
  `, ORG_ID)
  const b = bStats[0]
  console.log(`  Total: ${Number(b.total)}`)
  console.log(`  With customer_id: ${Number(b.with_customer)} (${Number(b.unique_customers)} unique)`)
  console.log(`  With location_id: ${Number(b.with_location)} (${Number(b.unique_locations)} unique)`)
  console.log(`  With technician_id: ${Number(b.with_technician)} (${Number(b.unique_technicians)} unique)`)
  console.log(`  With administrator_id: ${Number(b.with_admin)}`)
  console.log(`  With service_variation_id: ${Number(b.with_service)}`)
  console.log(`  With start_at: ${Number(b.with_start_at)}`)
  console.log(`  With raw_json: ${Number(b.with_raw_json)}`)

  const bStatuses = await prisma.$queryRawUnsafe(`
    SELECT status, COUNT(*) as c FROM bookings WHERE organization_id = $1::uuid GROUP BY status ORDER BY c DESC
  `, ORG_ID)
  console.log('  Statuses:', bStatuses.map(s => `${s.status}=${Number(s.c)}`).join(', '))

  // ─── ORDERS STRUCTURE ───
  console.log('\n── ORDERS ──')
  const oStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(customer_id) as with_customer,
      COUNT(location_id) as with_location,
      COUNT(booking_id) as with_booking,
      COUNT(technician_id) as with_technician,
      COUNT(team_member_id) as with_team_member,
      COUNT(total_money_amount) as with_total_money,
      COUNT(total_tip_money_amount) as with_tip,
      COUNT(closed_at) as with_closed_at,
      COUNT(source_name) as with_source,
      COUNT(raw_json) as with_raw_json,
      COUNT(DISTINCT customer_id) as unique_customers,
      COUNT(DISTINCT location_id) as unique_locations
    FROM orders WHERE organization_id = $1::uuid
  `, ORG_ID)
  const o = oStats[0]
  console.log(`  Total: ${Number(o.total)}`)
  console.log(`  With customer_id: ${Number(o.with_customer)} (${Number(o.unique_customers)} unique)`)
  console.log(`  With location_id: ${Number(o.with_location)} (${Number(o.unique_locations)} unique)`)
  console.log(`  With booking_id: ${Number(o.with_booking)} ⚠️`)
  console.log(`  With technician_id: ${Number(o.with_technician)}`)
  console.log(`  With team_member_id: ${Number(o.with_team_member)}`)
  console.log(`  With total_money: ${Number(o.with_total_money)}`)
  console.log(`  With tip_money: ${Number(o.with_tip)}`)
  console.log(`  With closed_at: ${Number(o.with_closed_at)}`)
  console.log(`  With source_name: ${Number(o.with_source)}`)
  console.log(`  With raw_json: ${Number(o.with_raw_json)}`)

  const oStates = await prisma.$queryRawUnsafe(`
    SELECT state, COUNT(*) as c FROM orders WHERE organization_id = $1::uuid GROUP BY state ORDER BY c DESC
  `, ORG_ID)
  console.log('  States:', oStates.map(s => `${s.state}=${Number(s.c)}`).join(', '))

  // Orders with valid booking_id
  const oValidBooking = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM orders o
    JOIN bookings b ON o.booking_id = b.id
    WHERE o.organization_id = $1::uuid
  `, ORG_ID)
  const oStaleBooking = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM orders o
    WHERE o.organization_id = $1::uuid AND o.booking_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = o.booking_id)
  `, ORG_ID)
  console.log(`  Valid booking links: ${Number(oValidBooking[0].c)}`)
  console.log(`  Stale booking links: ${Number(oStaleBooking[0].c)}`)

  // ─── PAYMENTS STRUCTURE ───
  console.log('\n── PAYMENTS ──')
  const pStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(customer_id) as with_customer,
      COUNT(location_id) as with_location,
      COUNT(order_id) as with_order,
      COUNT(booking_id) as with_booking,
      COUNT(technician_id) as with_technician,
      COUNT(administrator_id) as with_admin,
      COUNT(amount_money_amount) as with_amount,
      COUNT(tip_money_amount) as with_tip,
      COUNT(total_money_amount) as with_total,
      COUNT(raw_json) as with_raw_json,
      COUNT(source_type) as with_source_type
    FROM payments WHERE organization_id = $1::uuid
  `, ORG_ID)
  const p = pStats[0]
  console.log(`  Total: ${Number(p.total)}`)
  console.log(`  With customer_id: ${Number(p.with_customer)}`)
  console.log(`  With location_id: ${Number(p.with_location)}`)
  console.log(`  With order_id: ${Number(p.with_order)}`)
  console.log(`  With booking_id: ${Number(p.with_booking)}`)
  console.log(`  With technician_id: ${Number(p.with_technician)}`)
  console.log(`  With administrator_id: ${Number(p.with_admin)}`)
  console.log(`  With amount_money: ${Number(p.with_amount)}`)
  console.log(`  With tip_money: ${Number(p.with_tip)}`)
  console.log(`  With total_money: ${Number(p.with_total)}`)
  console.log(`  With source_type: ${Number(p.with_source_type)}`)
  console.log(`  With raw_json: ${Number(p.with_raw_json)}`)

  const pStatuses = await prisma.$queryRawUnsafe(`
    SELECT status, COUNT(*) as c FROM payments WHERE organization_id = $1::uuid GROUP BY status ORDER BY c DESC
  `, ORG_ID)
  console.log('  Statuses:', pStatuses.map(s => `${s.status}=${Number(s.c)}`).join(', '))

  // Payment linking quality
  const pValidOrder = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE p.organization_id = $1::uuid
  `, ORG_ID)
  const pStaleOrder = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM payments p
    WHERE p.organization_id = $1::uuid AND p.order_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = p.order_id)
  `, ORG_ID)
  const pValidBooking = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM payments p
    JOIN bookings b ON p.booking_id = b.id
    WHERE p.organization_id = $1::uuid
  `, ORG_ID)
  const pStaleBooking = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM payments p
    WHERE p.organization_id = $1::uuid AND p.booking_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = p.booking_id)
  `, ORG_ID)
  console.log(`  Valid order links: ${Number(pValidOrder[0].c)} / ${Number(p.with_order)}`)
  console.log(`  Stale order links: ${Number(pStaleOrder[0].c)}`)
  console.log(`  Valid booking links: ${Number(pValidBooking[0].c)} / ${Number(p.with_booking)}`)
  console.log(`  Stale booking links: ${Number(pStaleBooking[0].c)}`)

  // ─── LINE ITEMS STRUCTURE ───
  console.log('\n── ORDER LINE ITEMS ──')
  const liStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(order_id) as with_order,
      COUNT(booking_id) as with_booking,
      COUNT(customer_id) as with_customer,
      COUNT(technician_id) as with_technician,
      COUNT(name) as with_name,
      COUNT(quantity) as with_quantity,
      COUNT(total_money_amount) as with_total_money,
      COUNT(raw_json) as with_raw_json
    FROM order_line_items WHERE organization_id = $1::uuid
  `, ORG_ID)
  const li = liStats[0]
  console.log(`  Total: ${Number(li.total)}`)
  console.log(`  With order_id: ${Number(li.with_order)}`)
  console.log(`  With booking_id: ${Number(li.with_booking)}`)
  console.log(`  With customer_id: ${Number(li.with_customer)}`)
  console.log(`  With technician_id: ${Number(li.with_technician)}`)
  console.log(`  With name: ${Number(li.with_name)}`)
  console.log(`  With quantity: ${Number(li.with_quantity)}`)
  console.log(`  With total_money: ${Number(li.with_total_money)}`)
  console.log(`  With raw_json: ${Number(li.with_raw_json)}`)

  // Valid order links
  const liValidOrder = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM order_line_items li
    JOIN orders o ON li.order_id = o.id
    WHERE li.organization_id = $1::uuid
  `, ORG_ID)
  const liStaleOrder = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM order_line_items li
    WHERE li.organization_id = $1::uuid AND li.order_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = li.order_id)
  `, ORG_ID)
  const liValidBooking = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM order_line_items li
    JOIN bookings b ON li.booking_id = b.id
    WHERE li.organization_id = $1::uuid
  `, ORG_ID)
  const liStaleBooking = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM order_line_items li
    WHERE li.organization_id = $1::uuid AND li.booking_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = li.booking_id)
  `, ORG_ID)
  console.log(`  Valid order links: ${Number(liValidOrder[0].c)} / ${Number(li.with_order)}`)
  console.log(`  Stale order links: ${Number(liStaleOrder[0].c)}`)
  console.log(`  Valid booking links: ${Number(liValidBooking[0].c)} / ${Number(li.with_booking)}`)
  console.log(`  Stale booking links: ${Number(liStaleBooking[0].c)}`)

  // ─── CUSTOMERS ───
  console.log('\n── CUSTOMERS (customer_analytics) ──')
  const cCols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'customer_analytics' ORDER BY ordinal_position
  `)
  const colNames = cCols.map(c => c.column_name)
  const hasEmail = colNames.includes('email')
  const hasPhone = colNames.includes('phone')
  const hasFirstName = colNames.includes('given_name') || colNames.includes('first_name')
  const firstNameCol = colNames.includes('given_name') ? 'given_name' : 'first_name'

  const cStats = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) as total,
      COUNT(square_customer_id) as with_square_id
      ${hasEmail ? ', COUNT(email) as with_email' : ''}
      ${hasPhone ? ', COUNT(phone) as with_phone' : ''}
      ${hasFirstName ? `, COUNT(${firstNameCol}) as with_name` : ''}
    FROM customer_analytics WHERE organization_id = $1::uuid
  `, ORG_ID)
  const c = cStats[0]
  console.log(`  Total: ${Number(c.total)}`)
  console.log(`  With square_customer_id: ${Number(c.with_square_id)}`)
  if (hasEmail) console.log(`  With email: ${Number(c.with_email)}`)
  if (hasPhone) console.log(`  With phone: ${Number(c.with_phone)}`)
  if (hasFirstName) console.log(`  With name: ${Number(c.with_name)}`)

  // ─── LINKING OPPORTUNITIES ───
  console.log('\n══════════════════════════════════════════════════════════════════')
  console.log('  LINKING OPPORTUNITIES')
  console.log('══════════════════════════════════════════════════════════════════\n')

  // Orders → Bookings via customer+location+time (2h window)
  const orderBookingMatch = await prisma.$queryRawUnsafe(`
    WITH matches AS (
      SELECT o.id as order_id, COUNT(DISTINCT b.id) as cnt,
        MIN(ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at)))) as best_diff
      FROM orders o
      JOIN bookings b ON o.customer_id = b.customer_id AND o.location_id = b.location_id
      WHERE o.organization_id = $1::uuid
      AND o.booking_id IS NULL
      AND o.customer_id IS NOT NULL
      AND b.start_at IS NOT NULL
      AND o.closed_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (o.closed_at - b.start_at))) < 7200
      GROUP BY o.id
    )
    SELECT
      COUNT(*) as total_matchable,
      COUNT(*) FILTER (WHERE cnt = 1) as exact_1to1,
      COUNT(*) FILTER (WHERE cnt > 1) as ambiguous,
      ROUND(AVG(best_diff)) as avg_time_diff,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY best_diff)) as median_time_diff
    FROM matches
  `, ORG_ID)
  const m = orderBookingMatch[0]
  console.log('Orders → Bookings (customer+location, closed_at within 2h of start_at):')
  console.log(`  Total matchable: ${Number(m.total_matchable)}`)
  console.log(`  Exact 1:1: ${Number(m.exact_1to1)}`)
  console.log(`  Ambiguous (>1): ${Number(m.ambiguous)}`)
  console.log(`  Avg time diff: ${Number(m.avg_time_diff)}s`)
  console.log(`  Median time diff: ${Number(m.median_time_diff)}s`)

  // Payments fixable via order→booking chain
  const paymentFixable = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT p.id) as c FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE p.organization_id = $1::uuid
    AND (p.booking_id IS NULL OR NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = p.booking_id))
    AND o.booking_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = o.booking_id)
  `, ORG_ID)
  console.log(`\nPayments fixable NOW (order already has valid booking_id): ${Number(paymentFixable[0].c)}`)

  // Line items fixable via order→booking chain
  const liFixable = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT li.id) as c FROM order_line_items li
    JOIN orders o ON li.order_id = o.id
    WHERE li.organization_id = $1::uuid
    AND (li.booking_id IS NULL OR NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = li.booking_id))
    AND o.booking_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = o.booking_id)
  `, ORG_ID)
  console.log(`Line items fixable NOW (order already has valid booking_id): ${Number(liFixable[0].c)}`)

  // Orders without customer (unlinkable)
  const noCustomer = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM orders WHERE organization_id = $1::uuid AND booking_id IS NULL AND customer_id IS NULL
  `, ORG_ID)
  console.log(`\nOrders without customer_id (unlinkable): ${Number(noCustomer[0].c)}`)

  // Orders with customer but no booking match at all
  const noMatch = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM orders o
    WHERE o.organization_id = $1::uuid AND o.booking_id IS NULL AND o.customer_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM bookings b WHERE b.customer_id = o.customer_id AND b.location_id = o.location_id
    )
  `, ORG_ID)
  console.log(`Orders with customer but no booking exists for that customer+location: ${Number(noMatch[0].c)}`)

  // Technician propagation
  const techFromBooking = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as c FROM orders o
    JOIN bookings b ON o.booking_id = b.id
    WHERE o.organization_id = $1::uuid
    AND o.technician_id IS NULL AND b.technician_id IS NOT NULL
  `, ORG_ID)
  console.log(`\nOrders missing technician but booking has it: ${Number(techFromBooking[0].c)}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); prisma.$disconnect() })
