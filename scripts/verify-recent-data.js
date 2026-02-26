require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { getBookingsApi } = require('../lib/utils/square-client')

async function verifyRecentBookings() {
  console.log('--- Verifying Recent Bookings (Last 7 Days) ---')

  const startAt = new Date()
  startAt.setDate(startAt.getDate() - 7)
  const endAt = new Date()

  const bookingsApi = getBookingsApi()
  
  try {
    let allSquareBookings = []
    let cursor = undefined

    do {
      const response = await bookingsApi.listBookings(
        200,
        cursor,
        undefined, // customerId
        undefined, // teamMemberId
        undefined, // locationId
        startAt.toISOString(),
        endAt.toISOString()
      )
      
      const bookings = response.result.bookings || []
      allSquareBookings = allSquareBookings.concat(bookings)
      cursor = response.result.cursor
    } while (cursor)

    console.log(`Square has ${allSquareBookings.length} bookings in the last 7 days.`)

    const dbBookings = await prisma.booking.findMany({
      where: {
        start_at: {
          gte: startAt,
          lte: endAt
        }
      },
      select: {
        booking_id: true
      }
    })

    const dbIds = new Set(dbBookings.map(b => b.booking_id))
    console.log(`DB has ${dbIds.size} bookings in the last 7 days.`)

    const missing = allSquareBookings.filter(b => !dbIds.has(b.id))
    console.log(`Missing bookings: ${missing.length}`)

    if (missing.length > 0) {
      console.log('Sample missing IDs:', missing.slice(0, 5).map(b => b.id))
    } else {
      console.log('✅ No missing bookings found in the last 7 days.')
    }

  } catch (error) {
    console.error('Error verifying bookings:', error.message)
  }

  await prisma.$disconnect()
}

verifyRecentBookings()

