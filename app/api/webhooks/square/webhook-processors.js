/**
 * Webhook Processors
 * 
 * These functions are called by the webhook-job-runner cron to process
 * queued webhook events asynchronously.
 */

import prisma from '../../../../lib/prisma-client'

// Helper to clean values
function cleanValue(val) {
  if (val === null || val === undefined) return null
  if (typeof val === 'string') return val.trim() || null
  return val
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

  console.log(`[WEBHOOK-PROCESSOR] Processing booking ${bookingId} for customer ${customerId}`)

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

    // Insert or update booking
    await prisma.$executeRaw`
      INSERT INTO bookings (
        organization_id, booking_id, customer_id, location_id, status, version,
        created_at, updated_at, raw_json
      ) VALUES (
        ${organizationId}::uuid, ${bookingId}, ${customerId}, ${locationId}, ${status}, ${version || 1},
        NOW(), NOW(), ${JSON.stringify(bookingData)}::jsonb
      )
      ON CONFLICT (organization_id, booking_id) DO UPDATE SET
        status = EXCLUDED.status,
        version = EXCLUDED.version,
        updated_at = NOW(),
        raw_json = EXCLUDED.raw_json
    `

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
    // Insert or update customer in square_existing_clients
    await prisma.$executeRaw`
      INSERT INTO square_existing_clients (
        square_customer_id, given_name, family_name, email_address, phone_number,
        created_at, updated_at
      ) VALUES (
        ${customerId}, ${givenName}, ${familyName}, ${emailAddress}, ${phoneNumber},
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

  console.log(`[WEBHOOK-PROCESSOR] Processing payment ${paymentId} status: ${status}`)

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

    // Update payment in database
    await prisma.$executeRaw`
      INSERT INTO payments (
        organization_id, payment_id, order_id, customer_id, location_id, status,
        amount_cents, currency, created_at, updated_at, raw_json
      ) VALUES (
        ${organizationId}::uuid, ${paymentId}, ${orderId}, ${customerId}, ${locationId}, ${status},
        ${Number(amountMoney.amount || 0)}, ${amountMoney.currency || 'USD'},
        NOW(), NOW(), ${JSON.stringify(paymentData)}::jsonb
      )
      ON CONFLICT (organization_id, payment_id) DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = NOW(),
        raw_json = EXCLUDED.raw_json
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

    // Insert gift card transaction
    await prisma.$executeRaw`
      INSERT INTO gift_card_transactions (
        id, gift_card_id, gift_card_gan, transaction_type, amount_cents,
        square_activity_id, location_id, created_at
      ) VALUES (
        gen_random_uuid(), ${giftCardId}, ${giftCardGan}, ${activityType}, ${amountCents},
        ${activityId}, ${locationId}, NOW()
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
  const locationId = refundData.location_id || refundData.locationId

  console.log(`[WEBHOOK-PROCESSOR] Processing refund ${refundId} for payment ${paymentId}`)

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

    // Insert refund record
    await prisma.$executeRaw`
      INSERT INTO refunds (
        organization_id, refund_id, payment_id, order_id, status,
        amount_cents, currency, location_id, created_at, updated_at, raw_json
      ) VALUES (
        ${organizationId}::uuid, ${refundId}, ${paymentId}, ${orderId}, ${status},
        ${Number(amountMoney.amount || 0)}, ${amountMoney.currency || 'USD'},
        ${locationId}, NOW(), NOW(), ${JSON.stringify(refundData)}::jsonb
      )
      ON CONFLICT (organization_id, refund_id) DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = NOW(),
        raw_json = EXCLUDED.raw_json
    `

    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved refund ${refundId}`)
    
    // TODO: Consider reversing referral rewards if applicable
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving refund ${refundId}:`, error.message)
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

    // Update order in database
    await prisma.$executeRaw`
      INSERT INTO orders (
        organization_id, square_order_id, location_id, customer_id, state,
        created_at, updated_at, raw_json
      ) VALUES (
        ${organizationId}::uuid, ${orderId}, ${locationId}, ${customerId}, ${state},
        NOW(), NOW(), ${JSON.stringify(orderData)}::jsonb
      )
      ON CONFLICT (organization_id, square_order_id) DO UPDATE SET
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
    // Insert or update technician
    await prisma.$executeRaw`
      INSERT INTO technicians (
        id, square_team_member_id, given_name, family_name, email_address, phone_number, status,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${teamMemberId}, ${givenName}, ${familyName}, ${emailAddress}, ${phoneNumber}, ${status},
        NOW(), NOW()
      )
      ON CONFLICT (square_team_member_id) DO UPDATE SET
        given_name = COALESCE(EXCLUDED.given_name, technicians.given_name),
        family_name = COALESCE(EXCLUDED.family_name, technicians.family_name),
        email_address = COALESCE(EXCLUDED.email_address, technicians.email_address),
        phone_number = COALESCE(EXCLUDED.phone_number, technicians.phone_number),
        status = EXCLUDED.status,
        updated_at = NOW()
    `

    console.log(`[WEBHOOK-PROCESSOR] ✅ Saved team member ${teamMemberId}`)
  } catch (error) {
    console.error(`[WEBHOOK-PROCESSOR] ❌ Error saving team member ${teamMemberId}:`, error.message)
    throw error
  }
}
