/**
 * Webhook Processors
 * 
 * These functions are called by the webhook-job-runner cron to process
 * queued webhook events asynchronously.
 */

import prisma from '../../../../lib/prisma-client'
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
      AND organization_id = ${organizationId}::text
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
      AND is_active = true
      AND booking_version != ${bookingVersion}
  `

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] || {}
    const segmentIndex = i
    const squareServiceVariationId = segment.service_variation_id || segment.serviceVariationId || null
    const squareTeamMemberId = segment.team_member_id || segment.teamMemberId || null
    const squareSegmentUid = segment.segment_uid || segment.uid || segment.id || null

    let serviceVariationUuid = null
    if (squareServiceVariationId) {
      const svRecord = await prisma.$queryRaw`
        SELECT uuid::text as id FROM service_variation
        WHERE square_variation_id = ${squareServiceVariationId}
          AND organization_id = ${organizationId}::text
        LIMIT 1
      `
      serviceVariationUuid = svRecord?.[0]?.id || null
    }

    let technicianUuid = null
    if (squareTeamMemberId) {
      const tmRecord = await prisma.$queryRaw`
        SELECT id::text as id FROM team_members
        WHERE square_team_member_id = ${squareTeamMemberId}
          AND organization_id = ${organizationId}::text
        LIMIT 1
      `
      technicianUuid = tmRecord?.[0]?.id || null
    }

    const anyTeamMember = segment.any_team_member ?? segment.anyTeamMember ?? false
    const durationMinutes = segment.duration_minutes || segment.durationMinutes || null
    const intermissionMinutes = segment.intermission_minutes || segment.intermissionMinutes || 0
    const serviceVariationVersion = segment.service_variation_version || segment.serviceVariationVersion || null

    // Extract booking times from bookingData
    const bookingCreatedAt = bookingData?.created_at || bookingData?.createdAt || null
    const bookingStartAt = bookingData?.start_at || bookingData?.startAt || null

    await prisma.$executeRaw`
      INSERT INTO booking_segments (
        id,
        booking_id,
        segment_index,
        square_segment_uid,
        square_service_variation_id,
        service_variation_id,
        service_variation_version,
        duration_minutes,
        intermission_minutes,
        square_team_member_id,
        technician_id,
        any_team_member,
        booking_version,
        booking_created_at,
        booking_start_at,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        ${bookingUuid}::uuid,
        ${segmentIndex},
        ${squareSegmentUid},
        ${squareServiceVariationId},
        ${serviceVariationUuid}::uuid,
        ${serviceVariationVersion ? BigInt(serviceVariationVersion) : null},
        ${durationMinutes},
        ${intermissionMinutes},
        ${squareTeamMemberId},
        ${technicianUuid}::uuid,
        ${anyTeamMember},
        ${bookingVersion},
        ${bookingCreatedAt ? new Date(bookingCreatedAt) : null}::timestamp,
        ${bookingStartAt ? new Date(bookingStartAt) : null}::timestamp,
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (booking_id, segment_index, booking_version) DO UPDATE SET
        square_segment_uid = COALESCE(EXCLUDED.square_segment_uid, booking_segments.square_segment_uid),
        square_service_variation_id = COALESCE(EXCLUDED.square_service_variation_id, booking_segments.square_service_variation_id),
        service_variation_id = COALESCE(EXCLUDED.service_variation_id, booking_segments.service_variation_id),
        service_variation_version = COALESCE(EXCLUDED.service_variation_version, booking_segments.service_variation_version),
        duration_minutes = COALESCE(EXCLUDED.duration_minutes, booking_segments.duration_minutes),
        intermission_minutes = COALESCE(EXCLUDED.intermission_minutes, booking_segments.intermission_minutes),
        square_team_member_id = COALESCE(EXCLUDED.square_team_member_id, booking_segments.square_team_member_id),
        technician_id = COALESCE(EXCLUDED.technician_id, booking_segments.technician_id),
        any_team_member = COALESCE(EXCLUDED.any_team_member, booking_segments.any_team_member),
        booking_created_at = COALESCE(EXCLUDED.booking_created_at, booking_segments.booking_created_at),
        booking_start_at = COALESCE(EXCLUDED.booking_start_at, booking_segments.booking_start_at),
        is_active = true,
        deleted_at = NULL,
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
  
  const bookingData = payload?.object?.booking || payload?.booking || payload
  if (!bookingData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No booking ID found in payload`)
    return
  }

  const bookingId = bookingData.id
  const customerId = bookingData.customer_id || bookingData.customerId
  const locationId = bookingData.location_id || bookingData.locationId
  const status = bookingData.status
  const version = bookingData.version

  // Extract Square's created_at from booking data (use it instead of NOW())
  const squareCreatedAt = bookingData.created_at || bookingData.createdAt
  const squareUpdatedAt = bookingData.updated_at || bookingData.updatedAt
  const bookingCreatedAt = squareCreatedAt ? new Date(squareCreatedAt) : new Date()
  const bookingUpdatedAt = squareUpdatedAt ? new Date(squareUpdatedAt) : new Date()

  console.log(`[WEBHOOK-PROCESSOR] Processing booking ${bookingId} for customer ${customerId}`)

  try {
    // Resolve organization and location UUID from square_location_id
    let organizationId = null
    let locationUuid = null
    if (locationId) {
      const location = await prisma.$queryRaw`
        SELECT organization_id FROM locations WHERE square_location_id = ${locationId} LIMIT 1
      `
      if (location?.[0]?.organization_id) {
        organizationId = location[0].organization_id
        locationUuid = await resolveLocationUuidForSquareLocationId(prisma, locationId, organizationId)
      }
    }
    
    if (!organizationId) {
      console.warn(`[WEBHOOK-PROCESSOR] ⚠️ Could not resolve organization for location ${locationId}`)
      return
    }

    if (!locationUuid) {
      console.warn(`[WEBHOOK-PROCESSOR] ⚠️ Could not resolve location UUID for ${locationId}`)
      return
    }

    // Insert or update booking (location_id is internal UUID)
    // Use Square's created_at from booking data, not NOW()
    await prisma.$executeRaw`
      INSERT INTO bookings (
        id, organization_id, booking_id, customer_id, location_id, status, version,
        created_at, updated_at, raw_json
      ) VALUES (
        gen_random_uuid(), ${organizationId}::text, ${bookingId}, ${customerId}, ${locationUuid}::uuid, ${status}, ${version || 1},
        ${bookingCreatedAt}::timestamp, ${bookingUpdatedAt}::timestamp, ${safeStringify(bookingData)}::jsonb
      )
      ON CONFLICT (organization_id, booking_id) DO UPDATE SET
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        updated_at = ${bookingUpdatedAt}::timestamp,
        raw_json = EXCLUDED.raw_json
    `

    await upsertBookingSegmentsFromPayload(bookingId, organizationId, bookingData)

    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved booking ${bookingId}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving booking ${bookingId}:`, error.message)
    throw error
  }
}

/**
 * Process booking.updated webhook
 * Updates existing booking in database
 */
export async function processBookingUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processBookingUpdated called for event ${eventId}`)
  
  // Reuse the same logic as booking.created (upsert handles both)
  await processBookingCreated(payload, eventId, eventCreatedAt)
}

/**
 * Process customer.created webhook
 * Saves new customer to database
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
    // Get default organization for new customers
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

    // Insert or update customer in square_existing_clients
    await prisma.$executeRaw`
      INSERT INTO square_existing_clients (
        organization_id, square_customer_id, given_name, family_name, email_address, phone_number,
        created_at, updated_at
      ) VALUES (
        ${organizationId}::text, ${customerId}, ${givenName}, ${familyName}, ${emailAddress}, ${phoneNumber},
        NOW(), NOW()
      )
      ON CONFLICT (square_customer_id) DO UPDATE SET
        given_name = COALESCE(EXCLUDED.given_name, square_existing_clients.given_name),
        family_name = COALESCE(EXCLUDED.family_name, square_existing_clients.family_name),
        email_address = COALESCE(EXCLUDED.email_address, square_existing_clients.email_address),
        phone_number = COALESCE(EXCLUDED.phone_number, square_existing_clients.phone_number),
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
 * Updates payment status in database
 * NOTE: This is a simplified version for the cron retry system.
 * The main webhook route's savePaymentToDatabase is more comprehensive.
 */
export async function processPaymentUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processPaymentUpdated called for event ${eventId}`)
  
  const paymentData = payload?.object?.payment || payload?.payment || payload
  if (!paymentData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No payment ID found in payload`)
    return
  }

  const paymentId = paymentData.id
  const status = paymentData.status
  const orderId = paymentData.order_id || paymentData.orderId
  const customerId = paymentData.customer_id || paymentData.customerId
  const locationId = paymentData.location_id || paymentData.locationId
  const amountMoney = paymentData.amount_money || paymentData.amountMoney || {}
  const totalMoney = paymentData.total_money || paymentData.totalMoney || amountMoney

  console.log(`[WEBHOOK-PROCESSOR] Processing payment ${paymentId} status: ${status}`)

  try {
    // Resolve organization and location UUID from square_location_id
    let organizationId = null
    let locationUuid = null
    if (locationId) {
      const location = await prisma.$queryRaw`
        SELECT id, organization_id FROM locations WHERE square_location_id = ${locationId} LIMIT 1
      `
      if (location?.[0]) {
        organizationId = location[0].organization_id
        locationUuid = location[0].id
      }
    }
    
    if (!organizationId) {
      console.warn(`[WEBHOOK-PROCESSOR] ⚠️ Could not resolve organization for location ${locationId}`)
      return
    }

    // Update payment in database with correct column names
    await prisma.$executeRaw`
      INSERT INTO payments (
        id, organization_id, payment_id, customer_id, location_id, status,
        amount_money_amount, amount_money_currency, total_money_amount, total_money_currency,
        event_type, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${organizationId}::text, ${paymentId}, ${customerId}, ${locationUuid}::uuid, ${status},
        ${Number(amountMoney.amount || 0)}, ${amountMoney.currency || 'USD'},
        ${Number(totalMoney.amount || 0)}, ${totalMoney.currency || 'USD'},
        'payment.updated', NOW(), NOW()
      )
      ON CONFLICT (organization_id, payment_id) DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = NOW()
    `

    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved payment ${paymentId}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving payment ${paymentId}:`, error.message)
    throw error
  }
}

/**
 * Process gift_card.activity.created webhook
 * Tracks gift card loads, redeems, etc.
 */
export async function processGiftCardActivityCreated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processGiftCardActivityCreated called for event ${eventId}`)
  
  const activityData = payload?.object?.gift_card_activity || payload?.gift_card_activity || payload
  if (!activityData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No gift card activity ID found in payload`)
    return
  }

  const activityId = activityData.id
  const giftCardId = activityData.gift_card_id || activityData.giftCardId
  const giftCardGan = activityData.gift_card_gan || activityData.giftCardGan
  const activityType = activityData.type
  const locationId = activityData.location_id || activityData.locationId

  console.log(`[WEBHOOK-PROCESSOR] Processing gift card activity ${activityId}: ${activityType}`)

  try {
    // Get amount based on activity type
    let amountCents = 0
    if (activityData.activate_activity_details) {
      amountCents = Number(activityData.activate_activity_details.amount_money?.amount || 0)
    } else if (activityData.load_activity_details) {
      amountCents = Number(activityData.load_activity_details.amount_money?.amount || 0)
    } else if (activityData.redeem_activity_details) {
      amountCents = -Number(activityData.redeem_activity_details.amount_money?.amount || 0)
    } else if (activityData.adjust_increment_activity_details) {
      amountCents = Number(activityData.adjust_increment_activity_details.amount_money?.amount || 0)
    } else if (activityData.adjust_decrement_activity_details) {
      amountCents = -Number(activityData.adjust_decrement_activity_details.amount_money?.amount || 0)
    }

    // Look up the internal gift_card_id from gift_cards table
    let internalGiftCardId = null
    if (giftCardId) {
      const gcRecord = await prisma.$queryRaw`
        SELECT id FROM gift_cards WHERE square_gift_card_id = ${giftCardId} LIMIT 1
      `
      if (gcRecord?.[0]?.id) {
        internalGiftCardId = gcRecord[0].id
      }
    }
    // Fallback: try by GAN if no match by ID
    if (!internalGiftCardId && giftCardGan) {
      const gcByGan = await prisma.$queryRaw`
        SELECT id FROM gift_cards WHERE gift_card_gan = ${giftCardGan} LIMIT 1
      `
      if (gcByGan?.[0]?.id) {
        internalGiftCardId = gcByGan[0].id
      }
    }

    if (!internalGiftCardId) {
      console.warn(`[WEBHOOK-PROCESSOR] ⚠️ Gift card not found in database: ${giftCardId || giftCardGan}`)
      console.warn(`[WEBHOOK-PROCESSOR] ⚠️ Skipping transaction insert - gift card needs to be created first`)
      return
    }

    // Get balance info from activity data
    const balanceAfterCents = activityData.gift_card_balance_money 
      ? Number(activityData.gift_card_balance_money.amount || 0)
      : null

    // Insert gift card transaction
    await prisma.$executeRaw`
      INSERT INTO gift_card_transactions (
        id, gift_card_id, transaction_type, amount_cents, balance_after_cents,
        square_activity_id, reason, created_at
      ) VALUES (
        gen_random_uuid(), ${internalGiftCardId}::uuid, ${activityType}, ${amountCents}, ${balanceAfterCents},
        ${activityId}, 'WEBHOOK', NOW()
      )
      ON CONFLICT (square_activity_id) DO NOTHING
    `

    // Update gift card balance if we have the GAN
    if (giftCardGan && activityData.gift_card_balance_money) {
      const balanceCents = Number(activityData.gift_card_balance_money.amount || 0)
      await prisma.$executeRaw`
        UPDATE gift_cards 
        SET current_balance_cents = ${balanceCents}, 
            last_balance_check_at = NOW(),
            updated_at = NOW()
        WHERE gift_card_gan = ${giftCardGan}
      `
    }

    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved gift card activity ${activityId}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving gift card activity ${activityId}:`, error.message)
    throw error
  }
}

/**
 * Process gift_card.activity.updated webhook
 */
export async function processGiftCardActivityUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processGiftCardActivityUpdated called for event ${eventId}`)
  // Reuse activity created logic (upsert handles both)
  await processGiftCardActivityCreated(payload, eventId, eventCreatedAt)
}

/**
 * Process gift_card.customer_linked webhook
 * Links gift card to customer profile
 */
export async function processGiftCardCustomerLinked(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processGiftCardCustomerLinked called for event ${eventId}`)
  
  const giftCardData = payload?.object?.gift_card || payload?.gift_card || payload
  if (!giftCardData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No gift card ID found in payload`)
    return
  }

  const giftCardId = giftCardData.id
  const giftCardGan = giftCardData.gan
  const customerIds = giftCardData.customer_ids || []

  console.log(`[WEBHOOK-PROCESSOR] Linking gift card ${giftCardGan} to ${customerIds.length} customer(s)`)

  try {
    for (const customerId of customerIds) {
      await prisma.$executeRaw`
        UPDATE gift_cards 
        SET customer_id = ${customerId}, updated_at = NOW()
        WHERE square_gift_card_id = ${giftCardId} OR gift_card_gan = ${giftCardGan}
      `
    }

    console.log(`[WEBHOOK-PROCESSOR] ✅ Linked gift card ${giftCardGan}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error linking gift card ${giftCardGan}:`, error.message)
    throw error
  }
}

/**
 * Process gift_card.updated webhook
 * Syncs gift card balance/status
 */
export async function processGiftCardUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processGiftCardUpdated called for event ${eventId}`)
  
  const giftCardData = payload?.object?.gift_card || payload?.gift_card || payload
  if (!giftCardData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No gift card ID found in payload`)
    return
  }

  const giftCardId = giftCardData.id
  const giftCardGan = giftCardData.gan
  const state = giftCardData.state
  const balanceMoney = giftCardData.balance_money || giftCardData.balanceMoney || {}
  const balanceCents = Number(balanceMoney.amount || 0)

  console.log(`[WEBHOOK-PROCESSOR] Updating gift card ${giftCardGan} state: ${state}, balance: ${balanceCents}`)

  try {
    await prisma.$executeRaw`
      UPDATE gift_cards 
      SET state = ${state},
          current_balance_cents = ${balanceCents},
          last_balance_check_at = NOW(),
          updated_at = NOW()
      WHERE square_gift_card_id = ${giftCardId} OR gift_card_gan = ${giftCardGan}
    `

    console.log(`[WEBHOOK-PROCESSOR] ✅ Updated gift card ${giftCardGan}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error updating gift card ${giftCardGan}:`, error.message)
    throw error
  }
}

/**
 * Process refund.created webhook
 * Tracks refunds (may need to reverse referral rewards)
 * NOTE: No refunds table exists yet - just logging for now
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
  const orderId = refundData.order_id || refundData.orderId
  const status = refundData.status
  const amountMoney = refundData.amount_money || refundData.amountMoney || {}

  console.log(`[WEBHOOK-PROCESSOR] Processing refund ${refundId} for payment ${paymentId}`)
  console.log(`[WEBHOOK-PROCESSOR] Refund amount: $${(Number(amountMoney.amount || 0) / 100).toFixed(2)} ${amountMoney.currency || 'USD'}`)
  console.log(`[WEBHOOK-PROCESSOR] Refund status: ${status}`)

  try {
    // NOTE: No refunds table exists in the current schema
    // For now, just log the refund details
    // TODO: Create refunds table if we need to track refund history
    console.log(`[WEBHOOK-PROCESSOR] ⚠️ Refunds table not implemented - logging refund ${refundId} only`)
    console.log(`[WEBHOOK-PROCESSOR] Refund details: order=${orderId}, payment=${paymentId}, amount=${amountMoney.amount}`)
    
    // In the future, we could:
    // 1. Reverse referral rewards if the refund is for a first-time customer payment
    // 2. Update gift card balances if gift cards were used
    // For now, this is handled by Square directly

    console.log(`[WEBHOOK-PROCESSOR] ✅ Logged refund ${refundId} (no DB insert - table not implemented)`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error processing refund ${refundId}:`, error.message)
    throw error
  }
}

/**
 * Process refund.updated webhook
 */
export async function processRefundUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processRefundUpdated called for event ${eventId}`)
  // Reuse refund created logic (upsert handles both)
  await processRefundCreated(payload, eventId, eventCreatedAt)
}

/**
 * Process order.updated webhook
 * Updates order data in database
 */
export async function processOrderUpdated(payload, eventId, eventCreatedAt) {
  console.log(`[WEBHOOK-PROCESSOR] processOrderUpdated called for event ${eventId}`)
  
  const orderData = payload?.object?.order || payload?.order || payload
  if (!orderData?.id) {
    console.warn(`[WEBHOOK-PROCESSOR] No order ID found in payload`)
    return
  }

  const orderId = orderData.id
  const locationId = orderData.location_id || orderData.locationId
  const state = orderData.state
  const customerId = orderData.customer_id || orderData.customerId

  console.log(`[WEBHOOK-PROCESSOR] Processing order ${orderId} state: ${state}`)

  try {
    // Resolve organization from location
    let organizationId = null
    if (locationId) {
      const location = await prisma.$queryRaw`
        SELECT organization_id FROM locations WHERE square_location_id = ${locationId} LIMIT 1
      `
      if (location?.[0]?.organization_id) {
        organizationId = location[0].organization_id
      }
    }

    // Resolve location UUID from square_location_id
    let locationUuid = null
    if (locationId && organizationId) {
      const locRecord = await prisma.$queryRaw`
        SELECT id FROM locations WHERE square_location_id = ${locationId} AND organization_id = ${organizationId}::text LIMIT 1
      `
      if (locRecord?.[0]?.id) {
        locationUuid = locRecord[0].id
      }
    }

    // Update order in database (column is order_id not square_order_id)
    // Note: technician_id and administrator_id are populated later when payment arrives
    await prisma.$executeRaw`
      INSERT INTO orders (
        id, organization_id, order_id, location_id, customer_id, state,
        created_at, updated_at, raw_json
      ) VALUES (
        gen_random_uuid(), ${organizationId}::text, ${orderId}, ${locationUuid}::uuid, ${customerId}, ${state},
        NOW(), NOW(), ${safeStringify(orderData)}::jsonb
      )
      ON CONFLICT (organization_id, order_id) DO UPDATE SET
        state = EXCLUDED.state,
        customer_id = COALESCE(EXCLUDED.customer_id, orders.customer_id),
        updated_at = NOW(),
        raw_json = EXCLUDED.raw_json
    `

    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved order ${orderId}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving order ${orderId}:`, error.message)
    throw error
  }
}

/**
 * Process team_member.created webhook
 * Adds new technician/staff to database
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
  const status = teamMemberData.status

  console.log(`[WEBHOOK-PROCESSOR] Processing team member ${teamMemberId}: ${givenName} ${familyName}`)

  try {
    // Get default organization for team members
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

    // Insert or update team member (table is team_members, not technicians)
    await prisma.$executeRaw`
      INSERT INTO team_members (
        id, organization_id, square_team_member_id, given_name, family_name, email_address, phone_number, status,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${organizationId}::text, ${teamMemberId}, ${givenName}, ${familyName}, ${emailAddress}, ${phoneNumber}, ${status},
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
