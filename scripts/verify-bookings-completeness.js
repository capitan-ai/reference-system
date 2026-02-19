require('dotenv').config()
const { Client, Environment } = require('square')
const prisma = require('../lib/prisma-client')

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production
})

const bookingsApi = client.getBookingsApi()

/**
 * Verify that all bookings from Square API are in the database
 * Compare customer by customer
 */
async function verifyBookingsCompleteness() {
  console.log('\n🔍 VERIFYING BOOKINGS COMPLETENESS\n')
  console.log('='.repeat(80))

  try {
    // Step 1: Get all unique customers from customer_analytics
    console.log('📋 Step 1: Getting all customers from customer_analytics...')
    const customers = await prisma.$queryRaw`
      SELECT DISTINCT square_customer_id
      FROM customer_analytics
      ORDER BY square_customer_id
    `
    console.log(`✅ Found ${customers.length} unique customers\n`)

    // Stats
    let totalBookingsInSquareAPI = 0
    let totalBookingsInDB = 0
    let matchedCustomers = 0
    let customersWithMissing = 0
    let totalMissing = 0
    let customersWithExtra = 0
    let totalExtra = 0

    const missingDetails = []
    const extraDetails = []

    // Step 2: For each customer, get bookings from Square and compare
    console.log('📊 Step 2: Comparing bookings for each customer...\n')

    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i]
      const customerId = customer.square_customer_id

      try {
        // Get bookings from Square API for this customer
        let squareBookings = []
        let cursor = null
        let pageCount = 0

        do {
          try {
            const response = await bookingsApi.listBookings(
              100,        // limit (max 100)
              cursor,     // cursor
              customerId, // customer_id
              undefined,  // team_member_id
              undefined,  // location_id
              undefined,  // start_at_min
              undefined   // start_at_max
            )

            if (response.result && response.result.bookings) {
              squareBookings = squareBookings.concat(response.result.bookings)
              pageCount++
            }

            cursor = response.result?.cursor || null
          } catch (pageError) {
            console.error(`   ⚠️ Error fetching page ${pageCount + 1} for customer ${customerId}: ${pageError.message}`)
            break
          }
        } while (cursor)

        // Get bookings from DB for this customer
        const dbBookings = await prisma.$queryRaw`
          SELECT id, booking_id, status, start_at
          FROM bookings
          WHERE customer_id = ${customerId}
          ORDER BY booking_id
        `

        totalBookingsInSquareAPI += squareBookings.length
        totalBookingsInDB += dbBookings.length

        // Compare
        const squareIds = new Set(squareBookings.map(b => b.id))
        const dbIds = new Set(dbBookings.map(b => b.booking_id))

        // Find missing (in Square but not in DB)
        const missingInDB = Array.from(squareIds).filter(id => !dbIds.has(id))
        if (missingInDB.length > 0) {
          customersWithMissing++
          totalMissing += missingInDB.length
          missingDetails.push({
            customerId,
            count: missingInDB.length,
            bookingIds: missingInDB.slice(0, 5) // Show first 5
          })
        }

        // Find extra (in DB but not in Square)
        const extraInDB = Array.from(dbIds).filter(id => !squareIds.has(id))
        if (extraInDB.length > 0) {
          customersWithExtra++
          totalExtra += extraInDB.length
          extraDetails.push({
            customerId,
            count: extraInDB.length,
            bookingIds: extraInDB.slice(0, 5) // Show first 5
          })
        }

        if (missingInDB.length === 0 && extraInDB.length === 0) {
          matchedCustomers++
        }

        // Progress indicator every 50 customers
        if ((i + 1) % 50 === 0) {
          console.log(`   📍 Processed ${i + 1}/${customers.length} customers...`)
        }

      } catch (error) {
        console.error(`❌ Error processing customer ${customerId}: ${error.message}`)
      }

      // Rate limiting - Square API has limits
      if ((i + 1) % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    // Step 3: Report findings
    console.log('\n' + '='.repeat(80))
    console.log('📊 RESULTS\n')

    console.log('Summary:')
    console.log(`  Total customers: ${customers.length}`)
    console.log(`  Customers with perfect match: ${matchedCustomers}`)
    console.log(`  Customers with missing bookings: ${customersWithMissing}`)
    console.log(`  Customers with extra bookings: ${customersWithExtra}`)

    console.log('\nBookings count:')
    console.log(`  Total in Square API: ${totalBookingsInSquareAPI}`)
    console.log(`  Total in Database: ${totalBookingsInDB}`)
    console.log(`  Difference: ${Math.abs(totalBookingsInSquareAPI - totalBookingsInDB)}`)

    if (totalMissing > 0) {
      console.log(`\n⚠️ MISSING IN DATABASE: ${totalMissing} bookings`)
      console.log('\nFirst few customers with missing bookings:')
      missingDetails.slice(0, 10).forEach(detail => {
        console.log(`  Customer ${detail.customerId}: ${detail.count} missing bookings`)
        console.log(`    Sample IDs: ${detail.bookingIds.join(', ')}`)
      })
    } else {
      console.log('\n✅ NO MISSING BOOKINGS - All Square bookings are in database!')
    }

    if (totalExtra > 0) {
      console.log(`\n⚠️ EXTRA IN DATABASE: ${totalExtra} bookings`)
      console.log('\nFirst few customers with extra bookings:')
      extraDetails.slice(0, 10).forEach(detail => {
        console.log(`  Customer ${detail.customerId}: ${detail.count} extra bookings`)
        console.log(`    Sample IDs: ${detail.bookingIds.join(', ')}`)
      })
    } else {
      console.log('\n✅ NO EXTRA BOOKINGS - Database has no orphaned records!')
    }

    // Final verdict
    console.log('\n' + '='.repeat(80))
    if (totalMissing === 0 && totalExtra === 0) {
      console.log('✅ DATA INTEGRITY VERIFIED - Database is complete and accurate!')
    } else if (totalMissing > 0) {
      console.log(`⚠️ DATA INTEGRITY ISSUE - ${totalMissing} bookings missing from database`)
    } else if (totalExtra > 0) {
      console.log(`⚠️ DATA CONSISTENCY ISSUE - ${totalExtra} extra bookings in database`)
    }
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Fatal error:', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

verifyBookingsCompleteness()

