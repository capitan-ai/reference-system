require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { getBookingsApi, getOrdersApi, getLocationsApi } = require('../lib/utils/square-client')

const SAMPLE_SIZE = parseInt(process.argv[2] || '10')

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function getLocationIds() {
  const locationsApi = getLocationsApi()
  const resp = await locationsApi.listLocations()
  return (resp.result.locations || []).map(l => l.id)
}

async function checkBookings(customerId) {
  try {
    const resp = await getBookingsApi().listBookings(200, undefined, customerId)
    return resp.result.bookings || []
  } catch (e) {
    if (e.statusCode === 404) return []
    throw e
  }
}

async function checkOrders(customerId, locationIds) {
  try {
    const ordersApi = getOrdersApi()
    const resp = await ordersApi.searchOrders({
      locationIds: locationIds,
      query: {
        filter: {
          customerFilter: {
            customerIds: [customerId]
          }
        }
      },
      limit: 100
    })
    return resp.result.orders || []
  } catch (e) {
    if (e.statusCode === 404) return []
    throw e
  }
}

async function main() {
  console.log('\n' + '='.repeat(80))
  console.log('  VERIFY TRULY EMPTY CUSTOMERS VIA SQUARE API')
  console.log('  Sample size: ' + SAMPLE_SIZE)
  console.log('='.repeat(80))

  // Get location IDs for SearchOrders
  console.log('\nFetching locations...')
  const locationIds = await getLocationIds()
  console.log('Locations: ' + locationIds.length)

  // Get sample of truly empty customers
  const customers = await prisma.$queryRawUnsafe(
    "SELECT sec.square_customer_id, sec.given_name, sec.family_name, sec.email_address, sec.phone_number, sec.created_at, sec.activated_as_referrer" +
    " FROM square_existing_clients sec" +
    " WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = sec.square_customer_id AND b.organization_id = sec.organization_id)" +
    " AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = sec.square_customer_id AND o.organization_id = sec.organization_id)" +
    " AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.customer_id = sec.square_customer_id AND p.organization_id = sec.organization_id)" +
    " AND sec.given_name IS NOT NULL AND sec.given_name != ''" +
    " ORDER BY RANDOM() LIMIT " + SAMPLE_SIZE
  )

  console.log('Checking ' + customers.length + ' customers...\n')

  let hasBookings = 0
  let hasOrders = 0
  let trulyEmpty = 0
  let errors = 0

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i]
    const name = ((c.given_name || '') + ' ' + (c.family_name || '')).trim()

    process.stdout.write((i + 1) + '/' + customers.length + ' ' + name.padEnd(25) + ' ')

    try {
      // Check bookings
      const bookings = await checkBookings(c.square_customer_id)
      await sleep(300) // rate limit

      // Check orders
      const orders = await checkOrders(c.square_customer_id, locationIds)
      await sleep(300) // rate limit

      const bCount = bookings.length
      const oCount = orders.length
      const accepted = bookings.filter(b => b.status === 'ACCEPTED').length
      const completed = orders.filter(o => o.state === 'COMPLETED').length

      if (bCount > 0) hasBookings++
      if (oCount > 0) hasOrders++
      if (bCount === 0 && oCount === 0) trulyEmpty++

      const status = bCount === 0 && oCount === 0
        ? '✅ confirmed empty'
        : '❌ HAS DATA IN SQUARE!'

      console.log(
        '| Bookings: ' + String(bCount).padStart(2) + ' (A:' + accepted + ')' +
        ' | Orders: ' + String(oCount).padStart(2) + ' (C:' + completed + ')' +
        ' | ref: ' + (c.activated_as_referrer ? 'Y' : 'N') +
        ' | ' + status
      )

      if (bCount > 0) {
        for (const b of bookings.slice(0, 3)) {
          console.log('      booking: ' + (b.startAt || '?').substring(0, 10) + ' | ' + b.status)
        }
      }
      if (oCount > 0) {
        for (const o of orders.slice(0, 3)) {
          console.log('      order: ' + (o.createdAt || '?').substring(0, 10) + ' | ' + o.state + ' | $' + ((o.totalMoney?.amount || 0) / 100).toFixed(2))
        }
      }

    } catch (e) {
      errors++
      console.log('| ⚠️  API Error: ' + (e.message || '').substring(0, 60))
      await sleep(2000) // backoff on error
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('  RESULTS')
  console.log('='.repeat(80))
  console.log('  Checked:        ' + customers.length)
  console.log('  Truly empty:    ' + trulyEmpty + ' (confirmed no data in Square)')
  console.log('  Has bookings:   ' + hasBookings + ' (MISSING from our DB!)')
  console.log('  Has orders:     ' + hasOrders + ' (MISSING from our DB!)')
  console.log('  API errors:     ' + errors)
  console.log('='.repeat(80) + '\n')

  await prisma.$disconnect()
  process.exit(0)
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})


