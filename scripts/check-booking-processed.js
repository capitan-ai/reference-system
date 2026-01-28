const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkBookingProcessed() {
  const bookingId = 'h3em1v9ojlqsyt'
  const eventId = '61bb090b-8cba-561b-909f-bacdfb42e91b'
  const expectedUpdatedAt = new Date('2026-01-27T20:57:39Z')
  const expectedStatus = 'ACCEPTED'
  const expectedVersion = 1

  console.log(`\n🔍 Checking if booking ${bookingId} was processed...`)
  console.log(`   Event ID: ${eventId}`)
  console.log(`   Expected updated_at: ${expectedUpdatedAt.toISOString()}`)
  console.log(`   Expected status: ${expectedStatus}`)
  console.log(`   Expected version: ${expectedVersion}\n`)

  try {
    // Check for bookings with this booking_id (may have multiple records for multi-service bookings)
    const bookings = await prisma.$queryRaw`
      SELECT 
        id,
        booking_id,
        version,
        status,
        customer_id,
        location_id,
        updated_at,
        created_at,
        service_variation_id,
        technician_id,
        raw_json->>'id' as raw_booking_id,
        raw_json->>'version' as raw_version,
        raw_json->>'status' as raw_status,
        raw_json->>'updated_at' as raw_updated_at
      FROM bookings
      WHERE booking_id LIKE ${`${bookingId}%`}
      ORDER BY created_at ASC
    `

    if (!bookings || bookings.length === 0) {
      console.log(`❌ Booking ${bookingId} NOT FOUND in database`)
      console.log(`   This means the booking.updated webhook was NOT processed successfully`)
      return
    }

    console.log(`✅ Found ${bookings.length} booking record(s) for ${bookingId}\n`)

    for (const booking of bookings) {
      console.log(`📋 Booking Record:`)
      console.log(`   UUID: ${booking.id}`)
      console.log(`   Booking ID: ${booking.booking_id}`)
      console.log(`   Version: ${booking.version} (expected: ${expectedVersion})`)
      console.log(`   Status: ${booking.status} (expected: ${expectedStatus})`)
      console.log(`   Updated At: ${booking.updated_at?.toISOString()} (expected: ${expectedUpdatedAt.toISOString()})`)
      console.log(`   Customer ID: ${booking.customer_id}`)
      console.log(`   Service Variation ID: ${booking.service_variation_id}`)
      console.log(`   Technician ID: ${booking.technician_id}`)
      
      // Check if updated_at matches
      const updatedAtMatch = booking.updated_at && 
        Math.abs(new Date(booking.updated_at) - expectedUpdatedAt) < 60000 // Within 1 minute
      const statusMatch = booking.status === expectedStatus
      const versionMatch = booking.version === expectedVersion

      console.log(`\n   ✅ Updated At Match: ${updatedAtMatch ? 'YES' : 'NO'}`)
      console.log(`   ✅ Status Match: ${statusMatch ? 'YES' : 'NO'}`)
      console.log(`   ✅ Version Match: ${versionMatch ? 'YES' : 'NO'}`)

      if (updatedAtMatch && statusMatch && versionMatch) {
        console.log(`\n   ✅✅✅ This booking record WAS PROCESSED correctly!`)
      } else {
        console.log(`\n   ⚠️ This booking record may not have been fully updated`)
        if (!updatedAtMatch) {
          console.log(`      - Updated timestamp doesn't match (got: ${booking.updated_at?.toISOString()}, expected: ${expectedUpdatedAt.toISOString()})`)
        }
        if (!statusMatch) {
          console.log(`      - Status doesn't match (got: ${booking.status}, expected: ${expectedStatus})`)
        }
        if (!versionMatch) {
          console.log(`      - Version doesn't match (got: ${booking.version}, expected: ${expectedVersion})`)
        }
      }

      // Check raw_json
      if (booking.raw_booking_id) {
        console.log(`\n   Raw JSON contains booking ID: ${booking.raw_booking_id}`)
        console.log(`   Raw JSON version: ${booking.raw_version}`)
        console.log(`   Raw JSON status: ${booking.raw_status}`)
        console.log(`   Raw JSON updated_at: ${booking.raw_updated_at}`)
      }

      console.log(`\n`)
    }

    // Check if we can find the booking by exact ID match
    const exactMatch = bookings.find(b => b.booking_id === bookingId || b.booking_id === `${bookingId}:1`)
    if (exactMatch) {
      console.log(`✅ Found exact booking ID match`)
    } else {
      console.log(`⚠️ No exact booking ID match found (checked for ${bookingId} and ${bookingId}:1)`)
    }

  } catch (error) {
    console.error(`❌ Error checking booking:`, error.message)
    console.error(`   Stack:`, error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkBookingProcessed()


