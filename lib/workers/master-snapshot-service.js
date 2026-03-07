import prisma from '../prisma-client.js'

/**
 * Creates or updates a financial snapshot for a booking.
 * This ensures historical accuracy of prices and commissions.
 */
export async function upsertBookingSnapshot(bookingId, organizationId) {
  console.log(`[SNAPSHOT-SERVICE] Upserting snapshot for booking ${bookingId}`)

  try {
    // 1. Get booking details with technician and service variation
    const booking = await prisma.booking.findFirst({
      where: {
        booking_id: bookingId,
        organization_id: organizationId
      },
      include: {
        service_variation: true
      }
    })

    if (!booking) {
      console.warn(`[SNAPSHOT-SERVICE] Booking ${bookingId} not found for snapshot`)
      return
    }

    // 2. Get master settings for the technician
    let masterSettings = null
    if (booking.technician_id) {
      masterSettings = await prisma.masterSettings.findUnique({
        where: { team_member_id: booking.technician_id }
      })
    }

    // 3. Determine values for snapshot
    const priceAmount = booking.service_variation?.price_amount || 0
    const commissionRate = masterSettings?.commission_rate || 40.0
    const category = masterSettings?.category || 'MASTER'
    const duration = booking.duration_minutes || 60

    // 4. Upsert snapshot
    await prisma.bookingSnapshot.upsert({
      where: { booking_id: booking.id },
      update: {
        status: booking.status,
        price_snapshot_amount: priceAmount,
        commission_rate_snapshot: commissionRate,
        category_snapshot: category,
        duration_minutes_snapshot: duration,
        technician_id: booking.technician_id,
        updated_at: new Date()
      },
      create: {
        booking_id: booking.id,
        organization_id: organizationId,
        location_id: booking.location_id,
        technician_id: booking.technician_id,
        status: booking.status,
        price_snapshot_amount: priceAmount,
        commission_rate_snapshot: commissionRate,
        category_snapshot: category,
        duration_minutes_snapshot: duration,
        is_fix: booking.service_variation?.name?.toLowerCase().includes('fix') || false
      }
    })

    console.log(`[SNAPSHOT-SERVICE] ✅ Snapshot updated for booking ${bookingId}`)
  } catch (error) {
    console.error(`[SNAPSHOT-SERVICE] ❌ Error in upsertBookingSnapshot:`, error.message)
  }
}
