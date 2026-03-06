/**
 * Webhook Processors
 * 
 * These functions are called by the webhook-job-runner cron to process
 * queued webhook events asynchronously.
 */

import prisma from '../../../../lib/prisma-client'
import { Prisma } from '@prisma/client'
import locationResolver from '../../../../lib/location-resolver'

const { resolveLocationUuidForSquareLocationId } = locationResolver

// Helper to clean values
function cleanValue(val) {
  if (val === null || val === undefined) return null
  if (typeof val === 'string') return val.trim() || null
  return val
}

// Helper to safely stringify objects with BigInt values
function safeStringify(value) {
  return JSON.stringify(value, (_key, val) => 
    typeof val === 'bigint' ? val.toString() : val
  )
}

async function upsertBookingSegmentsFromPayload(bookingId, organizationId, bookingData) {
  const segments = bookingData?.appointment_segments || bookingData?.appointmentSegments || []
  if (!Array.isArray(segments) || segments.length === 0) {
    return
  }

  const bookingRecord = await prisma.$queryRaw`
    SELECT id FROM bookings
    WHERE booking_id = ${bookingId}
      AND organization_id = ${organizationId}::uuid
    LIMIT 1
  `
  const bookingUuid = bookingRecord?.[0]?.id
  if (!bookingUuid) {
    return
  }

  const bookingVersion = Number.isFinite(bookingData?.version) ? bookingData.version : 0

  await prisma.$executeRaw`
    UPDATE booking_segments
    SET is_active = false,
        deleted_at = NOW(),
        updated_at = NOW()
    WHERE booking_id = ${bookingUuid}::uuid
      AND booking_version < ${bookingVersion}
  `

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const squareVariationId = segment.service_variation_id || segment.serviceVariationId
    const teamMemberId = segment.team_member_id || segment.teamMemberId
    const durationMinutes = segment.duration_minutes || segment.durationMinutes

    let technicianUuid = null
    if (teamMemberId) {
      const tm = await prisma.teamMember.findFirst({
        where: { square_team_member_id: teamMemberId, organization_id: organizationId }
      })
      technicianUuid = tm?.id
    }

    let variationUuid = null
    if (squareVariationId) {
      const sv = await prisma.serviceVariation.findFirst({
        where: { square_variation_id: squareVariationId, organization_id: organizationId }
      })
      variationUuid = sv?.uuid
    }

    await prisma.$executeRaw`
      INSERT INTO booking_segments (
        id, booking_id, segment_index, square_service_variation_id, service_variation_id,
        square_team_member_id, technician_id, duration_minutes, booking_version,
        is_active, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${bookingUuid}::uuid, ${i}, ${squareVariationId}, 
        ${variationUuid ? variationUuid : Prisma.sql`NULL`}::uuid,
        ${teamMemberId}, ${technicianUuid ? technicianUuid : Prisma.sql`NULL`}::uuid,
        ${durationMinutes}, ${bookingVersion},
        true, NOW(), NOW()
      )
      ON CONFLICT (booking_id, segment_index, booking_version) DO UPDATE SET
        square_service_variation_id = EXCLUDED.square_service_variation_id,
        service_variation_id = EXCLUDED.service_variation_id,
        square_team_member_id = EXCLUDED.square_team_member_id,
        technician_id = EXCLUDED.technician_id,
        duration_minutes = EXCLUDED.duration_minutes,
        is_active = true,
        updated_at = NOW()
    `
  }
}

/**
 * Process booking.created webhook
 * Saves new booking to database
 */
export async function processBookingCreated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processBookingCreated called for event ${eventId}`)
  
  const bookingData = payload.booking || payload.object?.booking || payload
  if (!bookingData) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ No booking data in payload for event ${eventId}`)
    return
  }

  const bookingId = bookingData.id || bookingData.bookingId
  const customerId = bookingData.customer_id || bookingData.customerId
  const locationId = bookingData.location_id || bookingData.locationId
  const merchantId = payload.merchant_id || bookingData.merchant_id

  if (!bookingId) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ No booking ID in payload for event ${eventId}`)
    return
  }

  try {
    const organizationRecord = await prisma.organization.findFirst({
      where: {
        OR: [
          { square_merchant_id: merchantId },
          { locations: { some: { square_location_id: locationId } } }
        ]
      },
      select: { id: true }
    })

    const organizationId = organizationRecord?.id
    if (!organizationId) {
      throw new Error(`Could not resolve organization for booking ${bookingId}`)
    }

    const locationUuid = await resolveLocationUuidForSquareLocationId(locationId)
    if (!locationUuid) {
      throw new Error(`Could not resolve location UUID for Square location ${locationId}`)
    }

    const bookingStartAt = bookingData.start_at || bookingData.startAt
    const status = bookingData.status
    const version = bookingData.version
    const bookingCreatedAt = bookingData.created_at || bookingData.createdAt || eventCreatedAt
    const bookingUpdatedAt = bookingData.updated_at || bookingData.updatedAt || new Date().toISOString()

    const firstSegment = (bookingData.appointment_segments || bookingData.appointmentSegments || [])[0]
    const technicianId = firstSegment?.team_member_id || firstSegment?.teamMemberId
    const serviceVariationId = firstSegment?.service_variation_id || firstSegment?.serviceVariationId
    const serviceVariationVersion = firstSegment?.service_variation_version || firstSegment?.serviceVariationVersion
    const durationMinutes = firstSegment?.duration_minutes || firstSegment?.durationMinutes

    let technicianUuid = null
    if (technicianId) {
      const tm = await prisma.teamMember.findFirst({
        where: { square_team_member_id: technicianId, organization_id: organizationId }
      })
      technicianUuid = tm?.id
    }

    let serviceVariationUuid = null
    if (serviceVariationId) {
      const sv = await prisma.serviceVariation.findFirst({
        where: { square_variation_id: serviceVariationId, organization_id: organizationId }
      })
      serviceVariationUuid = sv?.uuid
    }

    let administratorUuid = null
    const creatorType = bookingData.creator_details?.creator_type || bookingData.creatorDetails?.creatorType
    const creatorId = bookingData.creator_details?.team_member_id || bookingData.creatorDetails?.teamMemberId
    if (creatorType === 'TEAM_MEMBER' && creatorId) {
      const admin = await prisma.teamMember.findFirst({
        where: { square_team_member_id: creatorId, organization_id: organizationId }
      })
      administratorUuid = admin?.id
    }

    await prisma.$executeRaw`
      INSERT INTO bookings (
        id, organization_id, booking_id, customer_id, location_id, start_at, status, version,
        administrator_id, technician_id, service_variation_id, service_variation_version, duration_minutes,
        created_at, updated_at, raw_json
      ) VALUES (
        gen_random_uuid(), ${organizationId}::uuid, ${bookingId}, ${customerId}, ${locationUuid}::uuid, ${bookingStartAt}::timestamptz, ${status}, ${version || 1},
        ${administratorUuid ? Prisma.sql`${administratorUuid}::uuid` : Prisma.sql`NULL`},
        ${technicianUuid ? Prisma.sql`${technicianUuid}::uuid` : Prisma.sql`NULL`},
        ${serviceVariationUuid ? Prisma.sql`${serviceVariationUuid}::uuid` : Prisma.sql`NULL`},
        ${serviceVariationVersion ? serviceVariationVersion : Prisma.sql`NULL`},
        ${durationMinutes || Prisma.sql`NULL`},
        ${bookingCreatedAt}::timestamptz, ${bookingUpdatedAt}::timestamptz, ${safeStringify(bookingData)}::jsonb
      )
      ON CONFLICT (organization_id, booking_id) DO UPDATE SET
        customer_id = COALESCE(EXCLUDED.customer_id, bookings.customer_id),
        location_id = COALESCE(EXCLUDED.location_id, bookings.location_id),
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        start_at = COALESCE(EXCLUDED.start_at, bookings.start_at),
        administrator_id = COALESCE(EXCLUDED.administrator_id, bookings.administrator_id),
        technician_id = COALESCE(EXCLUDED.technician_id, bookings.technician_id),
        service_variation_id = COALESCE(EXCLUDED.service_variation_id, bookings.service_variation_id),
        service_variation_version = COALESCE(EXCLUDED.service_variation_version, bookings.service_variation_version),
        duration_minutes = COALESCE(EXCLUDED.duration_minutes, bookings.duration_minutes),
        updated_at = ${bookingUpdatedAt}::timestamptz,
        raw_json = EXCLUDED.raw_json
    `

    await upsertBookingSegmentsFromPayload(bookingId, organizationId, bookingData)

    // NEW: Create financial snapshot for Master Economics
    try {
      const { upsertBookingSnapshot } = await import('../../../../lib/workers/master-snapshot-service')
    await upsertBookingSnapshot(bookingId, organizationId)
    } catch (snapshotError) {
      console.error(`[WEBHOOK-PROCESSOR] ⚠️ Failed to create booking snapshot:`, snapshotError.message)
    }

    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved booking ${bookingId}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving booking ${bookingId}:`, error.message)
    throw error
  }
}

/**
 * Process booking.updated webhook
 */
export async function processBookingUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processBookingUpdated called for event ${eventId}`)
  return processBookingCreated(payload, eventId, eventCreatedAt)
}
