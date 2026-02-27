require('dotenv').config()
const { Client, Environment } = require('square')
const prisma = require('../lib/prisma-client')

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production
})

const bookingsApi = client.getBookingsApi()

/**
 * Sample verification - check 100 random customers
 */
async function sampleVerification() {
  console.log('\n🔍 SAMPLE VERIFICATION (100 random customers)\n')
  console.log('='.repeat(80))

  try {
    // Get 100 random customers
    console.log('📋 Getting 100 random customers...')
    const customers = await prisma.$queryRaw`
      SELECT DISTINCT square_customer_id
      FROM customer_analytics
      ORDER BY RANDOM()
      LIMIT 100
    `
    console.log(`✅ Got ${customers.length} customers\n`)

    let matchedCount = 0
    let mismatchCount = 0
    let mismatches = []

    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i]
      const customerId = customer.square_customer_id

      try {
        // Get from Square
        const response = await bookingsApi.listBookings(
          100,        // limit
          undefined,  // cursor
          customerId, // customer_id
          undefined,  // team_member_id
          undefined,  // location_id
          undefined,  // start_at_min
          undefined   // start_at_max
        )

        const squareBookingCount = response.result?.bookings?.length || 0

        // Get from DB
        const dbBookings = await prisma.$queryRaw`
          SELECT COUNT(*) as count
          FROM bookings
          WHERE customer_id = ${customerId}
        `
        
        const dbCount = Number(dbBookings[0].count)

        if (squareBookingCount === dbCount) {
          matchedCount++
          console.log(`✅ ${i + 1}/100: ${customerId} → ${squareBookingCount} bookings (MATCH)`)
        } else {
          mismatchCount++
          mismatches.push({
            customerId,
            squareCount: squareBookingCount,
            dbCount: dbCount,
            diff: squareBookingCount - dbCount
          })
          console.log(`❌ ${i + 1}/100: ${customerId} → Square: ${squareBookingCount}, DB: ${dbCount} (MISMATCH)`)
        }

      } catch (error) {
        console.error(`⚠️ Error for ${customerId}: ${error.message}`)
      }

      // Rate limiting
      if ((i + 1) % 20 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    console.log('\n' + '='.repeat(80))
    console.log('📊 SAMPLE RESULTS\n')
    console.log(`Matched: ${matchedCount}/100 (${((matchedCount/100)*100).toFixed(1)}%)`)
    console.log(`Mismatched: ${mismatchCount}/100 (${((mismatchCount/100)*100).toFixed(1)}%)`)

    if (mismatches.length > 0) {
      console.log('\nMismatches:')
      console.table(mismatches)
    }

    // Verdict
    console.log('\n' + '='.repeat(80))
    if (mismatchCount === 0) {
      console.log('✅ PERFECT - Sample shows 100% match between Square and DB')
    } else if (mismatchCount <= 3) {
      console.log('✅ GOOD - Minor mismatches only (~3%), likely tolerable')
    } else {
      console.log('⚠️ ISSUE - Multiple mismatches found')
    }
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Fatal error:', error.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

sampleVerification()


