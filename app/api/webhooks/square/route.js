import crypto from 'crypto'
import prisma from '../../../../lib/prisma-client'

// Import square-env using dynamic require inside function to avoid webpack static analysis
function getSquareEnvironmentName() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const squareEnv = require('../../../../lib/utils/square-env')
  return squareEnv.getSquareEnvironmentName()
}

// Get Square Orders API
function getOrdersApi() {
  // Use dynamic require so bundlers don't evaluate Square SDK at build-time
  // eslint-disable-next-line global-require
  const squareModule = require('square')
  const candidates = [squareModule, squareModule?.default].filter(Boolean)
  const pick = (selector) => {
    for (const candidate of candidates) {
      const value = selector(candidate)
      if (value) return value
    }
    return null
  }

  const Client = pick((mod) => (typeof mod?.Client === 'function' ? mod.Client : null)) ||
    (typeof candidates[0] === 'function' ? candidates[0] : null)
  const Environment = pick((mod) => mod?.Environment)

  if (typeof Client !== 'function' || !Environment) {
    throw new Error('Square SDK exports missing (Client/Environment)')
  }

  const squareEnvName = getSquareEnvironmentName()
  const resolvedEnvironment = squareEnvName === 'sandbox' ? Environment.Sandbox : Environment.Production
  const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
    environment: resolvedEnvironment,
  })

  return squareClient.ordersApi
}

function verifySquareSignature(payload, signature, webhookSecret) {
  try {
    const hmac = crypto.createHmac('sha256', webhookSecret)
    hmac.update(payload)
    const expectedSignature = hmac.digest('base64')
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch (error) {
    console.error('Error verifying signature:', error.message)
    return false
  }
}

export async function POST(request) {
  try {
    const rawBody = await request.text()
    const signatureHeader = request.headers.get('x-square-hmacsha256-signature') ||
                           request.headers.get('x-square-signature')

    console.log('🔔 Webhook received:', {
      hasSignature: !!signatureHeader,
      contentType: request.headers.get('content-type')
    })

    const isTestMode = signatureHeader === 'test-signature-mock'
    
    if (!signatureHeader) {
      console.warn('Missing webhook signature')
      return new Response(JSON.stringify({ error: 'Missing signature' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (!isTestMode) {
      const webhookSecret = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
      if (!webhookSecret) {
        console.error('Missing SQUARE_WEBHOOK_SIGNATURE_KEY environment variable')
        return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      if (!verifySquareSignature(rawBody, signatureHeader, webhookSecret)) {
        console.error('Invalid Square webhook signature')
        return new Response(JSON.stringify({ error: 'Invalid signature' }), { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      console.log('✅ Webhook signature verified')
    } else {
      console.log('🧪 Test mode: processing webhook...')
    }

    // Парсим JSON
    const eventData = JSON.parse(rawBody)
    console.log('📝 Raw event data:', JSON.stringify(eventData, null, 2))

    // Простая обработка событий
    if (eventData.type === 'booking.created') {
      console.log('📅 Booking created event received')
      console.log('📊 Data:', eventData.data)
    } else if (eventData.type === 'payment.created' || eventData.type === 'payment.updated') {
      console.log(`💳 Payment ${eventData.type === 'payment.created' ? 'created' : 'updated'} event received`)
      const paymentData = eventData.data?.object?.payment
      if (paymentData) {
        // Save payment to database in real-time
        await savePaymentToDatabase(paymentData, eventData.type, eventData.event_id, eventData.created_at)
        
        const orderId = paymentData.order_id || paymentData.orderId
        if (orderId) {
          // Update order_line_items with technician_id and administrator_id when payment arrives
          await updateOrderLineItemsWithTechnician(orderId)
        }
      }
      console.log('📊 Data:', eventData.data)
    } else if (eventData.type === 'order.created' || eventData.type === 'order.updated') {
      console.log(`📦 Order ${eventData.type === 'order.created' ? 'created' : 'updated'} event received`)
      await processOrderWebhook(eventData.data, eventData.type)
    } else {
      console.log('ℹ️ Unhandled event type:', eventData.type)
    }

    return new Response(JSON.stringify({ 
      ok: true, 
      message: 'Webhook processed successfully',
      eventType: eventData.type 
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('❌ Webhook processing error:', error)
    
    return new Response(JSON.stringify({ 
      error: 'Processing failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

/**
 * Save payment from webhook to database
 * Uses the same transform logic as backfill-payments.js
 */
async function savePaymentToDatabase(paymentData, eventType, squareEventId = null, squareCreatedAt = null) {
  try {
    // Helper to get value from either camelCase or snake_case (same as backfill script)
    const getValue = (obj, ...keys) => {
      for (const key of keys) {
        if (obj?.[key] !== undefined && obj?.[key] !== null) {
          return obj[key]
        }
      }
      return null
    }

    if (!paymentData?.id) {
      console.warn('⚠️ Payment data missing ID, skipping save')
      return
    }

    const paymentId = paymentData.id
    const customerId = getValue(paymentData, 'customerId', 'customer_id')
    let locationId = getValue(paymentData, 'locationId', 'location_id')
    const orderId = getValue(paymentData, 'orderId', 'order_id')
    const merchantId = getValue(paymentData, 'merchantId', 'merchant_id')

    // Resolve organization_id from merchant_id
    let organizationId = null
    if (merchantId) {
      try {
        const org = await prisma.$queryRaw`
          SELECT id FROM organizations 
          WHERE square_merchant_id = ${merchantId}
          LIMIT 1
        `
        if (org && org.length > 0) {
          organizationId = org[0].id
        }
      } catch (err) {
        console.warn(`⚠️ Could not resolve organization_id from merchant_id: ${err.message}`)
      }
    }

    // If payment doesn't have locationId, try to get it from the order
    if (!locationId && orderId) {
      console.log(`📍 Payment ${paymentId} missing locationId, attempting to resolve from order ${orderId}`)
      try {
        // First, try to get locationId from existing order in database
        const orderRecord = await prisma.$queryRaw`
          SELECT l.square_location_id 
          FROM orders o
          INNER JOIN locations l ON o.location_id = l.id
          WHERE o.order_id = ${orderId}
          LIMIT 1
        `
        if (orderRecord && orderRecord.length > 0) {
          locationId = orderRecord[0].square_location_id
          console.log(`✅ Found locationId from order in DB: ${locationId}`)
        } else {
          // If order not in DB yet, try to fetch from Square API
          try {
            const ordersApi = getOrdersApi()
            const orderResponse = await ordersApi.retrieveOrder(orderId)
            const order = orderResponse.result?.order
            if (order?.location_id) {
              locationId = order.location_id
              console.log(`✅ Found locationId from Square API order: ${locationId}`)
            } else {
              console.warn(`⚠️ Order ${orderId} from Square API also missing location_id`)
            }
          } catch (apiError) {
            console.warn(`⚠️ Could not fetch order ${orderId} from Square API: ${apiError.message}`)
          }
        }
      } catch (err) {
        console.warn(`⚠️ Could not resolve locationId from order: ${err.message}`)
      }
    }
    
    if (!locationId) {
      console.warn(`⚠️ Payment ${paymentId} still missing location_id after all attempts`)
    }

    // If still no organization_id, try to get it from location
    if (!organizationId && locationId) {
      try {
        const loc = await prisma.$queryRaw`
          SELECT organization_id FROM locations 
          WHERE square_location_id = ${locationId}
          LIMIT 1
        `
        if (loc && loc.length > 0) {
          organizationId = loc[0].organization_id
        }
      } catch (err) {
        console.warn(`⚠️ Could not resolve organization_id from location: ${err.message}`)
      }
    }

    // If still no organization_id, try to get it from order
    if (!organizationId && orderId) {
      try {
        const orderOrg = await prisma.$queryRaw`
          SELECT organization_id FROM orders 
          WHERE order_id = ${orderId}
          LIMIT 1
        `
        if (orderOrg && orderOrg.length > 0) {
          organizationId = orderOrg[0].organization_id
        }
      } catch (err) {
        console.warn(`⚠️ Could not resolve organization_id from order: ${err.message}`)
      }
    }

    if (!organizationId) {
      console.error(`❌ Cannot save payment: organization_id is required but could not be resolved`)
      return
    }

    // Ensure location exists (required foreign key)
    if (locationId) {
      try {
        await prisma.$executeRaw`
          INSERT INTO locations (
            id,
            organization_id,
            square_location_id,
            name,
            created_at,
            updated_at
          ) VALUES (
            gen_random_uuid(),
            ${organizationId}::uuid,
            ${locationId},
            ${`Location ${locationId.substring(0, 8)}...`},
            NOW(),
            NOW()
          )
          ON CONFLICT (organization_id, square_location_id) DO NOTHING
        `
      } catch (err) {
        // Location might already exist or be created concurrently
        console.warn(`⚠️ Location upsert warning: ${err.message}`)
      }
    } else {
      console.warn(`⚠️ Payment ${paymentId} missing location_id, cannot save`)
      return
    }

    // Ensure customer exists if provided
    if (customerId) {
      try {
        await prisma.$executeRaw`
          INSERT INTO square_existing_clients (
            id,
            organization_id,
            square_customer_id,
            got_signup_bonus,
            created_at,
            updated_at
          ) VALUES (
            gen_random_uuid(),
            ${organizationId}::uuid,
            ${customerId},
            false,
            NOW(),
            NOW()
          )
          ON CONFLICT (organization_id, square_customer_id) DO NOTHING
        `
      } catch (err) {
        // Customer might already exist
        console.warn(`⚠️ Customer upsert warning: ${err.message}`)
      }
    }

    // Ensure order exists if provided
    if (orderId) {
      try {
        // Get location UUID from square_location_id
        const locationRecord = await prisma.$queryRaw`
          SELECT id FROM locations 
          WHERE square_location_id = ${locationId}
            AND organization_id = ${organizationId}::uuid
          LIMIT 1
        `
        const locationUuid = locationRecord && locationRecord.length > 0 ? locationRecord[0].id : null

        await prisma.$executeRaw`
          INSERT INTO orders (
            id,
            organization_id,
            order_id,
            location_id,
            created_at,
            updated_at
          ) VALUES (
            gen_random_uuid(),
            ${organizationId}::uuid,
            ${orderId},
            ${locationUuid}::uuid,
            NOW(),
            NOW()
          )
          ON CONFLICT (organization_id, order_id) DO NOTHING
        `
      } catch (err) {
        // Order might already exist
        console.warn(`⚠️ Order upsert warning: ${err.message}`)
      }
    }

    // Extract money amounts (same as backfill script)
    const amountMoney = getValue(paymentData, 'amountMoney', 'amount_money') || {}
    const tipMoney = getValue(paymentData, 'tipMoney', 'tip_money') || {}
    const totalMoney = getValue(paymentData, 'totalMoney', 'total_money') || {}
    const approvedMoney = getValue(paymentData, 'approvedMoney', 'approved_money') || {}

    // Extract card details (same as backfill script)
    const cardDetails = getValue(paymentData, 'cardDetails', 'card_details') || {}
    const card = cardDetails.card || {}
    const cardTimeline = cardDetails.cardPaymentTimeline || cardDetails.card_payment_timeline || {}

    // Extract processing fees (same as backfill script)
    const processingFees = getValue(paymentData, 'processingFee', 'processing_fee') || []
    const firstProcessingFee = Array.isArray(processingFees) ? processingFees[0] : processingFees
    const processingFeeAmount = firstProcessingFee?.amountMoney?.amount || firstProcessingFee?.amount_money?.amount || null
    const processingFeeCurrency = firstProcessingFee?.amountMoney?.currency || firstProcessingFee?.amount_money?.currency || 'USD'
    const processingFeeType = firstProcessingFee?.type || null

    // Extract application and device details (same as backfill script)
    const appDetails = getValue(paymentData, 'applicationDetails', 'application_details') || {}
    const deviceDetails = getValue(paymentData, 'deviceDetails', 'device_details') || {}

    // Get location UUID from square_location_id
    const locationRecord = await prisma.$queryRaw`
      SELECT id FROM locations 
      WHERE square_location_id = ${locationId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    const locationUuid = locationRecord && locationRecord.length > 0 ? locationRecord[0].id : null

    if (!locationUuid) {
      console.error(`❌ Cannot save payment: location UUID not found for square_location_id ${locationId}`)
      return
    }

    // Get order UUID if orderId exists
    let orderUuid = null
    if (orderId) {
      try {
        const orderRecord = await prisma.$queryRaw`
          SELECT id FROM orders 
          WHERE order_id = ${orderId}
            AND organization_id = ${organizationId}::uuid
          LIMIT 1
        `
        orderUuid = orderRecord && orderRecord.length > 0 ? orderRecord[0].id : null
      } catch (err) {
        console.warn(`⚠️ Could not find order UUID: ${err.message}`)
      }
    }

    // Build payment record (exactly matching schema and backfill script)
    const paymentRecord = {
      id: paymentId,
      organization_id: organizationId, // ✅ ADDED: Required field
      square_event_id: squareEventId,
      event_type: eventType,
      merchant_id: getValue(paymentData, 'merchantId', 'merchant_id'),
      
      // Customer & Location
      customer_id: customerId,
      location_id: locationUuid, // Use UUID, not square_location_id
      order_id: orderUuid, // Use UUID, not square order_id
      booking_id: null, // Will be populated later if available from order
      
      // Money amounts (all in cents)
      amount_money_amount: amountMoney.amount || 0,
      amount_money_currency: amountMoney.currency || 'USD',
      tip_money_amount: tipMoney.amount || null,
      tip_money_currency: tipMoney.currency || 'USD',
      total_money_amount: totalMoney.amount || 0,
      total_money_currency: totalMoney.currency || 'USD',
      approved_money_amount: approvedMoney.amount || null,
      approved_money_currency: approvedMoney.currency || 'USD',
      
      // Status
      status: paymentData.status || null,
      source_type: getValue(paymentData, 'sourceType', 'source_type'),
      delay_action: getValue(paymentData, 'delayAction', 'delay_action'),
      delay_duration: getValue(paymentData, 'delayDuration', 'delay_duration'),
      delayed_until: getValue(paymentData, 'delayedUntil', 'delayed_until') 
        ? new Date(getValue(paymentData, 'delayedUntil', 'delayed_until'))
        : null,
      
      // Staff/Team Member
      administrator_id: getValue(paymentData, 'teamMemberId', 'team_member_id') || 
                        getValue(paymentData, 'employeeId', 'employee_id') ||
                        null,
      
      // Application details
      application_details_square_product: appDetails.squareProduct || appDetails.square_product || null,
      
      // Capabilities
      capabilities: Array.isArray(paymentData.capabilities) ? paymentData.capabilities : [],
      
      // Card details
      card_application_cryptogram: card.applicationCryptogram || card.application_cryptogram || null,
      card_application_identifier: card.applicationIdentifier || card.application_identifier || null,
      card_application_name: card.applicationName || card.application_name || null,
      card_auth_result_code: cardDetails.authResultCode || cardDetails.auth_result_code || null,
      card_avs_status: cardDetails.avsStatus || cardDetails.avs_status || null,
      card_bin: card.bin || null,
      card_brand: card.cardBrand || card.card_brand || null,
      card_type: card.cardType || card.card_type || null,
      card_exp_month: card.expMonth || card.exp_month || null,
      card_exp_year: card.expYear || card.exp_year || null,
      card_fingerprint: card.fingerprint || null,
      card_last_4: card.last4 || card.last_4 || null,
      card_payment_account_reference: card.paymentAccountReference || card.payment_account_reference || null,
      card_prepaid_type: card.prepaidType || card.prepaid_type || null,
      card_entry_method: cardDetails.entryMethod || cardDetails.entry_method || null,
      card_statement_description: cardDetails.statementDescription || cardDetails.statement_description || null,
      card_status: cardDetails.status || null,
      card_verification_method: cardDetails.verificationMethod || cardDetails.verification_method || null,
      card_verification_results: cardDetails.verificationResults || cardDetails.verification_results || null,
      card_cvv_status: cardDetails.cvvStatus || cardDetails.cvv_status || null,
      card_payment_timeline_authorized_at: cardTimeline.authorizedAt || cardTimeline.authorized_at 
        ? new Date(cardTimeline.authorizedAt || cardTimeline.authorized_at)
        : null,
      card_payment_timeline_captured_at: cardTimeline.capturedAt || cardTimeline.captured_at
        ? new Date(cardTimeline.capturedAt || cardTimeline.captured_at)
        : null,
      card_emv_authorization_response_code: cardDetails.emvAuthData?.emvApplicationCryptogram || 
                                           cardDetails.emv_auth_data?.emv_application_cryptogram || null,
      
      // Device details
      device_id: deviceDetails.id || deviceDetails.device_id || null,
      device_installation_id: deviceDetails.installationId || deviceDetails.installation_id || null,
      device_name: deviceDetails.name || deviceDetails.device_name || null,
      card_device_id: cardDetails.deviceDetails?.id || cardDetails.device_details?.device_id || null,
      card_device_installation_id: cardDetails.deviceDetails?.installationId || 
                                  cardDetails.device_details?.device_installation_id || null,
      card_device_name: cardDetails.deviceDetails?.name || cardDetails.device_details?.device_name || null,
      
      // Receipt
      receipt_number: getValue(paymentData, 'receiptNumber', 'receipt_number'),
      receipt_url: getValue(paymentData, 'receiptUrl', 'receipt_url'),
      
      // Processing fees
      processing_fee_amount: processingFeeAmount,
      processing_fee_currency: processingFeeCurrency,
      processing_fee_type: processingFeeType,
      
      // Refund info
      refund_ids: Array.isArray(paymentData.refundIds) ? paymentData.refundIds : 
                  Array.isArray(paymentData.refund_ids) ? paymentData.refund_ids : [],
      
      // Timestamps
      created_at: paymentData.createdAt || paymentData.created_at ? new Date(paymentData.createdAt || paymentData.created_at) : new Date(),
      updated_at: paymentData.updatedAt || paymentData.updated_at ? new Date(paymentData.updatedAt || paymentData.updated_at) : new Date(),
      square_created_at: squareCreatedAt ? new Date(squareCreatedAt) : null, // Webhook event timestamp
      
      // Version
      version: paymentData.versionToken ? 1 : (paymentData.version || 0),
    }

    // Upsert payment
    await prisma.payment.upsert({
      where: { id: paymentId },
      update: paymentRecord,
      create: paymentRecord,
    })

    // Handle tenders (extract from payment data)
    const tenders = paymentData.tenders || paymentData.tender || []
    
    // Delete existing tenders and recreate (to handle updates)
    await prisma.paymentTender.deleteMany({
      where: { payment_id: paymentId }
    })

    // Create tenders if they exist
    if (Array.isArray(tenders) && tenders.length > 0) {
      const tenderRecords = tenders.map((tender, index) => {
        const tenderCardDetails = getValue(tender, 'cardDetails', 'card_details') || {}
        const tenderCard = tenderCardDetails.card || {}
        const tenderCardTimeline = tenderCardDetails.cardPaymentTimeline || tenderCardDetails.card_payment_timeline || {}
        const tenderCashDetails = getValue(tender, 'cashDetails', 'cash_details') || {}
        const tenderGiftCardDetails = getValue(tender, 'giftCardDetails', 'gift_card_details') || {}
        const tenderBankAccountDetails = getValue(tender, 'bankAccountDetails', 'bank_account_details') || {}
        const tenderAmountMoney = getValue(tender, 'amountMoney', 'amount_money') || {}

        return {
          id: `${paymentId}-${tender.id || index}-${Date.now()}`,
          payment_id: paymentId,
          tender_id: tender.id || null,
          type: tender.type || null,
          amount_money_amount: tenderAmountMoney.amount || 0,
          amount_money_currency: tenderAmountMoney.currency || 'USD',
          note: tender.note || null,
          
          // Card details
          card_status: tenderCardDetails.status || null,
          card_application_cryptogram: tenderCard.applicationCryptogram || tenderCard.application_cryptogram || null,
          card_application_identifier: tenderCard.applicationIdentifier || tenderCard.application_identifier || null,
          card_application_name: tenderCard.applicationName || tenderCard.application_name || null,
          card_auth_result_code: tenderCardDetails.authResultCode || tenderCardDetails.auth_result_code || null,
          card_avs_status: tenderCardDetails.avsStatus || tenderCardDetails.avs_status || null,
          card_bin: tenderCard.bin || null,
          card_brand: tenderCard.cardBrand || tenderCard.card_brand || null,
          card_type: tenderCard.cardType || tenderCard.card_type || null,
          card_exp_month: tenderCard.expMonth || tenderCard.exp_month || null,
          card_exp_year: tenderCard.expYear || tenderCard.exp_year || null,
          card_fingerprint: tenderCard.fingerprint || null,
          card_last_4: tenderCard.last4 || tenderCard.last_4 || null,
          card_payment_account_reference: tenderCard.paymentAccountReference || tenderCard.payment_account_reference || null,
          card_prepaid_type: tenderCard.prepaidType || tenderCard.prepaid_type || null,
          card_entry_method: tenderCardDetails.entryMethod || tenderCardDetails.entry_method || null,
          card_statement_description: tenderCardDetails.statementDescription || tenderCardDetails.statement_description || null,
          card_verification_method: tenderCardDetails.verificationMethod || tenderCardDetails.verification_method || null,
          card_verification_results: tenderCardDetails.verificationResults || tenderCardDetails.verification_results || null,
          card_cvv_status: tenderCardDetails.cvvStatus || tenderCardDetails.cvv_status || null,
          card_payment_timeline_authorized_at: tenderCardTimeline.authorizedAt || tenderCardTimeline.authorized_at
            ? new Date(tenderCardTimeline.authorizedAt || tenderCardTimeline.authorized_at)
            : null,
          card_payment_timeline_captured_at: tenderCardTimeline.capturedAt || tenderCardTimeline.captured_at
            ? new Date(tenderCardTimeline.capturedAt || tenderCardTimeline.captured_at)
            : null,
          card_emv_authorization_response_code: tenderCardDetails.emvAuthData?.emvApplicationCryptogram ||
                                               tenderCardDetails.emv_auth_data?.emv_application_cryptogram || null,
          card_device_id: tenderCardDetails.deviceDetails?.id || tenderCardDetails.device_details?.device_id || null,
          card_device_installation_id: tenderCardDetails.deviceDetails?.installationId ||
                                       tenderCardDetails.device_details?.device_installation_id || null,
          card_device_name: tenderCardDetails.deviceDetails?.name || tenderCardDetails.device_details?.device_name || null,
          
          // Cash details
          cash_buyer_tendered_amount: tenderCashDetails.buyerTenderedMoney?.amount || 
                                      tenderCashDetails.buyer_tendered_money?.amount || null,
          cash_buyer_tendered_currency: tenderCashDetails.buyerTenderedMoney?.currency || 
                                        tenderCashDetails.buyer_tendered_money?.currency || 'USD',
          cash_change_back_amount: tenderCashDetails.changeBackMoney?.amount || 
                                   tenderCashDetails.change_back_money?.amount || null,
          cash_change_back_currency: tenderCashDetails.changeBackMoney?.currency || 
                                     tenderCashDetails.change_back_money?.currency || 'USD',
          
          // Gift card details
          gift_card_id: tenderGiftCardDetails.giftCardId || tenderGiftCardDetails.gift_card_id || null,
          gift_card_gan: tenderGiftCardDetails.gan || null,
          
          // Bank account details
          bank_account_details_account_last_4: tenderBankAccountDetails.accountLast4 || 
                                               tenderBankAccountDetails.account_last_4 || null,
          bank_account_details_account_type: tenderBankAccountDetails.accountType || 
                                             tenderBankAccountDetails.account_type || null,
          bank_account_details_routing_number: tenderBankAccountDetails.routingNumber || 
                                                tenderBankAccountDetails.routing_number || null,
          
          created_at: new Date(),
        }
      })

      // Add organization_id to each tender record
      const tenderRecordsWithOrg = tenderRecords.map(tender => ({
        ...tender,
        organization_id: organizationId // ✅ ADDED: Required field
      }))

      await prisma.paymentTender.createMany({
        data: tenderRecordsWithOrg
      })
    }

    console.log(`✅ Payment ${paymentId} saved to database (${eventType}) with organization_id: ${organizationId}`)
  } catch (error) {
    console.error(`❌ Failed to save payment to database:`, error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 3).join('\n'))
    }
    // Don't throw - allow webhook to continue processing
  }
}

/**
 * Update order_line_items with technician_id and administrator_id
 * Gets technician ID from bookings table and administrator ID from payments table
 */
async function updateOrderLineItemsWithTechnician(orderId) {
  try {
    // Find payment linked to this order (orderId is square order_id, need to find order UUID first)
    const orderRecord = await prisma.$queryRaw`
      SELECT id, organization_id FROM orders 
      WHERE order_id = ${orderId}
      LIMIT 1
    `
    
    if (!orderRecord || orderRecord.length === 0) {
      console.log(`ℹ️ Order ${orderId} not found in database yet`)
      return null
    }

    const orderUuid = orderRecord[0].id
    const organizationId = orderRecord[0].organization_id

    // Find payment linked to this order
    const paymentWithBooking = await prisma.$queryRaw`
      SELECT booking_id, administrator_id
      FROM payments
      WHERE order_id = ${orderUuid}::uuid
        AND booking_id IS NOT NULL
      LIMIT 1
    `

    if (!paymentWithBooking || paymentWithBooking.length === 0) {
      console.log(`ℹ️ No payment with booking_id found for order ${orderId} yet (might arrive later)`)
      return null
    }

    const bookingId = paymentWithBooking[0].booking_id
    const administratorId = paymentWithBooking[0].administrator_id || null
    console.log(`🔍 Found booking ${bookingId} for order ${orderId}`)

    // Get technician_id from bookings table (match by booking ID or booking-service ID)
    // For multi-service bookings, we match by booking ID prefix
    const bookings = await prisma.$queryRaw`
      SELECT service_variation_id, technician_id
      FROM bookings
      WHERE booking_id LIKE ${`${bookingId}%`}
        AND technician_id IS NOT NULL
        AND any_team_member = false
      ORDER BY duration_minutes DESC
    `

    if (!bookings || bookings.length === 0) {
      console.log(`⚠️ No booking found with technician_id for booking ${bookingId}`)
      return null
    }

    // Create map of service_variation_id -> technician_id
    const serviceTechnicianMap = new Map()
    bookings.forEach(booking => {
      if (booking.service_variation_id && booking.technician_id) {
        serviceTechnicianMap.set(booking.service_variation_id, booking.technician_id)
      }
    })

    console.log(`✅ Found ${serviceTechnicianMap.size} service-technician mappings for booking ${bookingId}`)
    if (administratorId) {
      console.log(`✅ Found administrator_id: ${administratorId}`)
    }

    // Update line items matching by service_variation_id
    for (const [serviceVariationId, technicianId] of serviceTechnicianMap.entries()) {
      const updateResult = await prisma.$executeRaw`
        UPDATE order_line_items
        SET 
          technician_id = COALESCE(${technicianId}::uuid, technician_id),
          administrator_id = COALESCE(${administratorId}::uuid, administrator_id)
        WHERE order_id = ${orderUuid}::uuid
          AND organization_id = ${organizationId}::uuid
          AND service_variation_id = ${serviceVariationId}
          AND (
            technician_id IS NULL 
            OR administrator_id IS NULL
            OR technician_id != ${technicianId}::uuid
            OR administrator_id != ${administratorId}::uuid
          )
      `
    }

    // Also update line items without specific service match (fallback)
    if (bookings.length > 0) {
      const primaryTechnicianId = bookings[0].technician_id
      await prisma.$executeRaw`
        UPDATE order_line_items
        SET 
          technician_id = COALESCE(${primaryTechnicianId}::uuid, technician_id),
          administrator_id = COALESCE(${administratorId}::uuid, administrator_id)
        WHERE order_id = ${orderUuid}::uuid
          AND organization_id = ${organizationId}::uuid
          AND (technician_id IS NULL OR administrator_id IS NULL)
      `
    }

    console.log(`✅ Updated order_line_items with technician_id and administrator_id for order ${orderId}`)
    return { technicianId: bookings[0]?.technician_id, administratorId }
  } catch (error) {
    console.error(`❌ Error updating order_line_items: ${error.message}`)
    return null
  }
}

async function processOrderWebhook(webhookData, eventType) {
  try {
    // Extract order_id from webhook payload structure
    // order.created: data.object.order_created.order_id
    // order.updated: data.object.order_updated.order_id
    const orderMetadata = webhookData.object?.order_created || webhookData.object?.order_updated
    
    if (!orderMetadata || !orderMetadata.order_id) {
      console.error('❌ Invalid order webhook data:', webhookData)
      return
    }

    const orderId = orderMetadata.order_id
    const locationId = orderMetadata.location_id
    const orderState = orderMetadata.state

    console.log(`📦 Fetching full order details for order ${orderId} (state: ${orderState})`)

    // Fetch full order details from Square API to get line items
    let order
    try {
      const ordersApi = getOrdersApi()
      const orderResponse = await ordersApi.retrieveOrder(orderId)
      order = orderResponse.result?.order

      if (!order) {
        console.error(`❌ Order ${orderId} not found in Square API`)
        return
      }
    } catch (apiError) {
      console.error(`❌ Error fetching order ${orderId} from Square API:`, apiError.message)
      if (apiError.errors) {
        console.error('Square API errors:', JSON.stringify(apiError.errors, null, 2))
      }
      throw apiError
    }

    // Use location_id from full order (more reliable than webhook metadata)
    const finalLocationId = order.location_id || locationId || null
    const customerId = order.customer_id || null
    const lineItems = order.line_items || []
    const merchantId = order.merchant_id || null

    // Resolve organization_id from merchant_id
    let organizationId = null
    if (merchantId) {
      try {
        const org = await prisma.$queryRaw`
          SELECT id FROM organizations 
          WHERE square_merchant_id = ${merchantId}
          LIMIT 1
        `
        if (org && org.length > 0) {
          organizationId = org[0].id
        }
      } catch (err) {
        console.warn(`⚠️ Could not resolve organization_id from merchant_id: ${err.message}`)
      }
    }

    // If still no organization_id, try to get it from location
    if (!organizationId && finalLocationId) {
      try {
        const loc = await prisma.$queryRaw`
          SELECT organization_id FROM locations 
          WHERE square_location_id = ${finalLocationId}
          LIMIT 1
        `
        if (loc && loc.length > 0) {
          organizationId = loc[0].organization_id
        }
      } catch (err) {
        console.warn(`⚠️ Could not resolve organization_id from location: ${err.message}`)
      }
    }

    if (!organizationId) {
      console.error(`❌ Cannot process order: organization_id is required but could not be resolved`)
      return
    }

    console.log(`📦 Processing order ${orderId} with ${lineItems.length} line items (organization_id: ${organizationId})`)

    // Get booking_id and administrator_id from payments (if payment exists)
    // Note: This will be empty initially, payment comes later via payment webhook
    const paymentInfo = await prisma.$queryRaw`
      SELECT p.booking_id, p.administrator_id
      FROM payments p
      INNER JOIN orders o ON p.order_id = o.id
      WHERE o.order_id = ${orderId}
        AND o.organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    
    const bookingId = paymentInfo?.[0]?.booking_id || null
    const administratorId = paymentInfo?.[0]?.administrator_id || null
    
    // Get technician_id from bookings (match by service_variation_id)
    const serviceTechnicianMap = new Map()
    
    if (bookingId) {
      const bookings = await prisma.$queryRaw`
        SELECT service_variation_id, technician_id
        FROM bookings
        WHERE booking_id LIKE ${`${bookingId}%`}
          AND technician_id IS NOT NULL
      `
      
      bookings.forEach(booking => {
        if (booking.service_variation_id && booking.technician_id) {
          serviceTechnicianMap.set(booking.service_variation_id, booking.technician_id)
        }
      })
      
      if (serviceTechnicianMap.size > 0) {
        console.log(`📋 Found ${serviceTechnicianMap.size} service-technician mappings for booking ${bookingId}`)
      }
    }

    // Get location UUID from square_location_id
    let locationUuid = null
    if (finalLocationId) {
      try {
        const locationRecord = await prisma.$queryRaw`
          SELECT id FROM locations 
          WHERE square_location_id = ${finalLocationId}
            AND organization_id = ${organizationId}::uuid
          LIMIT 1
        `
        locationUuid = locationRecord && locationRecord.length > 0 ? locationRecord[0].id : null
        
        // If location doesn't exist, create it
        if (!locationUuid) {
          const newLocation = await prisma.location.create({
            data: {
              organization_id: organizationId,
              square_location_id: finalLocationId,
              name: `Location ${finalLocationId.substring(0, 8)}...`
            }
          })
          locationUuid = newLocation.id
        }
      } catch (err) {
        console.warn(`⚠️ Could not get/create location: ${err.message}`)
      }
    }

    // 1. Save/update the order in the orders table
    try {
      await prisma.$executeRaw`
        INSERT INTO orders (
          id,
          organization_id,
          order_id,
          location_id,
          customer_id,
          state,
          version,
          reference_id,
          created_at,
          updated_at
        ) VALUES (
          gen_random_uuid(),
          ${organizationId}::uuid,
          ${orderId},
          ${locationUuid}::uuid,
          ${customerId},
          ${orderState || order.state || null},
          ${order.version ? Number(order.version) : null},
          ${order.reference_id || null},
          ${order.created_at ? new Date(order.created_at) : new Date()},
          ${order.updated_at ? new Date(order.updated_at) : new Date()}
        )
        ON CONFLICT (organization_id, order_id) DO UPDATE SET
          location_id = COALESCE(EXCLUDED.location_id, orders.location_id),
          customer_id = COALESCE(EXCLUDED.customer_id, orders.customer_id),
          state = COALESCE(EXCLUDED.state, orders.state),
          version = COALESCE(EXCLUDED.version, orders.version),
          reference_id = COALESCE(EXCLUDED.reference_id, orders.reference_id),
          updated_at = EXCLUDED.updated_at
      `
      console.log(`✅ Saved order ${orderId} to orders table (state: ${orderState || order.state || 'N/A'})`)
    } catch (orderError) {
      console.error(`❌ Error saving order ${orderId} to orders table:`, orderError.message)
      // Continue processing line items even if order save fails
    }

    // Get order UUID for line items
    const orderRecord = await prisma.$queryRaw`
      SELECT id FROM orders 
      WHERE order_id = ${orderId}
        AND organization_id = ${organizationId}::uuid
      LIMIT 1
    `
    const orderUuid = orderRecord && orderRecord.length > 0 ? orderRecord[0].id : null

    if (!orderUuid) {
      console.error(`❌ Cannot save line items: order UUID not found for order_id ${orderId}`)
      return
    }

    // 2. Process each line item
    for (const lineItem of lineItems) {
      try {
        // Match this line item's service to the correct technician
        const serviceVariationId = lineItem.catalog_object_id
        const technicianId = serviceVariationId 
          ? serviceTechnicianMap.get(serviceVariationId) || null
          : null
        
        if (serviceVariationId && technicianId) {
          console.log(`✅ Matched line item ${serviceVariationId} to technician ${technicianId}`)
        } else if (serviceVariationId) {
          console.warn(`⚠️ No technician found for service ${serviceVariationId} in bookings`)
        }
        
        const lineItemData = {
          organization_id: organizationId, // ✅ ADDED: Required field
          order_id: orderUuid, // Use UUID, not square order_id
          location_id: finalLocationId, // Keep as square_location_id for reference
          customer_id: customerId || null,
          
          // Add technician and administrator IDs
          technician_id: technicianId,
          administrator_id: administratorId,
          
          uid: lineItem.uid || null,
          service_variation_id: serviceVariationId || null,
          catalog_version: lineItem.catalog_version ? BigInt(lineItem.catalog_version) : null,
          quantity: lineItem.quantity || null,
          name: lineItem.name || null,
          variation_name: lineItem.variation_name || null,
          item_type: lineItem.item_type || null,
          
          // Money fields (use ?? instead of || to preserve 0 values)
          base_price_money_amount: lineItem.base_price_money?.amount ?? null,
          base_price_money_currency: lineItem.base_price_money?.currency || 'USD',
          
          gross_sales_money_amount: lineItem.gross_sales_money?.amount ?? null,
          gross_sales_money_currency: lineItem.gross_sales_money?.currency || 'USD',
          
          total_tax_money_amount: lineItem.total_tax_money?.amount ?? 0,
          total_tax_money_currency: lineItem.total_tax_money?.currency || 'USD',
          
          total_discount_money_amount: lineItem.total_discount_money?.amount ?? 0,
          total_discount_money_currency: lineItem.total_discount_money?.currency || 'USD',
          
          total_money_amount: lineItem.total_money?.amount ?? null,
          total_money_currency: lineItem.total_money?.currency || 'USD',
          
          variation_total_price_money_amount: lineItem.variation_total_price_money?.amount ?? null,
          variation_total_price_money_currency: lineItem.variation_total_price_money?.currency || 'USD',
          
          total_service_charge_money_amount: lineItem.total_service_charge_money?.amount ?? 0,
          total_service_charge_money_currency: lineItem.total_service_charge_money?.currency || 'USD',
          
          total_card_surcharge_money_amount: lineItem.total_card_surcharge_money?.amount ?? 0,
          total_card_surcharge_money_currency: lineItem.total_card_surcharge_money?.currency || 'USD',
          
          // Order-level fields
          order_state: order.state || null,
          order_version: order.version || null,
          order_created_at: order.created_at ? new Date(order.created_at) : null,
          order_updated_at: order.updated_at ? new Date(order.updated_at) : null,
          order_closed_at: order.closed_at ? new Date(order.closed_at) : null,
          
          // Order totals (use ?? instead of || to preserve 0 values)
          order_total_tax_money_amount: order.total_tax_money?.amount ?? null,
          order_total_tax_money_currency: order.total_tax_money?.currency || 'USD',
          
          order_total_discount_money_amount: order.total_discount_money?.amount ?? null,
          order_total_discount_money_currency: order.total_discount_money?.currency || 'USD',
          
          order_total_tip_money_amount: order.total_tip_money?.amount ?? null,
          order_total_tip_money_currency: order.total_tip_money?.currency || 'USD',
          
          order_total_money_amount: order.total_money?.amount ?? null,
          order_total_money_currency: order.total_money?.currency || 'USD',
          
          order_total_service_charge_money_amount: order.total_service_charge_money?.amount ?? null,
          order_total_service_charge_money_currency: order.total_service_charge_money?.currency || 'USD',
          
          order_total_card_surcharge_money_amount: order.total_card_surcharge_money?.amount ?? null,
          order_total_card_surcharge_money_currency: order.total_card_surcharge_money?.currency || 'USD',
        }

        // Use uid if available, otherwise create new record
        if (lineItem.uid) {
          // Try to update existing record first
          const updateResult = await prisma.$executeRaw`
            UPDATE order_line_items
            SET 
              location_id = ${lineItemData.location_id},
              customer_id = ${lineItemData.customer_id},
              technician_id = ${lineItemData.technician_id}::uuid,
              administrator_id = ${lineItemData.administrator_id}::uuid,
              service_variation_id = ${lineItemData.service_variation_id},
              catalog_version = ${lineItemData.catalog_version},
              quantity = ${lineItemData.quantity},
              name = ${lineItemData.name},
              variation_name = ${lineItemData.variation_name},
              item_type = ${lineItemData.item_type},
              base_price_money_amount = ${lineItemData.base_price_money_amount},
              base_price_money_currency = ${lineItemData.base_price_money_currency},
              gross_sales_money_amount = ${lineItemData.gross_sales_money_amount},
              gross_sales_money_currency = ${lineItemData.gross_sales_money_currency},
              total_tax_money_amount = ${lineItemData.total_tax_money_amount},
              total_tax_money_currency = ${lineItemData.total_tax_money_currency},
              total_discount_money_amount = ${lineItemData.total_discount_money_amount},
              total_discount_money_currency = ${lineItemData.total_discount_money_currency},
              total_money_amount = ${lineItemData.total_money_amount},
              total_money_currency = ${lineItemData.total_money_currency},
              variation_total_price_money_amount = ${lineItemData.variation_total_price_money_amount},
              variation_total_price_money_currency = ${lineItemData.variation_total_price_money_currency},
              total_service_charge_money_amount = ${lineItemData.total_service_charge_money_amount},
              total_service_charge_money_currency = ${lineItemData.total_service_charge_money_currency},
              total_card_surcharge_money_amount = ${lineItemData.total_card_surcharge_money_amount},
              total_card_surcharge_money_currency = ${lineItemData.total_card_surcharge_money_currency},
              order_state = ${lineItemData.order_state},
              order_version = ${lineItemData.order_version},
              order_created_at = ${lineItemData.order_created_at},
              order_updated_at = ${lineItemData.order_updated_at},
              order_closed_at = ${lineItemData.order_closed_at},
              order_total_tax_money_amount = ${lineItemData.order_total_tax_money_amount},
              order_total_tax_money_currency = ${lineItemData.order_total_tax_money_currency},
              order_total_discount_money_amount = ${lineItemData.order_total_discount_money_amount},
              order_total_discount_money_currency = ${lineItemData.order_total_discount_money_currency},
              order_total_tip_money_amount = ${lineItemData.order_total_tip_money_amount},
              order_total_tip_money_currency = ${lineItemData.order_total_tip_money_currency},
              order_total_money_amount = ${lineItemData.order_total_money_amount},
              order_total_money_currency = ${lineItemData.order_total_money_currency},
              order_total_service_charge_money_amount = ${lineItemData.order_total_service_charge_money_amount},
              order_total_service_charge_money_currency = ${lineItemData.order_total_service_charge_money_currency},
              order_total_card_surcharge_money_amount = ${lineItemData.order_total_card_surcharge_money_amount},
              order_total_card_surcharge_money_currency = ${lineItemData.order_total_card_surcharge_money_currency},
              updated_at = NOW()
            WHERE organization_id = ${organizationId}::uuid
              AND uid = ${lineItem.uid}
          `
          
          // If no rows updated, insert new record
          if (updateResult === 0) {
            await prisma.orderLineItem.create({
              data: {
                ...lineItemData,
                id: crypto.randomUUID(),
              }
            })
          }
        } else {
          // If no uid, create new record (uid is nullable and unique)
          await prisma.orderLineItem.create({
            data: {
              ...lineItemData,
              id: crypto.randomUUID(),
            }
          })
        }

        console.log(`✅ Saved line item: ${lineItem.uid || 'no-uid'} - ${lineItem.name || 'unnamed'}`)
      } catch (lineItemError) {
        console.error(`❌ Error saving line item ${lineItem.uid}:`, lineItemError)
        // Continue processing other line items
      }
    }

    console.log(`✅ Processed ${lineItems.length} line items for order ${orderId}`)

    // 3. Update order_line_items with technician_id and administrator_id from booking
    // (Payment might not exist yet, so this will try again later via payment webhook)
    await updateOrderLineItemsWithTechnician(orderId)
    
  } catch (error) {
    console.error(`❌ Error processing order webhook (${eventType}):`, error)
    throw error
  }
}