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
        start_at = EXCLUDED.start_at,
        all_day = EXCLUDED.all_day,
        location_id = EXCLUDED.location_id,
        location_type = EXCLUDED.location_type,
        transition_time_minutes = EXCLUDED.transition_time_minutes,
        duration_minutes = EXCLUDED.duration_minutes,
        intermission_minutes = EXCLUDED.intermission_minutes,
        any_team_member = EXCLUDED.any_team_member,
        administrator_id = EXCLUDED.administrator_id,
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
        creator_type = COALESCE(bookings.creator_type, EXCLUDED.creator_type),
        address_line_1 = COALESCE(EXCLUDED.address_line_1, bookings.address_line_1),
        locality = COALESCE(EXCLUDED.locality, bookings.locality),
        administrative_district_level_1 = COALESCE(EXCLUDED.administrative_district_level_1, bookings.administrative_district_level_1),
        postal_code = COALESCE(EXCLUDED.postal_code, bookings.postal_code),
        creator_customer_id = COALESCE(EXCLUDED.creator_customer_id, bookings.creator_customer_id)
    `

    await upsertBookingSegmentsFromPayload(bookingId, organizationId, bookingData)

    // NEW: Create financial snapshot for Master Economics
    try {
      const { upsertBookingSnapshot } = await import('../../../../lib/workers/master-snapshot-service.js')
      await upsertBookingSnapshot(bookingId, organizationId)
    } catch (snapshotError) {
      console.error(`[WEBHOOK-PROCESSOR] ⚠️ Failed to create booking snapshot:`, snapshotError.message)
    }

    // Recalculate square_existing_clients.first_visit_at and refresh customer_analytics
    // for this customer. Without this, queue-path booking updates leave first_visit_at
    // and customer_analytics stale (e.g. when a booking is rescheduled).
    if (customerId && organizationId) {
      try {
        const earliest = await prisma.$queryRaw`
          SELECT MIN(start_at) AS min_start
          FROM bookings
          WHERE customer_id = ${customerId}
            AND organization_id = ${organizationId}::uuid
            AND status IN ('ACCEPTED', 'COMPLETED')
        `
        const minStart = earliest[0]?.min_start || null
        if (minStart) {
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET first_visit_at = ${minStart}::timestamptz, updated_at = NOW()
            WHERE square_customer_id = ${customerId}
              AND organization_id = ${organizationId}::uuid
          `
        } else {
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET first_visit_at = NULL, updated_at = NOW()
            WHERE square_customer_id = ${customerId}
              AND organization_id = ${organizationId}::uuid
          `
        }
      } catch (firstVisitError) {
        console.warn(`[WEBHOOK-PROCESSOR] ⚠️ Failed to update first_visit_at for ${customerId}:`, firstVisitError.message)
      }

      try {
        const { refreshCustomerAnalyticsForSingleCustomer } = await import('../../../../lib/analytics/refresh-single-customer-analytics.js')
        await refreshCustomerAnalyticsForSingleCustomer(organizationId, customerId)
      } catch (analyticsError) {
        console.warn(`[WEBHOOK-PROCESSOR] ⚠️ Failed to refresh customer_analytics for ${customerId}:`, analyticsError.message)
      }
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
/**
 * Process refund.created webhook
 * Creates REVERSAL entries in the MasterEarningsLedger to negate commission/tips.
 */
export async function processRefundCreated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processRefundCreated called for event ${eventId}`)

  const refundData = payload?.object?.refund || payload?.refund || payload
  if (!refundData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No refund ID found in payload`)
    return
  }

  const refundId = refundData.id
  const paymentId = refundData.payment_id || refundData.paymentId
  const refundStatus = refundData.status
  const refundAmountCents = refundData.amount_money?.amount
    ? (typeof refundData.amount_money.amount === 'bigint'
        ? Number(refundData.amount_money.amount)
        : Number(refundData.amount_money.amount))
    : 0

  if (!paymentId) {
    console.warn(`[WEBHOOK-PROCESSOR] Refund ${refundId} has no payment_id, skipping`)
    return
  }

  // Only process completed/approved refunds
  if (refundStatus && !['COMPLETED', 'APPROVED'].includes(refundStatus)) {
    console.log(`[WEBHOOK-PROCESSOR] Refund ${refundId} status is ${refundStatus}, skipping`)
    return
  }

  try {
    // Idempotency: check if REVERSAL already exists for this refund
    const existingReversal = await prisma.$queryRaw`
      SELECT id FROM master_earnings_ledger
      WHERE entry_type = 'REVERSAL'
        AND meta_json->>'refund_id' = ${refundId}
      LIMIT 1
    `
    if (existingReversal?.length > 0) {
      console.log(`[WEBHOOK-PROCESSOR] REVERSAL for refund ${refundId} already exists, skipping`)
      return
    }

    // Find the payment and its booking
    const payment = await prisma.payment.findFirst({
      where: { payment_id: paymentId }
    })
    if (!payment?.booking_id) {
      console.warn(`[WEBHOOK-PROCESSOR] Payment ${paymentId} not found or has no booking, skipping refund reversal`)
      return
    }

    // Find all ledger entries for this booking
    const originalEntries = await prisma.masterEarningsLedger.findMany({
      where: {
        booking_id: payment.booking_id,
        entry_type: { in: ['SERVICE_COMMISSION', 'TIP', 'DISCOUNT_ADJUSTMENT'] }
      }
    })

    if (originalEntries.length === 0) {
      console.log(`[WEBHOOK-PROCESSOR] No ledger entries found for booking ${payment.booking_id}, skipping refund`)
      return
    }

    // Determine refund ratio (for partial refunds)
    const totalPaymentAmount = payment.total_money_amount || 0
    const isFullRefund = refundAmountCents >= totalPaymentAmount || refundAmountCents === 0
    const refundRatio = isFullRefund ? 1.0 : (totalPaymentAmount > 0 ? refundAmountCents / totalPaymentAmount : 1.0)

    const reversalEntries = []
    for (const entry of originalEntries) {
      const reversalAmount = isFullRefund
        ? -entry.amount_amount
        : -Math.round(entry.amount_amount * refundRatio)

      if (reversalAmount === 0) continue

      reversalEntries.push({
        organization_id: entry.organization_id,
        team_member_id: entry.team_member_id,
        booking_id: entry.booking_id,
        entry_type: 'REVERSAL',
        amount_amount: reversalAmount,
        source_engine: 'REFUND_ENGINE',
        meta_json: {
          refund_id: refundId,
          refund_payment_id: paymentId,
          refund_amount_cents: refundAmountCents,
          refund_ratio: refundRatio,
          reversed_entry_id: entry.id,
          reversed_entry_type: entry.entry_type,
          reversed_amount: entry.amount_amount
        }
      })
    }

    if (reversalEntries.length > 0) {
      await prisma.masterEarningsLedger.createMany({ data: reversalEntries })
      console.log(`[WEBHOOK-PROCESSOR] ✅ Created ${reversalEntries.length} REVERSAL entries for refund ${refundId} (ratio: ${refundRatio})`)
    }

    // Re-fetch the payment from Square API to refresh raw_json with the now-
    // populated `refunded_money` field. The analytics revenue view subtracts
    // refunds via `LEAST(raw_json->refunded_money, amount_money)`, and that
    // field is only populated by Square once a refund has been issued — so
    // without this resync, our view will not see the refund and over-count
    // revenue. savePaymentToDatabase already does a fresh API fetch internally
    // (added in 5f09fd4), so a stub `{id: paymentId}` is enough.
    //
    // Wrapped in its own try/catch: if the resync fails for any reason, the
    // REVERSAL ledger entries above are still committed (the more important
    // bookkeeping). A daily cron of scripts/reconcile-stale-payment-statuses.js
    // is the safety net for any failures here.
    try {
      const { savePaymentToDatabase } = await import('./route.js')
      await savePaymentToDatabase({ id: paymentId }, 'refund.created.payment_resync', eventId, eventCreatedAt)
      console.log(`[WEBHOOK-PROCESSOR] ✅ Resynced payment ${paymentId} after refund (refunded_money now in raw_json)`)
    } catch (resyncError) {
      console.warn(`[WEBHOOK-PROCESSOR] ⚠️ Failed to resync payment ${paymentId} after refund: ${resyncError.message}`)
    }
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error processing refund ${refundId}:`, error.message)
    throw error
  }
}

/**
 * Process refund.updated webhook — delegates to processRefundCreated (idempotent).
 */
export async function processRefundUpdated(payload, eventId, eventCreatedAt) {
  return processRefundCreated(payload, eventId, eventCreatedAt)
}

/**
 * Process dispute.created webhook
 * When a customer disputes a payment, freeze the master's earnings for that booking
 * by creating DISPUTE_HOLD entries (negative amounts matching original earnings).
 *
 * Square dispute states: INQUIRY_EVIDENCE_REQUIRED, INQUIRY_PROCESSING, INQUIRY_CLOSED,
 *   EVIDENCE_REQUIRED, PROCESSING, WON, LOST, ACCEPTED
 */
export async function processDisputeCreated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processDisputeCreated called for event ${eventId}`)

  const disputeData = payload?.object?.dispute || payload?.dispute || payload
  if (!disputeData?.id && !disputeData?.dispute_id) {
    console.warn(`[WEBHOOK-PROCESSOR] No dispute ID found in payload`)
    return
  }

  const disputeId = disputeData.id || disputeData.dispute_id
  const paymentId = disputeData.payment_id || disputeData.disputed_payment?.payment_id
  const disputeState = disputeData.state || disputeData.status
  const disputeAmountCents = disputeData.amount_money?.amount
    ? Number(disputeData.amount_money.amount)
    : (disputeData.disputed_payment?.amount ? Number(disputeData.disputed_payment.amount) : 0)

  console.log(`[WEBHOOK-PROCESSOR] Dispute ${disputeId}: state=${disputeState}, payment=${paymentId}, amount=${disputeAmountCents}`)

  if (!paymentId) {
    console.warn(`[WEBHOOK-PROCESSOR] Dispute ${disputeId} has no payment_id, skipping`)
    return
  }

  try {
    // Idempotency: check if DISPUTE_HOLD already exists for this dispute
    const existingHold = await prisma.$queryRaw`
      SELECT id FROM master_earnings_ledger
      WHERE entry_type = 'DISPUTE_HOLD'
        AND meta_json->>'dispute_id' = ${disputeId}
      LIMIT 1
    `
    if (existingHold?.length > 0) {
      console.log(`[WEBHOOK-PROCESSOR] DISPUTE_HOLD for dispute ${disputeId} already exists, skipping`)
      return
    }

    // Find the payment and its booking
    const payment = await prisma.payment.findFirst({
      where: { payment_id: paymentId }
    })
    if (!payment?.booking_id) {
      console.warn(`[WEBHOOK-PROCESSOR] Payment ${paymentId} not found or has no booking, skipping dispute hold`)
      return
    }

    // Find all earnings ledger entries for this booking (commission, tips, discount adj)
    const originalEntries = await prisma.masterEarningsLedger.findMany({
      where: {
        booking_id: payment.booking_id,
        entry_type: { in: ['SERVICE_COMMISSION', 'TIP', 'DISCOUNT_ADJUSTMENT'] }
      }
    })

    if (originalEntries.length === 0) {
      console.log(`[WEBHOOK-PROCESSOR] No ledger entries found for booking ${payment.booking_id}, skipping dispute hold`)
      return
    }

    // Create DISPUTE_HOLD entries (freeze = negate original amounts)
    const holdEntries = []
    for (const entry of originalEntries) {
      if (entry.amount_amount === 0) continue
      holdEntries.push({
        organization_id: entry.organization_id,
        team_member_id: entry.team_member_id,
        booking_id: entry.booking_id,
        entry_type: 'DISPUTE_HOLD',
        amount_amount: -entry.amount_amount,
        source_engine: 'DISPUTE_ENGINE',
        meta_json: {
          dispute_id: disputeId,
          dispute_state: disputeState,
          dispute_payment_id: paymentId,
          dispute_amount_cents: disputeAmountCents,
          held_entry_id: entry.id,
          held_entry_type: entry.entry_type,
          held_amount: entry.amount_amount
        }
      })
    }

    if (holdEntries.length > 0) {
      await prisma.masterEarningsLedger.createMany({ data: holdEntries })
      console.log(`[WEBHOOK-PROCESSOR] ✅ Created ${holdEntries.length} DISPUTE_HOLD entries for dispute ${disputeId}`)
    }
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error processing dispute ${disputeId}:`, error.message)
    throw error
  }
}

/**
 * Process dispute.state.updated / dispute.state.changed webhook
 *
 * Outcomes:
 * - WON → merchant wins, release the hold (create DISPUTE_RELEASE to restore earnings)
 * - LOST / ACCEPTED → merchant loses, hold stays (money gone, same as refund)
 * - Other states (PROCESSING, EVIDENCE_REQUIRED) → no action, hold remains
 */
export async function processDisputeStateUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processDisputeStateUpdated called for event ${eventId}`)

  const disputeData = payload?.object?.dispute || payload?.dispute || payload
  if (!disputeData?.id && !disputeData?.dispute_id) {
    console.warn(`[WEBHOOK-PROCESSOR] No dispute ID found in state update payload`)
    return
  }

  const disputeId = disputeData.id || disputeData.dispute_id
  const newState = disputeData.state || disputeData.status
  console.log(`[WEBHOOK-PROCESSOR] Dispute ${disputeId} state updated to: ${newState}`)

  if (!newState) return

  const upperState = newState.toUpperCase()

  if (upperState === 'WON') {
    // Merchant won — release the hold (restore earnings)
    try {
      // Idempotency: check if DISPUTE_RELEASE already exists
      const existingRelease = await prisma.$queryRaw`
        SELECT id FROM master_earnings_ledger
        WHERE entry_type = 'DISPUTE_RELEASE'
          AND meta_json->>'dispute_id' = ${disputeId}
        LIMIT 1
      `
      if (existingRelease?.length > 0) {
        console.log(`[WEBHOOK-PROCESSOR] DISPUTE_RELEASE for dispute ${disputeId} already exists, skipping`)
        return
      }

      // Find all DISPUTE_HOLD entries for this dispute
      const holdEntries = await prisma.$queryRaw`
        SELECT id, organization_id, team_member_id, booking_id, amount_amount, meta_json
        FROM master_earnings_ledger
        WHERE entry_type = 'DISPUTE_HOLD'
          AND meta_json->>'dispute_id' = ${disputeId}
      `

      if (!holdEntries?.length) {
        console.log(`[WEBHOOK-PROCESSOR] No DISPUTE_HOLD entries found for dispute ${disputeId}`)
        return
      }

      // Create DISPUTE_RELEASE entries (negate the holds = restore original amounts)
      const releaseEntries = holdEntries.map((hold) => ({
        organization_id: hold.organization_id,
        team_member_id: hold.team_member_id,
        booking_id: hold.booking_id,
        entry_type: 'DISPUTE_RELEASE',
        amount_amount: -Number(hold.amount_amount),
        source_engine: 'DISPUTE_ENGINE',
        meta_json: {
          dispute_id: disputeId,
          dispute_state: 'WON',
          released_hold_id: hold.id
        }
      }))

      await prisma.masterEarningsLedger.createMany({ data: releaseEntries })
      console.log(`[WEBHOOK-PROCESSOR] ✅ Dispute ${disputeId} WON — created ${releaseEntries.length} DISPUTE_RELEASE entries (earnings restored)`)
    } catch (error) {
      console.error(`[WEBHOOK-PROCESSOR] ❌ Error releasing dispute ${disputeId}:`, error.message)
      throw error
    }
  } else if (upperState === 'LOST' || upperState === 'ACCEPTED') {
    // Merchant lost — hold stays, earnings are permanently deducted
    // No additional action needed; DISPUTE_HOLD already reduced the salary
    console.log(`[WEBHOOK-PROCESSOR] Dispute ${disputeId} ${upperState} — DISPUTE_HOLD entries remain as permanent deduction`)
  } else {
    // PROCESSING, EVIDENCE_REQUIRED, INQUIRY_* — no action
    console.log(`[WEBHOOK-PROCESSOR] Dispute ${disputeId} state ${newState} — no salary action needed`)
  }
}

/**
 * Alias: dispute.state.changed → same handler as dispute.state.updated
 */
export async function processDisputeStateChanged(payload, eventId, eventCreatedAt) {
  return processDisputeStateUpdated(payload, eventId, eventCreatedAt)
}
