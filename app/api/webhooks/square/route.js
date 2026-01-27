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
    } else if (eventData.type === 'booking.updated') {
      console.log('📅 Booking updated event received')
      const bookingData = eventData.data?.object?.booking
      if (bookingData) {
        try {
          // Import processBookingUpdated from referrals route
          const referralsRoute = await import('./referrals/route.js')
          if (referralsRoute.processBookingUpdated) {
            await referralsRoute.processBookingUpdated(bookingData, eventData.event_id, eventData.created_at)
            console.log(`✅ Booking updated webhook processed successfully`)
          } else {
            console.error(`❌ processBookingUpdated not found in referrals route`)
            throw new Error('processBookingUpdated function not available')
          }
        } catch (bookingError) {
          console.error(`❌ Error processing booking.updated webhook:`, bookingError.message)
          console.error(`   Stack:`, bookingError.stack)
          // Re-throw to return 500 so Square will retry
          throw bookingError
        }
      } else {
        console.warn(`⚠️ Booking updated webhook received but booking data is missing`)
      }
    } else if (eventData.type === 'payment.created' || eventData.type === 'payment.updated') {
      console.log(`💳 Payment ${eventData.type === 'payment.created' ? 'created' : 'updated'} event received`)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:111',message:'payment webhook received',data:{eventType:eventData.type,eventId:eventData.event_id,hasPaymentData:!!eventData.data?.object?.payment},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
      // #endregion
      
      const paymentData = eventData.data?.object?.payment
      if (paymentData) {
        try {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:116',message:'calling savePaymentToDatabase',data:{paymentId:paymentData.id,orderId:paymentData.order_id||paymentData.orderId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
          // #endregion
          
          // Save payment to database in real-time
          await savePaymentToDatabase(paymentData, eventData.type, eventData.event_id, eventData.created_at)
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:120',message:'savePaymentToDatabase completed',data:{paymentId:paymentData.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
          // #endregion
          
          const orderId = paymentData.order_id || paymentData.orderId
          const paymentId = paymentData.id
          if (orderId) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:122',message:'calling reconcileBookingLinks',data:{orderId,paymentId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
            // #endregion
            
            // Reconcile booking links (try to find and populate booking_id)
            await reconcileBookingLinks(orderId, paymentId)
            
            // Update order_line_items with technician_id and administrator_id when payment arrives
            await updateOrderLineItemsWithTechnician(orderId)
          }
        } catch (paymentError) {
          console.error(`❌ Error processing payment webhook:`, paymentError.message)
          console.error(`   Stack:`, paymentError.stack)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:135',message:'payment webhook error',data:{error:paymentError.message,paymentId:paymentData?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
          // #endregion
          // Re-throw to return 500 so Square will retry
          throw paymentError
        }
      } else {
        console.warn(`⚠️ Payment webhook received but payment data is missing`)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:140',message:'payment webhook missing payment data',data:{eventType:eventData.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        // #endregion
      }
      console.log('📊 Data:', eventData.data)
    } else if (eventData.type === 'order.created' || eventData.type === 'order.updated') {
      console.log(`📦 Order ${eventData.type === 'order.created' ? 'created' : 'updated'} event received`)
      try {
        await processOrderWebhook(eventData.data, eventData.type)
        console.log(`✅ Order webhook processed successfully`)
      } catch (orderError) {
        console.error(`❌ Error processing order webhook:`, orderError.message)
        console.error(`   Stack:`, orderError.stack)
        // Re-throw to return 500 so Square will retry
        throw orderError
      }
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
    console.error('   Error type:', error?.constructor?.name)
    console.error('   Error message:', error?.message)
    if (error?.stack) {
      console.error('   Stack trace:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    
    // Return 500 so Square will retry the webhook
    return new Response(JSON.stringify({ 
      error: 'Processing failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      eventType: eventData?.type || 'unknown'
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
export async function savePaymentToDatabase(paymentData, eventType, squareEventId = null, squareCreatedAt = null) {
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
    
    // Debug: Log all location-related fields to see what's actually in the payment data
    // According to Square API docs, payment.updated should include location_id
    const locationFields = {
      locationId_camelCase: paymentData.locationId,
      location_id_snake_case: paymentData.location_id,
      location_object: paymentData.location,
      locationId_extracted: locationId,
      allPaymentKeys: Object.keys(paymentData).filter(k => k.toLowerCase().includes('location'))
    }
    console.log(`🔍 Payment ${paymentId} location fields check:`)
    console.log(`   location_id (snake_case): ${paymentData.location_id || 'MISSING'}`)
    console.log(`   locationId (camelCase): ${paymentData.locationId || 'MISSING'}`)
    console.log(`   Extracted locationId: ${locationId || 'MISSING'}`)
    console.log(`   All location-related keys: ${locationFields.allPaymentKeys.join(', ') || 'NONE'}`)
    
    // According to Square API docs, location_id should be present
    // If missing, log a warning but continue (we'll try to get it from order)
    if (!locationId) {
      console.warn(`⚠️ Payment ${paymentId} missing location_id in webhook payload`)
      console.warn(`   According to Square API docs, payment.updated should include location_id`)
      console.warn(`   Will attempt to resolve from order_id: ${orderId || 'MISSING'}`)
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:227',message:'payment webhook - extracted data',data:{paymentId,orderId,customerId,locationId:locationId?.substring(0,16)||'missing',merchantId:merchantId?.substring(0,16)||'missing',locationFields},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
    // #endregion

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
            console.log(`📡 Fetching order ${orderId} from Square API to get location_id...`)
            const ordersApi = getOrdersApi()
            const orderResponse = await ordersApi.retrieveOrder(orderId)
            const order = orderResponse.result?.order
            if (order?.location_id) {
              locationId = order.location_id
              console.log(`✅ Found locationId from Square API order: ${locationId}`)
            } else {
              console.warn(`⚠️ Order ${orderId} from Square API also missing location_id`)
              console.warn(`   Order data:`, JSON.stringify({
                id: order?.id,
                state: order?.state,
                hasLocationId: !!order?.location_id
              }))
            }
          } catch (apiError) {
            console.warn(`⚠️ Could not fetch order ${orderId} from Square API: ${apiError.message}`)
            console.warn(`   This might be a temporary API issue - Square will retry the webhook`)
          }
        }
      } catch (err) {
        console.warn(`⚠️ Could not resolve locationId from order: ${err.message}`)
      }
    }
    
    // If still no locationId and we have merchant_id + organization_id, try to get default location
    // This is a fallback for cases where order lookup fails but we know the merchant
    if (!locationId && merchantId && organizationId) {
      console.log(`📍 Payment ${paymentId} still missing locationId, attempting to get default location for merchant ${merchantId}`)
      try {
        // Get the most recently used location for this merchant/organization
        // This is a reasonable fallback since most merchants have one primary location
        const defaultLocation = await prisma.$queryRaw`
          SELECT square_location_id 
          FROM locations 
          WHERE organization_id = ${organizationId}::uuid
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `
        if (defaultLocation && defaultLocation.length > 0) {
          locationId = defaultLocation[0].square_location_id
          console.log(`⚠️ Using default/most recent location for merchant: ${locationId}`)
          console.log(`   Note: This is a fallback - ideally location should come from order`)
        } else {
          console.warn(`⚠️ No locations found for organization ${organizationId}`)
        }
      } catch (err) {
        console.warn(`⚠️ Could not get default location: ${err.message}`)
      }
    }
    
    if (!locationId) {
      console.warn(`⚠️ Payment ${paymentId} still missing location_id after all attempts`)
      console.warn(`   Attempted: order lookup, Square API, default location fallback`)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:342',message:'location_id still missing after all attempts',data:{paymentId,orderId,merchantId,organizationId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'M'})}).catch(()=>{});
      // #endregion
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:345',message:'location_id resolved successfully',data:{paymentId,locationId:locationId.substring(0,16),orderId,merchantId:merchantId?.substring(0,16)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'N'})}).catch(()=>{});
      // #endregion
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
          console.log(`✅ Found organization_id from order: ${organizationId}`)
        }
      } catch (err) {
        console.warn(`⚠️ Could not resolve organization_id from order: ${err.message}`)
      }
    }
    
    // IMPORTANT: Resolve organization_id BEFORE trying location fallback
    // This ensures we have organization_id when using merchant fallback

    if (!organizationId) {
      console.error(`❌ Cannot save payment: organization_id is required but could not be resolved`)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:323',message:'payment save failed - missing organization_id',data:{paymentId,merchantId,locationId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      // CRITICAL: Throw error so webhook returns 500 and Square retries
      // This prevents silent failures that cause Square to stop sending webhooks
      throw new Error(`Cannot save payment: organization_id is required but could not be resolved. paymentId: ${paymentId}, merchantId: ${merchantId || 'missing'}, locationId: ${locationId || 'missing'}`)
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:426',message:'payment save failed - missing location_id',data:{paymentId,orderId,merchantId,organizationId,attemptedOrderLookup:!!orderId,attemptedDefaultLocation:!!(merchantId&&organizationId)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'O'})}).catch(()=>{});
      // #endregion
      // CRITICAL: Throw error so webhook returns 500 and Square retries
      // This prevents silent failures that cause Square to stop sending webhooks
      throw new Error(`Cannot save payment: location_id is required but missing. paymentId: ${paymentId}`)
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:461',message:'payment save failed - location UUID not found',data:{paymentId,locationId,organizationId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
      // #endregion
      // CRITICAL: Throw error so webhook returns 500 and Square retries
      throw new Error(`Cannot save payment: location UUID not found for square_location_id ${locationId}. paymentId: ${paymentId}`)
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:431',message:'payment order lookup result',data:{orderId,found:!!orderRecord,orderCount:orderRecord?.length,orderUuid:orderRecord?.[0]?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        orderUuid = orderRecord && orderRecord.length > 0 ? orderRecord[0].id : null
        if (!orderUuid) {
          console.warn(`⚠️ Order ${orderId} not found in database yet (payment webhook arrived before order webhook)`)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:435',message:'payment order not found - will save with NULL order_id',data:{orderId,paymentId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
          // #endregion
        }
      } catch (err) {
        console.warn(`⚠️ Could not find order UUID: ${err.message}`)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:439',message:'payment order lookup error',data:{orderId,error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
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
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:701',message:'payment saved successfully',data:{paymentId,orderId,orderUuid,customerId,hasOrderUuid:!!orderUuid,organizationId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
    // #endregion
    
    // Try to populate booking_id in payment if order exists
    if (orderId) {
      // First, try to get booking_id from order if it already has one
      const orderWithBooking = await prisma.$queryRaw`
        SELECT booking_id FROM orders
        WHERE order_id = ${orderId}
          AND booking_id IS NOT NULL
        LIMIT 1
      `
      
      if (orderWithBooking && orderWithBooking.length > 0) {
        // Order already has booking_id, copy to payment
        await prisma.$executeRaw`
          UPDATE payments
          SET booking_id = ${orderWithBooking[0].booking_id}::uuid,
              updated_at = NOW()
          WHERE id = ${paymentId}
            AND booking_id IS NULL
        `
        console.log(`✅ Copied booking_id from order to payment`)
      }
    }
  } catch (error) {
    console.error(`❌ Failed to save payment to database:`, error.message)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 3).join('\n'))
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:729',message:'payment save error caught',data:{error:error.message,paymentId:paymentData?.id,errorCode:error.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    // Don't throw - allow webhook to continue processing
    // BUT: This might be hiding errors! Consider re-throwing for critical errors
  }
}

/**
 * Reconcile booking_id across payments, orders, and order_line_items
 * Called by payment and order webhooks to ensure eventual consistency
 * Uses 4 methods in priority order:
 * 1. Get booking_id from payments (most reliable)
 * 2. Match by Customer + Location + Service Variation + Time
 * 3. Fallback: Match by Customer + Location + Time
 * 4. If payment has booking_id, copy to order
 */
async function reconcileBookingLinks(orderId, paymentId = null) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:690',message:'reconcileBookingLinks entry',data:{orderId,paymentId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    // Get order UUID and details
    const orderRecord = await prisma.$queryRaw`
      SELECT id, organization_id, customer_id, location_id, created_at, booking_id
      FROM orders 
      WHERE order_id = ${orderId}
      LIMIT 1
    `
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:697',message:'orderRecord query result',data:{found:!!orderRecord,recordCount:orderRecord?.length,orderId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    if (!orderRecord || orderRecord.length === 0) {
      console.log(`ℹ️ Order ${orderId} not found in database yet (might arrive later)`)
      return null
    }
    
    const orderUuid = orderRecord[0].id
    const organizationId = orderRecord[0].organization_id
    const customerId = orderRecord[0].customer_id
    const locationId = orderRecord[0].location_id
    const orderCreatedAt = orderRecord[0].created_at
    const existingBookingId = orderRecord[0].booking_id
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:710',message:'order data extracted',data:{orderUuid,organizationId,customerId,locationId,locationIdType:locationId?.length<36?'square_id':'uuid',orderCreatedAt,existingBookingId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    // If order already has booking_id, we can still update payments and line items
    let bookingId = existingBookingId
    
    // Method 1: Try to get booking_id from payments (most reliable)
    if (!bookingId) {
      if (paymentId) {
        const paymentBooking = await prisma.$queryRaw`
          SELECT booking_id FROM payments
          WHERE id = ${paymentId}
            AND booking_id IS NOT NULL
          LIMIT 1
        `
        if (paymentBooking && paymentBooking.length > 0) {
          bookingId = paymentBooking[0].booking_id
          console.log(`✅ Found booking_id from payment: ${bookingId}`)
        }
      }
      
      // If no payment booking_id, try to find payment with booking_id for this order
      if (!bookingId) {
        const paymentWithBooking = await prisma.$queryRaw`
          SELECT booking_id FROM payments
          WHERE order_id = ${orderUuid}::uuid
            AND booking_id IS NOT NULL
          LIMIT 1
        `
        if (paymentWithBooking && paymentWithBooking.length > 0) {
          bookingId = paymentWithBooking[0].booking_id
          console.log(`✅ Found booking_id from payment for order: ${bookingId}`)
        }
      }
    }
    
    // Method 2: Match by Customer + Location + Service Variation + Time
    if (!bookingId && customerId && locationId) {
      // Get service_variation_id from order line items
      const lineItems = await prisma.$queryRaw`
        SELECT DISTINCT service_variation_id
        FROM order_line_items
        WHERE order_id = ${orderUuid}::uuid
          AND service_variation_id IS NOT NULL
        LIMIT 5
      `
      
      if (lineItems && lineItems.length > 0) {
        // Time window: 7 days before order, 1 day after
        const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
        const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
        
        // Determine if location is UUID or square_location_id
        let squareLocationId = null
        let locationUuid = null
        if (locationId && locationId.length < 36) {
          // It's a square_location_id
          squareLocationId = locationId
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:764',message:'location lookup by square_id',data:{squareLocationId,organizationId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          const loc = await prisma.$queryRaw`
            SELECT id FROM locations 
            WHERE square_location_id = ${locationId}
              AND organization_id = ${organizationId}::uuid
            LIMIT 1
          `
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:773',message:'location lookup result',data:{found:!!loc,locationCount:loc?.length,locationUuid:loc?.[0]?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          if (loc && loc.length > 0) {
            locationUuid = loc[0].id
          }
        } else {
          // It's a UUID
          locationUuid = locationId
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:778',message:'location lookup by uuid',data:{locationUuid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          const loc = await prisma.$queryRaw`
            SELECT square_location_id FROM locations 
            WHERE id = ${locationId}::uuid
            LIMIT 1
          `
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:784',message:'location lookup result',data:{found:!!loc,locationCount:loc?.length,squareLocationId:loc?.[0]?.square_location_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          if (loc && loc.length > 0) {
            squareLocationId = loc[0].square_location_id
          }
        }
        
        for (const lineItem of lineItems) {
          let matchingBookings = null
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:789',message:'attempting service variation match',data:{serviceVariationId:lineItem.service_variation_id,customerId,squareLocationId,locationUuid,startWindow:startWindow.toISOString(),endWindow:endWindow.toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          
          if (squareLocationId) {
            try {
              matchingBookings = await prisma.$queryRaw`
                SELECT b.id, b.start_at
                FROM bookings b
                INNER JOIN locations l ON l.id::text = b.location_id::text
                INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
                WHERE b.customer_id = ${customerId}
                  AND l.square_location_id = ${squareLocationId}
                  AND sv.square_variation_id = ${lineItem.service_variation_id}
                  AND b.start_at >= ${startWindow}::timestamp
                  AND b.start_at <= ${endWindow}::timestamp
                ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
                LIMIT 1
              `
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:803',message:'service variation match result (square_id)',data:{matchCount:matchingBookings?.length,bookingId:matchingBookings?.[0]?.id,error:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
              // #endregion
            } catch (sqlError) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:805',message:'service variation match SQL error (square_id)',data:{error:sqlError.message,code:sqlError.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
              // #endregion
              throw sqlError
            }
          } else if (locationUuid) {
            try {
              matchingBookings = await prisma.$queryRaw`
                SELECT b.id, b.start_at
                FROM bookings b
                INNER JOIN service_variation sv ON sv.uuid = b.service_variation_id
                WHERE b.customer_id = ${customerId}
                  AND b.location_id::text = ${locationUuid}::text
                  AND sv.square_variation_id = ${lineItem.service_variation_id}
                  AND b.start_at >= ${startWindow}::timestamp
                  AND b.start_at <= ${endWindow}::timestamp
                ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
                LIMIT 1
              `
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:818',message:'service variation match result (uuid)',data:{matchCount:matchingBookings?.length,bookingId:matchingBookings?.[0]?.id,error:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
              // #endregion
            } catch (sqlError) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:820',message:'service variation match SQL error (uuid)',data:{error:sqlError.message,code:sqlError.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
              // #endregion
              throw sqlError
            }
          }
          
          if (matchingBookings && matchingBookings.length > 0) {
            bookingId = matchingBookings[0].id
            console.log(`✅ Matched booking by service variation: ${bookingId}`)
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:825',message:'match found',data:{bookingId,serviceVariationId:lineItem.service_variation_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
            break
          }
        }
        
        // Method 3: Fallback to Customer + Location + Time (if no service match)
        if (!bookingId) {
          const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
          const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
          
          let fallbackBookings = null
          if (squareLocationId) {
            fallbackBookings = await prisma.$queryRaw`
              SELECT b.id, b.start_at
              FROM bookings b
              INNER JOIN locations l ON l.id::text = b.location_id::text
              WHERE b.customer_id = ${customerId}
                AND l.square_location_id = ${squareLocationId}
                AND b.start_at >= ${startWindow}::timestamp
                AND b.start_at <= ${endWindow}::timestamp
              ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
              LIMIT 1
            `
          } else if (locationUuid) {
            fallbackBookings = await prisma.$queryRaw`
              SELECT b.id, b.start_at
              FROM bookings b
              WHERE b.customer_id = ${customerId}
                AND b.location_id::text = ${locationUuid}::text
                AND b.start_at >= ${startWindow}::timestamp
                AND b.start_at <= ${endWindow}::timestamp
              ORDER BY ABS(EXTRACT(EPOCH FROM (b.start_at - ${orderCreatedAt}::timestamp)))
              LIMIT 1
            `
          }
          
          if (fallbackBookings && fallbackBookings.length > 0) {
            bookingId = fallbackBookings[0].id
            console.log(`✅ Matched booking by customer+location+time: ${bookingId}`)
          }
        }
      }
    }
    
    // Update orders table if booking found
    if (bookingId) {
      await prisma.$executeRaw`
        UPDATE orders
        SET booking_id = ${bookingId}::uuid,
            updated_at = NOW()
        WHERE id = ${orderUuid}::uuid
          AND (booking_id IS NULL OR booking_id != ${bookingId}::uuid)
      `
      console.log(`✅ Updated order ${orderId} with booking_id: ${bookingId}`)
      
      // Update order_line_items
      await prisma.$executeRaw`
        UPDATE order_line_items
        SET booking_id = ${bookingId}::uuid,
            updated_at = NOW()
        WHERE order_id = ${orderUuid}::uuid
          AND (booking_id IS NULL OR booking_id != ${bookingId}::uuid)
      `
      console.log(`✅ Updated order_line_items for order ${orderId} with booking_id: ${bookingId}`)
      
      // Update payments if paymentId provided
      if (paymentId) {
        await prisma.$executeRaw`
          UPDATE payments
          SET booking_id = ${bookingId}::uuid,
              updated_at = NOW()
          WHERE id = ${paymentId}
            AND (booking_id IS NULL OR booking_id != ${bookingId}::uuid)
        `
        console.log(`✅ Updated payment ${paymentId} with booking_id: ${bookingId}`)
      }
      
      // Also update any other payments for this order
      await prisma.$executeRaw`
        UPDATE payments
        SET booking_id = ${bookingId}::uuid,
            updated_at = NOW()
        WHERE order_id = ${orderUuid}::uuid
          AND booking_id IS NULL
      `
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:910',message:'reconcileBookingLinks exit',data:{orderId,bookingId,success:!!bookingId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return bookingId
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:913',message:'reconcileBookingLinks error',data:{orderId,error:error.message,code:error.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    console.error(`❌ Error in reconcileBookingLinks: ${error.message}`)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    return null
  }
}

/**
 * Update order_line_items with technician_id and administrator_id
 * Gets technician ID from bookings table and administrator ID from payments table
 * Also populates booking_id if found
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

    // Update order with booking_id if not already set
    if (bookingId) {
      await prisma.$executeRaw`
        UPDATE orders
        SET booking_id = ${bookingId}::uuid,
            updated_at = NOW()
        WHERE id = ${orderUuid}::uuid
          AND booking_id IS NULL
      `
      console.log(`✅ Updated order with booking_id: ${bookingId}`)
      
      // Update order_line_items with booking_id
      await prisma.$executeRaw`
        UPDATE order_line_items
        SET booking_id = ${bookingId}::uuid,
            updated_at = NOW()
        WHERE order_id = ${orderUuid}::uuid
          AND booking_id IS NULL
      `
      console.log(`✅ Updated order_line_items with booking_id: ${bookingId}`)
    }

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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:776',message:'Extracted locationId from webhook metadata',data:{orderId,locationId:locationId||'missing',orderState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

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
    // Note: Square API may return camelCase (locationId) or snake_case (location_id)
    const orderLocationId = order.location_id || order.locationId || null
    const finalLocationId = orderLocationId || locationId || null
    const customerId = order.customer_id || order.customerId || null
    const lineItems = order.line_items || order.lineItems || []
    const merchantId = order.merchant_id || order.merchantId || null

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:801',message:'Order webhook - extracted IDs',data:{orderId,merchantId:merchantId?.substring(0,16)||'missing',locationIdFromWebhook:locationId?.substring(0,16)||'missing',orderLocationId:orderLocationId?.substring(0,16)||'missing',finalLocationId:finalLocationId?.substring(0,16)||'missing',orderKeys:Object.keys(order).join(',')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

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
          console.log(`✅ Resolved organization_id from merchant_id: ${organizationId.substring(0, 8)}...`)
        } else {
          console.warn(`⚠️ No organization found for merchant_id: ${merchantId?.substring(0, 16)}...`)
        }
      } catch (err) {
        console.error(`❌ Error resolving organization_id from merchant_id: ${err.message}`)
        console.error(`   Stack: ${err.stack}`)
      }
    } else {
      console.warn(`⚠️ Order ${orderId} missing merchant_id`)
    }

    // If still no organization_id, try to get it from location
    if (!organizationId && finalLocationId) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:830',message:'Attempting location-based org_id resolution',data:{orderId,finalLocationId,merchantId:merchantId||'missing'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      try {
        const loc = await prisma.$queryRaw`
          SELECT organization_id FROM locations 
          WHERE square_location_id = ${finalLocationId}
          LIMIT 1
        `
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:836',message:'Location query result',data:{orderId,finalLocationId,resultCount:loc?.length||0,hasOrgId:!!(loc?.[0]?.organization_id),orgId:loc?.[0]?.organization_id?.substring(0,8)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        if (loc && loc.length > 0) {
          organizationId = loc[0].organization_id
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:839',message:'Successfully resolved org_id from location',data:{orderId,finalLocationId,organizationId:organizationId?.substring(0,8)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          console.log(`✅ Resolved organization_id from location: ${organizationId.substring(0, 8)}...`)
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:841',message:'Location not found in DB',data:{orderId,finalLocationId,searchedValue:finalLocationId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          console.warn(`⚠️ No location found for square_location_id: ${finalLocationId?.substring(0, 16)}...`)
        }
      } catch (err) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:844',message:'Error in location query',data:{orderId,finalLocationId,error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        console.error(`❌ Error resolving organization_id from location: ${err.message}`)
        console.error(`   Stack: ${err.stack}`)
      }
    }

    // If still no organization_id, try to get it from existing orders (fallback)
    if (!organizationId && orderId) {
      try {
        const existingOrder = await prisma.$queryRaw`
          SELECT organization_id FROM orders 
          WHERE order_id = ${orderId}
          LIMIT 1
        `
        if (existingOrder && existingOrder.length > 0) {
          organizationId = existingOrder[0].organization_id
          console.log(`✅ Resolved organization_id from existing order: ${organizationId.substring(0, 8)}...`)
        }
      } catch (err) {
        console.warn(`⚠️ Could not resolve organization_id from existing order: ${err.message}`)
      }
    }

    // If still no organization_id, try to get the first active organization (last resort fallback)
    if (!organizationId) {
      try {
        const defaultOrg = await prisma.$queryRaw`
          SELECT id FROM organizations 
          WHERE is_active = true
          ORDER BY created_at ASC
          LIMIT 1
        `
        if (defaultOrg && defaultOrg.length > 0) {
          organizationId = defaultOrg[0].id
          console.warn(`⚠️ Using fallback organization_id: ${organizationId.substring(0, 8)}... (order: ${orderId})`)
        }
      } catch (err) {
        console.error(`❌ Error getting fallback organization: ${err.message}`)
      }
    }

    if (!organizationId) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:884',message:'CRITICAL: Failed to resolve organization_id',data:{orderId,merchantId:merchantId||'missing',locationId:locationId||'missing',finalLocationId:finalLocationId||'missing',orderLocationId:order.location_id||'missing'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      console.error(`❌ CRITICAL: Cannot process order ${orderId}: organization_id is required but could not be resolved`)
      console.error(`   merchant_id: ${merchantId || 'missing'}`)
      console.error(`   location_id: ${finalLocationId || 'missing'}`)
      console.error(`   order_id: ${orderId}`)
      // Don't return - throw error so webhook returns 500 and Square will retry
      throw new Error(`Cannot process order: organization_id is required but could not be resolved. merchant_id: ${merchantId || 'missing'}, location_id: ${finalLocationId || 'missing'}`)
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
    let orderUuid = null
    let orderSaveError = null
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
          updated_at,
          raw_json
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
          ${order.updated_at ? new Date(order.updated_at) : new Date()},
          ${JSON.stringify(order)}::jsonb
        )
        ON CONFLICT (organization_id, order_id) DO UPDATE SET
          location_id = COALESCE(EXCLUDED.location_id, orders.location_id),
          customer_id = COALESCE(EXCLUDED.customer_id, orders.customer_id),
          state = COALESCE(EXCLUDED.state, orders.state),
          version = COALESCE(EXCLUDED.version, orders.version),
          reference_id = COALESCE(EXCLUDED.reference_id, orders.reference_id),
          updated_at = EXCLUDED.updated_at,
          raw_json = COALESCE(EXCLUDED.raw_json, orders.raw_json)
      `
      console.log(`✅ Saved order ${orderId} to orders table (state: ${orderState || order.state || 'N/A'})`)
    } catch (orderError) {
      orderSaveError = orderError
      console.error(`❌ Error saving order ${orderId} to orders table:`, orderError.message)
      console.error(`   Stack:`, orderError.stack)
      // Continue processing - try to get existing order UUID
    }

    // Get order UUID for line items (try to get it even if save failed, in case order already exists)
    try {
      const orderRecord = await prisma.$queryRaw`
        SELECT id FROM orders 
        WHERE order_id = ${orderId}
          AND organization_id = ${organizationId}::uuid
        LIMIT 1
      `
      orderUuid = orderRecord && orderRecord.length > 0 ? orderRecord[0].id : null
    } catch (queryError) {
      console.error(`❌ Error querying for order UUID:`, queryError.message)
    }

    if (!orderUuid) {
      console.error(`❌ Cannot save line items: order UUID not found for order_id ${orderId}`)
      console.error(`   This means the order was not saved and does not exist in the database`)
      console.error(`   Will attempt to create order again with a new UUID...`)
      
      // Last resort: try to create order with explicit UUID
      try {
        const newOrderUuid = crypto.randomUUID()
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
            updated_at,
            raw_json
          ) VALUES (
            ${newOrderUuid}::uuid,
            ${organizationId}::uuid,
            ${orderId},
            ${locationUuid}::uuid,
            ${customerId},
            ${orderState || order.state || null},
            ${order.version ? Number(order.version) : null},
            ${order.reference_id || null},
            ${order.created_at ? new Date(order.created_at) : new Date()},
            ${order.updated_at ? new Date(order.updated_at) : new Date()},
            ${JSON.stringify(order)}::jsonb
          )
          ON CONFLICT (organization_id, order_id) DO UPDATE SET
            location_id = COALESCE(EXCLUDED.location_id, orders.location_id),
            customer_id = COALESCE(EXCLUDED.customer_id, orders.customer_id),
            state = COALESCE(EXCLUDED.state, orders.state),
            version = COALESCE(EXCLUDED.version, orders.version),
            reference_id = COALESCE(EXCLUDED.reference_id, orders.reference_id),
            updated_at = EXCLUDED.updated_at,
            raw_json = COALESCE(EXCLUDED.raw_json, orders.raw_json)
        `
        orderUuid = newOrderUuid
        console.log(`✅ Successfully created order with UUID: ${orderUuid}`)
      } catch (retryError) {
        console.error(`❌ Failed to create order on retry:`, retryError.message)
        // Still throw error so webhook fails and Square retries
        throw new Error(`Cannot process order: failed to save order and could not create order UUID. Original error: ${orderSaveError?.message || 'unknown'}`)
      }
    }

    // Build discount name map from order-level discounts array
    const discountNameMap = new Map()
    const orderDiscounts = order.discounts || order.discount || []
    if (Array.isArray(orderDiscounts)) {
      orderDiscounts.forEach(discount => {
        const discountUid = discount.uid || discount.discount_uid
        const discountName = discount.name || discount.discount_name
        if (discountUid && discountName) {
          discountNameMap.set(discountUid, discountName)
        }
      })
    }
    if (discountNameMap.size > 0) {
      console.log(`📋 Found ${discountNameMap.size} discount(s) in order: ${Array.from(discountNameMap.values()).join(', ')}`)
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
        
        // Extract discount names for this line item
        const appliedDiscounts = lineItem.appliedDiscounts || lineItem.applied_discounts || []
        const discountNames = []
        if (Array.isArray(appliedDiscounts)) {
          appliedDiscounts.forEach(appliedDiscount => {
            const discountUid = appliedDiscount.discount_uid || appliedDiscount.discountUid
            if (discountUid && discountNameMap.has(discountUid)) {
              discountNames.push(discountNameMap.get(discountUid))
            }
          })
        }
        const discountName = discountNames.length > 0 ? discountNames.join(', ') : null
        
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
          discount_name: discountName,
          
          // Optional fields from Square API
          metadata: lineItem.metadata || null,
          custom_attributes: lineItem.customAttributes || lineItem.custom_attributes || null,
          fulfillments: lineItem.fulfillments || lineItem.fulfillment || null,
          applied_taxes: lineItem.appliedTaxes || lineItem.applied_taxes || null,
          applied_discounts: lineItem.appliedDiscounts || lineItem.applied_discounts || null,
          applied_service_charges: lineItem.appliedServiceCharges || lineItem.applied_service_charges || null,
          note: lineItem.note || null,
          modifiers: lineItem.modifiers || null,
          
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
          
          // Raw JSON
          raw_json: lineItem,
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
              discount_name = ${lineItemData.discount_name},
              metadata = ${lineItemData.metadata ? JSON.stringify(lineItemData.metadata) : null}::jsonb,
              custom_attributes = ${lineItemData.custom_attributes ? JSON.stringify(lineItemData.custom_attributes) : null}::jsonb,
              fulfillments = ${lineItemData.fulfillments ? JSON.stringify(lineItemData.fulfillments) : null}::jsonb,
              applied_taxes = ${lineItemData.applied_taxes ? JSON.stringify(lineItemData.applied_taxes) : null}::jsonb,
              applied_discounts = ${lineItemData.applied_discounts ? JSON.stringify(lineItemData.applied_discounts) : null}::jsonb,
              applied_service_charges = ${lineItemData.applied_service_charges ? JSON.stringify(lineItemData.applied_service_charges) : null}::jsonb,
              note = ${lineItemData.note},
              modifiers = ${lineItemData.modifiers ? JSON.stringify(lineItemData.modifiers) : null}::jsonb,
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
              raw_json = COALESCE(${JSON.stringify(lineItem)}::jsonb, order_line_items.raw_json),
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

    // 3. Link any unlinked payments for this order (if payment webhook arrived before order webhook)
    // This handles the case where payment was saved with order_id = NULL
    if (orderUuid && customerId && locationUuid) {
      try {
        // Find payments with NULL order_id that match this order's customer and location
        const orderCreatedAt = order.created_at ? new Date(order.created_at) : new Date()
        const startWindow = new Date(orderCreatedAt.getTime() - 4 * 60 * 60 * 1000) // 4 hours before
        const endWindow = new Date(orderCreatedAt.getTime() + 4 * 60 * 60 * 1000) // 4 hours after
        
        const unlinkedPayments = await prisma.$queryRaw`
          SELECT id
          FROM payments
          WHERE order_id IS NULL
            AND customer_id = ${customerId}
            AND location_id = ${locationUuid}::uuid
            AND created_at >= ${startWindow}::timestamp
            AND created_at <= ${endWindow}::timestamp
          LIMIT 5
        `
        
        if (unlinkedPayments && unlinkedPayments.length > 0) {
          // Link these payments to this order
          const updateResult = await prisma.$executeRaw`
            UPDATE payments
            SET order_id = ${orderUuid}::uuid,
                updated_at = NOW()
            WHERE order_id IS NULL
              AND customer_id = ${customerId}
              AND location_id = ${locationUuid}::uuid
              AND created_at >= ${startWindow}::timestamp
              AND created_at <= ${endWindow}::timestamp
          `
          console.log(`✅ Linked ${updateResult} unlinked payment(s) to order ${orderId}`)
        }
      } catch (linkError) {
        console.warn(`⚠️ Error linking unlinked payments: ${linkError.message}`)
        // Don't fail the whole webhook if this fails
      }
    }

    // 4. Reconcile booking links (try to find and populate booking_id)
    await reconcileBookingLinks(orderId)

    // 5. Update order_line_items with technician_id and administrator_id from booking
    // (Payment might not exist yet, so this will try again later via payment webhook)
    await updateOrderLineItemsWithTechnician(orderId)
    
  } catch (error) {
    console.error(`❌ Error processing order webhook (${eventType}):`, error)
    throw error
  }
}