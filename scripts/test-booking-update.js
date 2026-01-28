const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Simulate the webhook data
const bookingData = {
  "all_day": false,
  "appointment_segments": [
    {
      "any_team_member": false,
      "duration_minutes": 90,
      "intermission_minutes": 0,
      "resource_ids": [
        "5OVIQ6GSSUXORACP6T7WBAQ7"
      ],
      "service_variation_client_id": "ZEAKNB35I37RMXNUBGWDZQIM",
      "service_variation_id": "ZEAKNB35I37RMXNUBGWDZQIM",
      "service_variation_version": 1768600976372,
      "team_member_id": "TMEvfivX1FlbVblT"
    },
    {
      "any_team_member": false,
      "duration_minutes": 120,
      "intermission_minutes": 0,
      "service_variation_client_id": "5KMEQ27BJSRQ4HEIXM3BEVCU",
      "service_variation_id": "5KMEQ27BJSRQ4HEIXM3BEVCU",
      "service_variation_version": 1769447591152,
      "team_member_id": "TMEvfivX1FlbVblT"
    }
  ],
  "created_at": "2026-01-27T19:02:00Z",
  "creator_details": {
    "creator_type": "TEAM_MEMBER",
    "team_member_id": "TMWAtQTYmZpwwxii"
  },
  "customer_id": "T41R3ECVVPBE83T588V9X39C0G",
  "id": "h3em1v9ojlqsyt",
  "location_id": "LNQKVBTQZN3EZ",
  "location_type": "BUSINESS_LOCATION",
  "source": "FIRST_PARTY_MERCHANT",
  "start_at": "2026-01-27T19:00:00Z",
  "status": "ACCEPTED",
  "transition_time_minutes": 0,
  "updated_at": "2026-01-27T20:57:39Z",
  "version": 1
}

async function testBookingUpdate() {
  const baseBookingId = bookingData.id
  console.log(`\n🧪 Testing booking update for: ${baseBookingId}\n`)

  // Extract data the same way processBookingUpdated does
  const version = bookingData.version || null
  const status = bookingData.status || null
  const updatedAt = bookingData.updated_at ? new Date(bookingData.updated_at) : new Date()

  console.log(`📊 Extracted values:`)
  console.log(`   Version: ${version} (type: ${typeof version})`)
  console.log(`   Status: ${status}`)
  console.log(`   Updated At: ${updatedAt.toISOString()}\n`)

  // Find existing bookings
  const existingBookings = await prisma.$queryRaw`
    SELECT id, organization_id, booking_id, service_variation_id, technician_id, administrator_id, version, status, updated_at
    FROM bookings
    WHERE booking_id LIKE ${`${baseBookingId}%`}
    ORDER BY created_at ASC
  `

  console.log(`📋 Found ${existingBookings.length} existing booking(s)\n`)

  if (existingBookings.length === 0) {
    console.log(`❌ No bookings found to update`)
    await prisma.$disconnect()
    return
  }

  for (const existingBooking of existingBookings) {
    console.log(`\n🔄 Processing booking: ${existingBooking.booking_id}`)
    console.log(`   Current version: ${existingBooking.version}`)
    console.log(`   Current status: ${existingBooking.status}`)
    console.log(`   Current updated_at: ${existingBooking.updated_at?.toISOString()}`)

    // Build update query (simplified version)
    const updateFields = []
    const updateValues = []

    if (status) {
      updateFields.push('status = $' + (updateValues.length + 1))
      updateValues.push(status)
    }

    if (version !== null) {
      updateFields.push('version = $' + (updateValues.length + 1))
      updateValues.push(version)
      console.log(`   ✅ Will update version to: ${version}`)
    } else {
      console.log(`   ⚠️ Version is null, will NOT update version field`)
    }

    // Always update updated_at and raw_json
    updateFields.push('updated_at = $' + (updateValues.length + 1) + '::timestamptz')
    updateValues.push(updatedAt)

    updateFields.push('raw_json = $' + (updateValues.length + 1) + '::jsonb')
    updateValues.push(JSON.stringify(bookingData))

    if (updateFields.length > 0) {
      const updateQuery = `
        UPDATE bookings
        SET ${updateFields.join(', ')}
        WHERE id = $${updateValues.length + 1}::uuid
      `
      updateValues.push(existingBooking.id)

      console.log(`\n   📝 Update query:`)
      console.log(`   ${updateQuery.substring(0, 200)}...`)
      console.log(`   Values: version=${version}, status=${status}, updated_at=${updatedAt.toISOString()}`)

      // Actually execute the update
      try {
        await prisma.$executeRawUnsafe(updateQuery, ...updateValues)
        console.log(`   ✅ Update executed successfully\n`)

        // Verify the update
        const updated = await prisma.$queryRaw`
          SELECT version, status, updated_at
          FROM bookings
          WHERE id = ${existingBooking.id}::uuid
        `
        if (updated && updated.length > 0) {
          const result = updated[0]
          console.log(`   ✅ Verification:`)
          console.log(`      Version: ${result.version} (expected: ${version})`)
          console.log(`      Status: ${result.status} (expected: ${status})`)
          console.log(`      Updated At: ${result.updated_at?.toISOString()} (expected: ${updatedAt.toISOString()})`)
        }
      } catch (error) {
        console.error(`   ❌ Update failed: ${error.message}`)
        console.error(`   Stack: ${error.stack}`)
      }
    }
  }

  await prisma.$disconnect()
}

testBookingUpdate()


