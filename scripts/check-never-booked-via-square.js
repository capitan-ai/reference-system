require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { getBookingsApi } = require('../lib/utils/square-client')

/**
 * Check NEVER_BOOKED customers who have payments against Square Bookings API.
 * If Square has bookings for them, it means our bookings table is missing data.
 */
async function checkNeverBookedCustomers() {
  console.log('\n' + '='.repeat(80))
  console.log('  NEVER_BOOKED + PAYMENTS — Square API Verification')
  console.log('='.repeat(80))

  const bookingsApi = getBookingsApi()

  // Get top NEVER_BOOKED customers with payments (sorted by revenue)
  const customers = await prisma.$queryRaw`
    SELECT sec.square_customer_id, sec.given_name, sec.family_name,
           sec.phone_number, sec.organization_id,
           ca.total_payments, ca.total_revenue_cents
    FROM square_existing_clients sec
    JOIN customer_analytics ca 
      ON ca.organization_id = sec.organization_id 
      AND ca.square_customer_id = sec.square_customer_id
    WHERE ca.customer_segment = 'NEVER_BOOKED'
      AND ca.total_payments > 0
    ORDER BY ca.total_revenue_cents DESC
    LIMIT 50
  `

  console.log(`\nChecking ${customers.length} NEVER_BOOKED customers with payments...\n`)

  let missingBookings = 0
  let confirmedNoBookings = 0
  let apiErrors = 0
  const results = []

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i]
    const name = `${c.given_name || ''} ${c.family_name || ''}`.trim() || c.square_customer_id.substring(0, 12)

    try {
      // Square ListBookings API: https://developer.squareup.com/reference/square/bookings-api/list-bookings
      // Parameters: limit, cursor, customerId, teamMemberId, locationId, startAtMin, startAtMax
      let allBookings = []
      let cursor = undefined

      do {
        const response = await bookingsApi.listBookings(
          200,        // limit
          cursor,     // cursor
          c.square_customer_id,  // customerId
          undefined,  // teamMemberId
          undefined,  // locationId
          undefined,  // startAtMin
          undefined   // startAtMax
        )
        
        const bookings = response.result.bookings || []
        allBookings = allBookings.concat(bookings)
        cursor = response.result.cursor
      } while (cursor)

      const accepted = allBookings.filter(b => b.status === 'ACCEPTED').length
      const cancelled = allBookings.filter(b => 
        b.status === 'CANCELLED_BY_CUSTOMER' || b.status === 'CANCELLED_BY_SELLER'
      ).length
      const noShow = allBookings.filter(b => b.status === 'NO_SHOW').length
      const other = allBookings.length - accepted - cancelled - noShow

      // Check how many we have in DB
      const dbBookings = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS cnt
        FROM bookings
        WHERE customer_id = ${c.square_customer_id}
          AND organization_id = ${c.organization_id}::uuid
      `
      const dbCount = dbBookings[0].cnt

      const status = allBookings.length > 0 && dbCount === 0 ? '❌ MISSING' : 
                     allBookings.length === 0 ? '✅ confirmed 0' : 
                     '⚠️ partial'

      if (allBookings.length > 0 && dbCount === 0) missingBookings++
      if (allBookings.length === 0) confirmedNoBookings++

      const rev = (Number(c.total_revenue_cents) / 100).toFixed(0)
      console.log(
        `${String(i + 1).padStart(3)}. ${name.padEnd(25)} | ` +
        `Rev: $${rev.padStart(5)} | ` +
        `Square: ${String(allBookings.length).padStart(3)} (A:${accepted} C:${cancelled} N:${noShow}) | ` +
        `DB: ${String(dbCount).padStart(3)} | ` +
        status
      )

      if (allBookings.length > 0 && dbCount === 0) {
        results.push({
          name, 
          customerId: c.square_customer_id,
          squareBookings: allBookings.length, 
          accepted, cancelled, noShow,
          dbBookings: dbCount,
          revenue: rev
        })
      }

      // Rate limiting — Square allows 10 req/sec
      if ((i + 1) % 8 === 0) {
        await new Promise(r => setTimeout(r, 1200))
      }

    } catch (error) {
      apiErrors++
      console.log(
        `${String(i + 1).padStart(3)}. ${name.padEnd(25)} | ` +
        `Rev: $${(Number(c.total_revenue_cents) / 100).toFixed(0).padStart(5)} | ` +
        `⚠️ API Error: ${error.message?.substring(0, 60)}`
      )
      // Rate limit backoff
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('  RESULTS')
  console.log('='.repeat(80))
  console.log(`  Checked: ${customers.length} customers`)
  console.log(`  ❌ MISSING bookings (Square has, DB doesn't): ${missingBookings}`)
  console.log(`  ✅ Confirmed no bookings in Square: ${confirmedNoBookings}`)
  console.log(`  ⚠️ API errors: ${apiErrors}`)

  if (results.length > 0) {
    console.log(`\n  These ${results.length} customers have bookings in Square but NOT in our DB:`)
    for (const r of results) {
      console.log(`    ${r.name} | Square: ${r.squareBookings} bookings (${r.accepted} accepted) | Rev: $${r.revenue}`)
    }
    console.log('\n  ACTION NEEDED: Backfill bookings for these customers.')
  } else {
    console.log('\n  All checked customers truly have no bookings in Square.')
    console.log('  They are POS / walk-in customers who paid without booking.')
  }

  console.log('='.repeat(80) + '\n')
  await prisma.$disconnect()
}

checkNeverBookedCustomers().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})

