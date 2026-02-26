require('dotenv').config()
const prisma = require('../lib/prisma-client')

const TOKEN = process.env.SQUARE_ACCESS_TOKEN?.trim()?.replace(/^Bearer /, '')
const BASE = 'https://connect.squareup.com/v2'
const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'Square-Version': '2026-01-22'
}

const SAMPLE = parseInt(process.argv[2] || '10')

async function squareGet(path) {
  const resp = await fetch(BASE + path, { headers: HEADERS })
  if (!resp.ok) throw new Error(`Square ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function squarePost(path, body) {
  const resp = await fetch(BASE + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
  if (!resp.ok) throw new Error(`Square ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('\n' + '='.repeat(80))
  console.log('  VERIFY EMPTY CUSTOMERS VIA SQUARE API (fetch)')
  console.log('  Sample: ' + SAMPLE)
  console.log('='.repeat(80))

  // Get locations
  const locResp = await squareGet('/locations')
  const locationIds = (locResp.locations || []).map(l => l.id)
  console.log('Locations: ' + locationIds.join(', '))

  // Get sample of truly empty customers
  const customers = await prisma.$queryRawUnsafe(
    "SELECT sec.square_customer_id, sec.given_name, sec.family_name, sec.activated_as_referrer" +
    " FROM square_existing_clients sec" +
    " WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = sec.square_customer_id AND b.organization_id = sec.organization_id)" +
    " AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = sec.square_customer_id AND o.organization_id = sec.organization_id)" +
    " AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.customer_id = sec.square_customer_id AND p.organization_id = sec.organization_id)" +
    " AND sec.given_name IS NOT NULL AND sec.given_name != ''" +
    " ORDER BY RANDOM() LIMIT " + SAMPLE
  )
  console.log('Checking ' + customers.length + ' customers...\n')

  let hasBookings = 0, hasOrders = 0, trulyEmpty = 0, apiErrors = 0

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i]
    const name = ((c.given_name || '') + ' ' + (c.family_name || '')).trim()
    process.stdout.write((i + 1) + '. ' + name.padEnd(25))

    try {
      // 1. ListBookings
      const bResp = await squareGet('/bookings?customer_id=' + c.square_customer_id + '&limit=200')
      const bookings = bResp.bookings || []
      await sleep(200)

      // 2. SearchOrders
      let orders = []
      try {
        const oResp = await squarePost('/orders/search', {
          location_ids: locationIds,
          query: { filter: { customer_filter: { customer_ids: [c.square_customer_id] } } },
          limit: 100
        })
        orders = oResp.orders || []
      } catch (e) {
        // SearchOrders might fail for some customers, continue
      }
      await sleep(200)

      const accepted = bookings.filter(b => b.status === 'ACCEPTED').length
      const completed = orders.filter(o => o.state === 'COMPLETED').length

      if (bookings.length > 0) hasBookings++
      if (orders.length > 0) hasOrders++
      if (bookings.length === 0 && orders.length === 0) trulyEmpty++

      const status = bookings.length === 0 && orders.length === 0
        ? '✅ empty'
        : '❌ HAS DATA!'

      console.log(
        '| B:' + String(bookings.length).padStart(2) + '(A:' + accepted + ')' +
        ' O:' + String(orders.length).padStart(2) + '(C:' + completed + ')' +
        ' ref:' + (c.activated_as_referrer ? 'Y' : 'N') +
        ' | ' + status
      )

      if (bookings.length > 0) {
        for (const b of bookings.slice(0, 2)) {
          console.log('     booking: ' + (b.start_at || '?').substring(0, 10) + ' ' + b.status)
        }
      }
      if (orders.length > 0) {
        for (const o of orders.slice(0, 2)) {
          console.log('     order: ' + (o.created_at || '?').substring(0, 10) + ' ' + o.state + ' $' + ((o.total_money?.amount || 0) / 100).toFixed(0))
        }
      }
    } catch (e) {
      apiErrors++
      console.log('| ⚠️ ' + (e.message || '').substring(0, 80))
      await sleep(1000)
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('  Checked:      ' + customers.length)
  console.log('  Truly empty:  ' + trulyEmpty)
  console.log('  Has bookings: ' + hasBookings + (hasBookings > 0 ? ' ← MISSING FROM DB!' : ''))
  console.log('  Has orders:   ' + hasOrders + (hasOrders > 0 ? ' ← MISSING FROM DB!' : ''))
  console.log('  API errors:   ' + apiErrors)
  console.log('='.repeat(80) + '\n')

  await prisma.$disconnect()
  process.exit(0)
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })

