/**
 * Webhook Processors
 * 
 * These functions are called by the webhook-job-runner cron to process
 * queued webhook events asynchronously.
 */

import prisma from '../../../../lib/prisma-client'
import { Prisma } from '@prisma/client'
import { resolveLocationUuidForSquareLocationId } from '../../../../lib/location-resolver'

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

    const locationUuid = await resolveLocationUuidForSquareLocationId(prisma, locationId, organizationId)
    if (!locationUuid) {
      throw new Error(`Could not resolve location UUID for Square location ${locationId}`)
    }

    const bookingStartAt = bookingData.start_at || bookingData.startAt || new Date()
    const status = bookingData.status || 'ACCEPTED'
    const version = bookingData.version || 0
    const bookingCreatedAt = bookingData.created_at || bookingData.createdAt || eventCreatedAt
    const bookingUpdatedAt = bookingData.updated_at || bookingData.updatedAt || new Date().toISOString()

    const creatorDetails = bookingData.creator_details || bookingData.creatorDetails || {}
    const creatorType = creatorDetails.creator_type || creatorDetails.creatorType
    const creatorCustomerId = creatorDetails.customer_id || creatorDetails.customerId
    const address = bookingData.address || {}
    const finalMerchantId = payload.merchant_id || bookingData.merchant_id || bookingData.merchantId

    const firstSegment = (bookingData.appointment_segments || bookingData.appointmentSegments || [])[0]
    const technicianId = firstSegment?.team_member_id || firstSegment?.teamMemberId
    const serviceVariationId = firstSegment?.service_variation_id || firstSegment?.serviceVariationId
    const serviceVariationVersion = firstSegment?.service_variation_version || firstSegment?.serviceVariationVersion
    const durationMinutes = firstSegment?.duration_minutes || firstSegment?.durationMinutes
    const intermissionMinutes = firstSegment?.intermission_minutes ?? firstSegment?.intermissionMinutes ?? 0
    const anyTeamMember = firstSegment?.any_team_member ?? firstSegment?.anyTeamMember ?? false

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
    const creatorTeamMemberId = creatorDetails.team_member_id || creatorDetails.teamMemberId
    if (creatorType === 'TEAM_MEMBER' && creatorTeamMemberId) {
      const admin = await prisma.teamMember.findFirst({
        where: { square_team_member_id: creatorTeamMemberId, organization_id: organizationId }
      })
      administratorUuid = admin?.id
    }

    await prisma.$executeRaw`
      INSERT INTO bookings (
        id, organization_id, booking_id, version, customer_id, location_id, location_type, source,
        start_at, status, all_day, transition_time_minutes,
        creator_type, creator_customer_id, administrator_id,
        address_line_1, locality, administrative_district_level_1, postal_code,
        service_variation_id, service_variation_version, duration_minutes,
        intermission_minutes, technician_id, any_team_member,
        customer_note, seller_note,
        merchant_id, created_at, updated_at, raw_json
      ) VALUES (
        gen_random_uuid(),
        ${organizationId}::uuid,
        ${bookingId},
        ${version},
        ${customerId},
        ${locationUuid}::uuid,
        ${bookingData.location_type || bookingData.locationType || null},
        ${bookingData.source || null},
        ${bookingStartAt}::timestamptz,
        ${status},
        ${bookingData.all_day ?? bookingData.allDay ?? false},
        ${bookingData.transition_time_minutes ?? bookingData.transitionTimeMinutes ?? 0},
        ${creatorType || null},
        ${creatorCustomerId || null},
        ${administratorUuid ? Prisma.sql`${administratorUuid}::uuid` : Prisma.sql`NULL`},
        ${address.address_line_1 || address.addressLine1 || null},
        ${address.locality || null},
        ${address.administrative_district_level_1 || address.administrativeDistrictLevel1 || null},
        ${address.postal_code || address.postalCode || null},
        ${serviceVariationUuid ? Prisma.sql`${serviceVariationUuid}::uuid` : Prisma.sql`NULL`},
        ${serviceVariationVersion ? serviceVariationVersion : Prisma.sql`NULL`},
        ${durationMinutes || Prisma.sql`NULL`},
        ${intermissionMinutes},
        ${technicianUuid ? Prisma.sql`${technicianUuid}::uuid` : Prisma.sql`NULL`},
        ${anyTeamMember},
        ${bookingData.customer_note || bookingData.customerNote || null},
        ${bookingData.seller_note || bookingData.sellerNote || null},
        ${finalMerchantId || null},
        ${bookingCreatedAt}::timestamptz,
        ${bookingUpdatedAt}::timestamptz,
        ${safeStringify(bookingData)}::jsonb
      )
      ON CONFLICT (organization_id, booking_id) DO UPDATE SET
        version = EXCLUDED.version,
        status = EXCLUDED.status,
        merchant_id = COALESCE(EXCLUDED.merchant_id, bookings.merchant_id),
        service_variation_id = EXCLUDED.service_variation_id,
        service_variation_version = EXCLUDED.service_variation_version,
        technician_id = EXCLUDED.technician_id,
        customer_note = COALESCE(EXCLUDED.customer_note, bookings.customer_note),
        seller_note = COALESCE(EXCLUDED.seller_note, bookings.seller_note),
        updated_at = EXCLUDED.updated_at,
        raw_json = EXCLUDED.raw_json,
        source = COALESCE(bookings.source, EXCLUDED.source),
        customer_id = COALESCE(bookings.customer_id, EXCLUDED.customer_id),
        creator_type = COALESCE(bookings.creator_type, EXCLUDED.creator_type)
    `

    await upsertBookingSegmentsFromPayload(bookingId, organizationId, bookingData)

    // NEW: Create financial snapshot for Master Economics
    try {
      const { upsertBookingSnapshot } = await import('../../../../lib/workers/master-snapshot-service.js')
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

/**
 * Process customer.created webhook
 */
export async function processCustomerCreated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processCustomerCreated called for event ${eventId}`)
  
  const customerData = payload?.object?.customer || payload?.customer || payload
  if (!customerData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No customer ID found in payload`)
    return
  }

  const customerId = customerData.id
  const givenName = cleanValue(customerData.given_name || customerData.givenName)
  const familyName = cleanValue(customerData.family_name || customerData.familyName)
  const emailAddress = cleanValue(customerData.email_address || customerData.emailAddress || customerData.email)
  const phoneNumber = cleanValue(customerData.phone_number || customerData.phoneNumber || customerData.phone)

  console.log(`[WEBHOOK-PROCESSOR] Processing customer ${customerId}: ${givenName} ${familyName}`)

  try {
    let organizationId = null
    const defaultOrg = await prisma.$queryRaw`
      SELECT id FROM organizations WHERE is_active = true ORDER BY created_at LIMIT 1
    `
    if (defaultOrg?.[0]?.id) {
      organizationId = defaultOrg[0].id
    }
    
    if (!organizationId) {
      console.warn(`[WEBHOOK-PROCESSOR] ⚠️ No organization found, skipping customer ${customerId}`)
      return
    }

    await prisma.$executeRaw`
      INSERT INTO square_existing_clients (
        organization_id, square_customer_id, given_name, family_name, email_address, phone_number,
        raw_json, created_at, updated_at
      ) VALUES (
        ${organizationId}::uuid, ${customerId}, ${givenName}, ${familyName}, ${emailAddress}, ${phoneNumber},
        ${JSON.stringify(customerData)}::jsonb, NOW(), NOW()
      )
      ON CONFLICT (organization_id, square_customer_id) DO UPDATE SET
        given_name = COALESCE(EXCLUDED.given_name, square_existing_clients.given_name),
        family_name = COALESCE(EXCLUDED.family_name, square_existing_clients.family_name),
        email_address = COALESCE(EXCLUDED.email_address, square_existing_clients.email_address),
        phone_number = COALESCE(EXCLUDED.phone_number, square_existing_clients.phone_number),
        raw_json = EXCLUDED.raw_json,
        updated_at = NOW()
    `

    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved customer ${customerId}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving customer ${customerId}:`, error.message)
    throw error
  }
}

/**
 * Process payment.updated webhook
 */
export async function processPaymentUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processPaymentUpdated called for event ${eventId}`)
  
  const paymentData = payload?.object?.payment || payload?.payment || payload
  if (!paymentData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No payment ID found in payload`)
    return
  }

  try {
    const { savePaymentToDatabase } = await import('./route.js')
    await savePaymentToDatabase(paymentData, 'payment.updated', eventId, eventCreatedAt)
    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved payment ${paymentData.id}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving payment ${paymentData.id}:`, error.message)
    throw error
  }
}

/**
 * Process order.updated webhook
 */
export async function processOrderUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processOrderUpdated called for event ${eventId}`)
  
  const orderData = payload?.object?.order || payload?.order || payload
  if (!orderData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No order ID found in payload`)
    return
  }

  try {
    const { processOrderWebhook } = await import('./route.js')
    await processOrderWebhook(payload, 'order.updated', payload.merchant_id, `webhook-job-${eventId}`)
    console.log(`[WEBHOOK-PROCESSOR] ✅ Processed order ${orderData.id}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error processing order ${orderData.id}:`, error.message)
    throw error
  }
}

/**
 * Process team_member.created webhook
 */
export async function processTeamMemberCreated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processTeamMemberCreated called for event ${eventId}`)
  
  const teamMemberData = payload?.object?.team_member || payload?.team_member || payload
  if (!teamMemberData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No team member ID found in payload`)
    return
  }

  const teamMemberId = teamMemberData.id
  const givenName = cleanValue(teamMemberData.given_name || teamMemberData.givenName)
  const familyName = cleanValue(teamMemberData.family_name || teamMemberData.familyName)
  const emailAddress = cleanValue(teamMemberData.email_address || teamMemberData.emailAddress)
  const phoneNumber = cleanValue(teamMemberData.phone_number || teamMemberData.phoneNumber)
  const status = cleanValue(teamMemberData.status)

  console.log(`[WEBHOOK-PROCESSOR] Processing team member ${teamMemberId}: ${givenName} ${familyName}`)

  try {
    let organizationId = null
    const defaultOrg = await prisma.$queryRaw`
      SELECT id FROM organizations WHERE is_active = true ORDER BY created_at LIMIT 1
    `
    if (defaultOrg?.[0]?.id) {
      organizationId = defaultOrg[0].id
    }
    
    if (!organizationId) {
      console.warn(`[WEBHOOK-PROCESSOR] ⚠️ No organization found, skipping team member ${teamMemberId}`)
      return
    }

    await prisma.$executeRaw`
      INSERT INTO team_members (
        id, organization_id, square_team_member_id, given_name, family_name, email_address, phone_number, status,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${organizationId}::uuid, ${teamMemberId}, ${givenName}, ${familyName}, ${emailAddress}, ${phoneNumber}, ${status},
        NOW(), NOW()
      )
      ON CONFLICT (organization_id, square_team_member_id) DO UPDATE SET
        given_name = COALESCE(EXCLUDED.given_name, team_members.given_name),
        family_name = COALESCE(EXCLUDED.family_name, team_members.family_name),
        email_address = COALESCE(EXCLUDED.email_address, team_members.email_address),
        phone_number = COALESCE(EXCLUDED.phone_number, team_members.phone_number),
        status = EXCLUDED.status,
        updated_at = NOW()
    `

    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved team member ${teamMemberId}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving team member ${teamMemberId}:`, error.message)
    throw error
  }
}

// Placeholder functions for other event types
export async function processGiftCardActivityCreated() {}
export async function processGiftCardActivityUpdated() {}
export async function processGiftCardCustomerLinked() {}
export async function processGiftCardUpdated() {}
export async function processRefundCreated() {}
export async function processRefundUpdated() {}
