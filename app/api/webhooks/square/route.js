import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '../../../../lib/prisma-client'
import locationResolver from '../../../../lib/location-resolver'

const { resolveLocationUuidForSquareLocationId } = locationResolver

// Helper to safely stringify objects with BigInt values
function safeStringify(value) {
  try {
    return JSON.stringify(value, (_key, val) => 
      typeof val === 'bigint' ? val.toString() : val
    )
  } catch (error) {
    // If stringification fails (circular reference, etc.), return a safe fallback
    console.warn('⚠️ safeStringify failed, using fallback:', error.message)
    try {
      // Try again with a more aggressive replacer that handles more edge cases
      return JSON.stringify(value, (_key, val) => {
        if (typeof val === 'bigint') return val.toString()
        if (val === undefined) return null
        if (typeof val === 'function') return '[Function]'
        if (val instanceof Error) return val.message
        return val
      })
    } catch (fallbackError) {
      return '[Unserializable value]'
    }
  }
}

// Helper to safely serialize data for JSON responses (converts BigInt to string)
function serializeBigInt(data) {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  )
}

// Helper to safely log errors that might contain BigInt values
function safeLogError(message, error) {
  const errorInfo = {
    message: error?.message || String(error),
    name: error?.name,
    code: error?.code,
    stack: error?.stack?.split('\n').slice(0, 5).join('\n')
  }
  console.error(message, safeStringify(errorInfo))
}

// Import square-env using dynamic require inside function to avoid webpack static analysis
function getSquareEnvironmentName() {
  // eslint-disable-next-line global-require
  const squareEnv = require('../../../../lib/utils/square-env')
  return squareEnv.getSquareEnvironmentName()
}

const { 
  getOrdersApi, 
  getLocationsApi, 
  getBookingsApi 
} = require('../../../../lib/utils/square-client')

/**
 * Derive booking_id from Square API
 * 
 * This function:
 * 1. Calls Square Orders API to get full order with line_items
 * 2. Calls Square Bookings API (listBookings) with customerId, locationId, date range
 * 3. Matches bookings by service_variation_id overlap
 * 4. Filters by time: booking.start_at <= order.created_at (service finished before payment)
 * 5. Selects the closest match by time proximity
 * 
 * @param {string} squareOrderId - Square order ID
 * @returns {Promise<{bookingId: string|null, confidence: string, source: string}>}
 */
async function deriveBookingFromSquareApi(squareOrderId) {
  console.log(`🔍 [DERIVE-BOOKING] Starting Square API-based booking derivation for order ${squareOrderId}`)
  
  try {
    // Step 1: Get full order from Square API
    const ordersApi = getOrdersApi()
    const orderResponse = await ordersApi.retrieveOrder(squareOrderId)
    const order = orderResponse.result?.order
    
    if (!order) {
      console.warn(`⚠️ [DERIVE-BOOKING] Order ${squareOrderId} not found in Square API`)
      return { bookingId: null, confidence: 'none', source: 'order_not_found' }
    }
    
    const customerId = order.customerId
    const locationId = order.locationId
    const orderCreatedAt = order.createdAt ? new Date(order.createdAt) : new Date()
    const lineItems = order.lineItems || []
    
    console.log(`📋 [DERIVE-BOOKING] Order details:`)
    console.log(`   Customer ID: ${customerId}`)
    console.log(`   Location ID: ${locationId}`)
    console.log(`   Order Created: ${orderCreatedAt.toISOString()}`)
    console.log(`   Line Items: ${lineItems.length}`)
    
    if (!customerId) {
      console.warn(`⚠️ [DERIVE-BOOKING] Order ${squareOrderId} has no customer_id`)
      return { bookingId: null, confidence: 'none', source: 'no_customer_id' }
    }
    
    if (!locationId) {
      console.warn(`⚠️ [DERIVE-BOOKING] Order ${squareOrderId} has no location_id`)
      return { bookingId: null, confidence: 'none', source: 'no_location_id' }
    }
    
    // Extract service_variation_ids (catalog_object_id) from line items
    const serviceVariationIds = lineItems
      .map(li => li.catalogObjectId)
      .filter(id => id && id.startsWith && !id.startsWith('CUSTOM_AMOUNT'))
    
    console.log(`   Service Variation IDs: ${serviceVariationIds.join(', ') || 'none'}`)
    
    if (serviceVariationIds.length === 0) {
      console.warn(`⚠️ [DERIVE-BOOKING] Order ${squareOrderId} has no service variation IDs`)
      return { bookingId: null, confidence: 'none', source: 'no_service_variations' }
    }
    
    // Step 2: Get bookings from Square API
    // Time window: Start of order day to order time (booking happened before payment)
    const startOfDay = new Date(orderCreatedAt)
    startOfDay.setHours(0, 0, 0, 0)
    
    // End of day + 4 hours buffer (in case of late payment)
    const endOfWindow = new Date(orderCreatedAt)
    endOfWindow.setHours(23, 59, 59, 999)
    
    console.log(`📅 [DERIVE-BOOKING] Searching bookings:`)
    console.log(`   Start: ${startOfDay.toISOString()}`)
    console.log(`   End: ${endOfWindow.toISOString()}`)
    
    const bookingsApi = getBookingsApi()
    let allBookings = []
    let cursor = null
    let pageCount = 0
    const maxPages = 5 // Safety limit
    
    do {
      try {
        // Square SDK listBookings signature (positional parameters):
        // listBookings(limit?, cursor?, customerId?, teamMemberId?, locationId?, startAt?, endAt?)
        const response = await bookingsApi.listBookings(
          100, // limit
          cursor || undefined,
          customerId, // filter by customer
          undefined, // teamMemberId
          locationId, // filter by location
          startOfDay.toISOString(), // start_at_min
          endOfWindow.toISOString() // start_at_max
        )
        
        const bookings = response.result?.bookings || []
        allBookings = allBookings.concat(bookings)
        cursor = response.result?.cursor
        pageCount++
        
        console.log(`   Page ${pageCount}: Found ${bookings.length} bookings (total: ${allBookings.length})`)
      } catch (apiError) {
        console.error(`❌ [DERIVE-BOOKING] Square Bookings API error:`, apiError.message)
        break
      }
    } while (cursor && pageCount < maxPages)
    
    console.log(`📚 [DERIVE-BOOKING] Total bookings found: ${allBookings.length}`)
    
    if (allBookings.length === 0) {
      console.warn(`⚠️ [DERIVE-BOOKING] No bookings found for customer ${customerId} on ${startOfDay.toDateString()}`)
      return { bookingId: null, confidence: 'none', source: 'no_bookings_found' }
    }
    
    // Step 3: Match bookings by service_variation_id and time
    const matchedBookings = []
    
    for (const booking of allBookings) {
      const bookingId = booking.id
      const appointmentSegments = booking.appointmentSegments || []
      const bookingStartAt = booking.startAt ? new Date(booking.startAt) : null
      
      // Get end time (last segment end or calculate from duration)
      let bookingEndAt = null
      if (appointmentSegments.length > 0) {
        const lastSegment = appointmentSegments[appointmentSegments.length - 1]
        // Duration is in minutes
        const durationMinutes = lastSegment.durationMinutes || 60
        if (bookingStartAt) {
          bookingEndAt = new Date(bookingStartAt.getTime() + durationMinutes * 60 * 1000)
        }
      }
      
      // Check service_variation_id overlap
      const bookingServiceIds = appointmentSegments
        .map(seg => seg.serviceVariationId)
        .filter(Boolean)
      
      const hasServiceOverlap = serviceVariationIds.some(svcId => 
        bookingServiceIds.includes(svcId)
      )
      
      if (!hasServiceOverlap) {
        continue // Skip bookings with no matching services
      }
      
      // Check time window: booking ended before or around order time
      // Allow 4 hours after booking end for payment
      const maxPaymentDelay = 4 * 60 * 60 * 1000 // 4 hours in ms
      const latestPaymentTime = bookingEndAt 
        ? new Date(bookingEndAt.getTime() + maxPaymentDelay)
        : null
      
      // Booking should have started before order was created
      if (bookingStartAt && bookingStartAt > orderCreatedAt) {
        continue // Booking is in the future relative to order
      }
      
      // Order should be within 4 hours after booking ended
      if (latestPaymentTime && orderCreatedAt > latestPaymentTime) {
        continue // Order too late after booking
      }
      
      // Calculate time difference (for selecting closest match)
      const timeDiff = bookingEndAt 
        ? Math.abs(orderCreatedAt.getTime() - bookingEndAt.getTime())
        : Infinity
      
      matchedBookings.push({
        bookingId,
        bookingStartAt,
        bookingEndAt,
        timeDiff,
        serviceIds: bookingServiceIds
      })
      
      console.log(`   ✅ Match: Booking ${bookingId}`)
      console.log(`      Start: ${bookingStartAt?.toISOString()}`)
      console.log(`      End: ${bookingEndAt?.toISOString()}`)
      console.log(`      Services: ${bookingServiceIds.join(', ')}`)
      console.log(`      Time diff: ${Math.round(timeDiff / 60000)} minutes`)
    }
    
    if (matchedBookings.length === 0) {
      console.warn(`⚠️ [DERIVE-BOOKING] No matching bookings found for order ${squareOrderId}`)
      return { bookingId: null, confidence: 'none', source: 'no_matching_bookings' }
    }
    
    // Step 4: Select the closest match
    matchedBookings.sort((a, b) => a.timeDiff - b.timeDiff)
    const bestMatch = matchedBookings[0]
    
    const confidence = matchedBookings.length === 1 ? 'high' : 'medium'
    
    console.log(`🎯 [DERIVE-BOOKING] Best match: ${bestMatch.bookingId}`)
    console.log(`   Confidence: ${confidence} (${matchedBookings.length} candidates)`)
    console.log(`   Time diff: ${Math.round(bestMatch.timeDiff / 60000)} minutes`)
    
    return {
      bookingId: bestMatch.bookingId,
      confidence,
      source: 'derived_via_square_api'
    }
    
  } catch (error) {
    console.error(`❌ [DERIVE-BOOKING] Error deriving booking for order ${squareOrderId}:`, error.message)
    if (error.stack) {
      console.error(`   Stack:`, error.stack.split('\n').slice(0, 3).join('\n'))
    }
    return { bookingId: null, confidence: 'none', source: 'error' }
  }
}

// Helper: Resolve organization_id from merchant_id
async function resolveOrganizationId(merchantId) {
  if (!merchantId) {
    return null
  }
  
  try {
    const org = await prisma.$queryRaw`
      SELECT id FROM organizations 
      WHERE square_merchant_id = ${merchantId}
      LIMIT 1
    `
    
    if (org && org.length > 0) {
      return org[0].id
    }
    
    return null
  } catch (error) {
    console.error(`❌ Error resolving organization_id from merchant_id: ${error.message}`)
    return null
  }
}

// Helper: Resolve organization_id from location_id (FAST - database first, Square API fallback)
async function resolveOrganizationIdFromLocationId(squareLocationId) {
  if (!squareLocationId) {
    return null
  }
  
  try {
    // STEP 1: Fast database lookup (most common case)
    const location = await prisma.$queryRaw`
      SELECT organization_id, square_merchant_id
      FROM locations
      WHERE square_location_id = ${squareLocationId}
      LIMIT 1
    `
    
    if (location && location.length > 0) {
      const loc = location[0]
      
      // If we have organization_id, return it immediately (fastest path)
      if (loc.organization_id) {
        return loc.organization_id
      }
      
      // If we have merchant_id but no organization_id, resolve it
      if (loc.square_merchant_id) {
        const org = await prisma.$queryRaw`
          SELECT id FROM organizations 
          WHERE square_merchant_id = ${loc.square_merchant_id}
          LIMIT 1
        `
        if (org && org.length > 0) {
          const orgId = org[0].id
          // Update location with organization_id for future use
          await prisma.$executeRaw`
            UPDATE locations
            SET organization_id = ${orgId}::uuid,
                updated_at = NOW()
            WHERE square_location_id = ${squareLocationId}
          `
          return orgId
        }
      }
    }
    
    // STEP 2: Location not in DB or missing merchant_id - fetch from Square API
    console.log(`📍 Location ${squareLocationId} not in database or missing merchant_id, fetching from Square API...`)
    try {
      const locationsApi = getLocationsApi()
      const response = await locationsApi.retrieveLocation(squareLocationId)
      const location = response.result?.location
      
      if (!location) {
        console.warn(`⚠️ Location ${squareLocationId} not found in Square API`)
        return null
      }
      
      const merchantId = location.merchant_id || null
      
      if (!merchantId) {
        console.warn(`⚠️ Location ${squareLocationId} missing merchant_id in Square API response`)
        return null
      }
      
      // Resolve organization_id from merchant_id
      const org = await prisma.$queryRaw`
        SELECT id FROM organizations 
        WHERE square_merchant_id = ${merchantId}
        LIMIT 1
      `
      
      if (org && org.length > 0) {
        const orgId = org[0].id
        
        // Update or create location with merchant_id and organization_id
        await prisma.$executeRaw`
          INSERT INTO locations (
            id,
            organization_id,
            square_location_id,
            square_merchant_id,
            name,
            created_at,
            updated_at
          ) VALUES (
            gen_random_uuid(),
            ${orgId}::text,
            ${squareLocationId},
            ${merchantId},
            ${location.name || `Location ${squareLocationId.substring(0, 8)}...`},
            NOW(),
            NOW()
          )
          ON CONFLICT (organization_id, square_location_id) DO UPDATE SET
            square_merchant_id = COALESCE(EXCLUDED.square_merchant_id, locations.square_merchant_id),
            organization_id = COALESCE(EXCLUDED.organization_id, locations.organization_id),
            updated_at = NOW()
        `
        
        return orgId
      }
    } catch (apiError) {
      console.error(`❌ Error fetching location from Square API: ${apiError.message}`)
      if (apiError.errors) {
        console.error(`   Square API errors:`, JSON.stringify(apiError.errors, null, 2))
      }
    }
    
    return null
  } catch (error) {
    console.error(`❌ Error resolving organization_id from location_id: ${error.message}`)
    return null
  }
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

export const dynamic = 'force-dynamic'

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
    console.log('📝 Raw event data:', safeStringify(eventData))

    // Save webhook event to application_logs (non-blocking)
    let webhookOrganizationId = null
    try {
      // Resolve organization_id from webhook payload - try multiple strategies
      const payload = eventData.data || {}
      
      // Strategy 1: Try location_id from various payload structures
      const locationId = 
        payload.object?.location_id || 
        payload.object?.locationId || 
        payload.location_id || 
        payload.locationId ||
        eventData.location_id ||
        eventData.locationId ||
        null
      
      if (locationId) {
        webhookOrganizationId = await resolveOrganizationIdFromLocationId(locationId)
      }
      
      // Strategy 2: Fallback to merchant_id if location_id resolution failed
      if (!webhookOrganizationId) {
        const merchantId = 
          eventData.merchant_id || 
          payload.object?.merchant_id ||
          payload.merchant_id ||
          null
        
        if (merchantId) {
          webhookOrganizationId = await resolveOrganizationId(merchantId)
        }
      }
      
      // Save to application_logs (non-blocking, don't fail webhook if this fails)
      if (eventData.event_id) {
        // eslint-disable-next-line global-require
        const { saveApplicationLog } = require('../../../../lib/workflows/application-log-queue')
        
        await saveApplicationLog(prisma, {
          logType: 'webhook',
          logId: eventData.event_id,
          logCreatedAt: eventData.created_at ? new Date(eventData.created_at) : new Date(),
          payload: eventData, // COMPLETE webhook payload
          organizationId: webhookOrganizationId,
          status: 'received',
          maxAttempts: 0
        }).catch((logError) => {
          console.warn('⚠️ Failed to save webhook to application_logs:', logError.message)
        })
      }
    } catch (logError) {
      // Don't fail webhook if logging fails
      console.warn('⚠️ Error saving webhook to application_logs:', logError.message)
    }

    // Простая обработка событий
    if (eventData.type === 'booking.created') {
      console.log('📅 Booking created event received')
      console.log('📊 Data:', eventData.data)
    } else if (eventData.type === 'booking.updated') {
      console.log('📅 Booking updated event received')
      const bookingData = eventData.data?.object?.booking
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:238',message:'booking.updated webhook received',data:{hasBookingData:!!bookingData,bookingId:bookingData?.id||bookingData?.bookingId||'missing',version:bookingData?.version||'missing',status:bookingData?.status||'missing',eventId:eventData.event_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      if (bookingData) {
        try {
          // Import processBookingUpdated from referrals route
          const referralsRoute = await import('./referrals/route.js')
          if (referralsRoute.processBookingUpdated) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:245',message:'calling processBookingUpdated',data:{bookingId:bookingData.id||bookingData.bookingId,version:bookingData.version,status:bookingData.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            await referralsRoute.processBookingUpdated(bookingData, eventData.event_id, eventData.created_at)
            console.log(`✅ Booking updated webhook processed successfully`)
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:247',message:'processBookingUpdated completed',data:{bookingId:bookingData.id||bookingData.bookingId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
          } else {
            console.error(`❌ processBookingUpdated not found in referrals route`)
            throw new Error('processBookingUpdated function not available')
          }
        } catch (bookingError) {
          console.error(`❌ Error processing booking.updated webhook:`, bookingError.message)
          console.error(`   Stack:`, bookingError.stack)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:253',message:'booking.updated error',data:{error:bookingError.message,bookingId:bookingData?.id||bookingData?.bookingId,stack:bookingError.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          // Re-throw to return 500 so Square will retry
          // Re-throw a clean error without BigInt values
          const cleanBookingError = new Error(bookingError?.message || 'Booking webhook processing failed')
          cleanBookingError.name = bookingError?.name || 'BookingWebhookError'
          cleanBookingError.code = bookingError?.code
          throw cleanBookingError
        }
      } else {
        console.warn(`⚠️ Booking updated webhook received but booking data is missing`)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:259',message:'booking data missing',data:{eventType:eventData.type,hasData:!!eventData.data,hasObject:!!eventData.data?.object},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
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
        safeLogError(`❌ Error processing payment webhook:`, paymentError)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:135',message:'payment webhook error',data:{error:paymentError.message,paymentId:paymentData?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
          // #endregion
          // Re-throw to return 500 so Square will retry
          // Re-throw a clean error without BigInt values
          const cleanPaymentError = new Error(paymentError?.message || 'Payment webhook processing failed')
          cleanPaymentError.name = paymentError?.name || 'PaymentWebhookError'
          cleanPaymentError.code = paymentError?.code
          throw cleanPaymentError
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
        // Pass merchant_id from webhook if available (for faster organization_id resolution)
        await processOrderWebhook(eventData.data, eventData.type, eventData.merchant_id)
        console.log(`✅ Order webhook processed successfully`)
      } catch (orderError) {
        safeLogError(`❌ Error processing order webhook:`, orderError)
        // Re-throw a clean error without BigInt values so Next.js can serialize it
        const cleanError = new Error(orderError?.message || 'Order webhook processing failed')
        cleanError.name = orderError?.name || 'OrderWebhookError'
        cleanError.code = orderError?.code
        throw cleanError
      }
    } else {
      console.log('ℹ️ Unhandled event type:', eventData.type)
      
      // Enqueue unhandled events for processing via webhook-jobs cron
      // These include: customer.created, gift_card.*, refund.*, team_member.created
      const queueableEventTypes = [
        'customer.created',
        'gift_card.activity.created',
        'gift_card.activity.updated',
        'gift_card.customer_linked',
        'gift_card.updated',
        'refund.created',
        'refund.updated',
        'team_member.created'
      ]
      
      if (queueableEventTypes.includes(eventData.type)) {
        try {
          // Resolve organization_id from webhook payload - try multiple strategies
          let organizationId = null
          const payload = eventData.data || {}
          
          // Strategy 1: Try location_id from various payload structures
          const locationId = 
            payload.object?.location_id || 
            payload.object?.locationId || 
            payload.location_id || 
            payload.locationId ||
            eventData.location_id ||
            eventData.locationId ||
            null
          
          if (locationId) {
            console.log(`📍 Attempting to resolve organization_id from location_id: ${locationId}`)
            organizationId = await resolveOrganizationIdFromLocationId(locationId)
            if (organizationId) {
              console.log(`✅ Resolved organization_id from location_id: ${organizationId}`)
            } else {
              console.warn(`⚠️ Failed to resolve organization_id from location_id: ${locationId}`)
            }
          }
          
          // Strategy 2: Fallback to merchant_id if location_id resolution failed
          if (!organizationId) {
            const merchantId = 
              eventData.merchant_id || 
              payload.object?.merchant_id ||
              payload.merchant_id ||
              null
            
            if (merchantId) {
              console.log(`🏢 Attempting to resolve organization_id from merchant_id: ${merchantId}`)
              organizationId = await resolveOrganizationId(merchantId)
              if (organizationId) {
                console.log(`✅ Resolved organization_id from merchant_id: ${organizationId}`)
              } else {
                console.warn(`⚠️ Failed to resolve organization_id from merchant_id: ${merchantId}`)
              }
            }
          }
          
          // Strategy 3: For order/booking/payment webhooks, try to extract from nested objects
          if (!organizationId && (eventData.type?.includes('order') || eventData.type?.includes('booking') || eventData.type?.includes('payment'))) {
            // Try nested location_id in order/booking/payment objects
            const nestedLocationId = 
              payload.object?.order?.location_id ||
              payload.object?.booking?.location_id ||
              payload.object?.payment?.location_id ||
              null
            
            if (nestedLocationId) {
              console.log(`📍 Attempting to resolve organization_id from nested location_id: ${nestedLocationId}`)
              organizationId = await resolveOrganizationIdFromLocationId(nestedLocationId)
              if (organizationId) {
                console.log(`✅ Resolved organization_id from nested location_id: ${organizationId}`)
              }
            }
          }
          
          if (!organizationId) {
            console.warn(`⚠️ Cannot enqueue ${eventData.type}: organization_id could not be resolved from location_id or merchant_id`)
            console.warn(`   Payload keys: ${Object.keys(payload).join(', ')}`)
            console.warn(`   Event data keys: ${Object.keys(eventData).filter(k => k !== 'data').join(', ')}`)
            // Don't fail the webhook - just log the warning
          } else {
          // eslint-disable-next-line global-require
          const { enqueueWebhookJob } = require('../../../../lib/workflows/webhook-job-queue')
          
          await enqueueWebhookJob(prisma, {
            eventType: eventData.type,
            eventId: eventData.event_id,
            eventCreatedAt: eventData.created_at,
            payload: payload,
            organizationId: organizationId
          })
          
          console.log(`📦 Enqueued ${eventData.type} (${eventData.event_id}) with organization_id: ${organizationId}`)
          }
        } catch (enqueueError) {
          console.error(`❌ Failed to enqueue ${eventData.type}:`, enqueueError.message)
          // Don't fail the webhook - just log the error
        }
      }
    }

    // Update application_log status to completed (non-blocking)
    if (eventData?.event_id) {
      try {
        await prisma.$executeRaw`
          UPDATE application_logs
          SET status = 'completed',
              updated_at = NOW()
          WHERE log_id = ${eventData.event_id}
            AND log_type = 'webhook'
            ${webhookOrganizationId ? Prisma.sql`AND organization_id = ${webhookOrganizationId}::uuid` : Prisma.sql`AND organization_id IS NULL`}
        `.catch(() => {}) // Silently fail
      } catch (updateError) {
        // Don't fail webhook if status update fails
        console.warn('⚠️ Failed to update application_log status:', updateError.message)
      }
    }

    return new Response(JSON.stringify(serializeBigInt({ 
      ok: true, 
      message: 'Webhook processed successfully',
      eventType: eventData.type 
    })), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    safeLogError('❌ Webhook processing error:', error)
    
    // Update application_log status to error (non-blocking)
    if (eventData?.event_id) {
      try {
        await prisma.$executeRaw`
          UPDATE application_logs
          SET status = 'error',
              last_error = ${error?.message || String(error)},
              updated_at = NOW()
          WHERE log_id = ${eventData.event_id}
            AND log_type = 'webhook'
        `.catch(() => {}) // Silently fail
      } catch (updateError) {
        // Don't fail if status update fails
        console.warn('⚠️ Failed to update application_log error status:', updateError.message)
      }
    }
    
    // Enqueue failed webhook for retry via cron
    if (eventData?.type && eventData?.event_id) {
      try {
        // Resolve organization_id from webhook payload - try multiple strategies
        let organizationId = null
        const payload = eventData.data || {}
        
        // Strategy 1: Try location_id from various payload structures
        const locationId = 
          payload.object?.location_id || 
          payload.object?.locationId || 
          payload.location_id || 
          payload.locationId ||
          eventData.location_id ||
          eventData.locationId ||
          null
        
        if (locationId) {
          console.log(`📍 [ERROR HANDLER] Attempting to resolve organization_id from location_id: ${locationId}`)
          organizationId = await resolveOrganizationIdFromLocationId(locationId)
          if (organizationId) {
            console.log(`✅ [ERROR HANDLER] Resolved organization_id from location_id: ${organizationId}`)
          } else {
            console.warn(`⚠️ [ERROR HANDLER] Failed to resolve organization_id from location_id: ${locationId}`)
          }
        }
        
        // Strategy 2: Fallback to merchant_id if location_id resolution failed
        if (!organizationId) {
          const merchantId = 
            eventData.merchant_id || 
            payload.object?.merchant_id ||
            payload.merchant_id ||
            null
          
          if (merchantId) {
            console.log(`🏢 [ERROR HANDLER] Attempting to resolve organization_id from merchant_id: ${merchantId}`)
            organizationId = await resolveOrganizationId(merchantId)
            if (organizationId) {
              console.log(`✅ [ERROR HANDLER] Resolved organization_id from merchant_id: ${organizationId}`)
            } else {
              console.warn(`⚠️ [ERROR HANDLER] Failed to resolve organization_id from merchant_id: ${merchantId}`)
            }
          }
        }
        
        // Strategy 3: For order/booking/payment webhooks, try to extract from nested objects
        if (!organizationId && (eventData.type?.includes('order') || eventData.type?.includes('booking') || eventData.type?.includes('payment'))) {
          // Try nested location_id in order/booking/payment objects
          const nestedLocationId = 
            payload.object?.order?.location_id ||
            payload.object?.booking?.location_id ||
            payload.object?.payment?.location_id ||
            null
          
          if (nestedLocationId) {
            console.log(`📍 [ERROR HANDLER] Attempting to resolve organization_id from nested location_id: ${nestedLocationId}`)
            organizationId = await resolveOrganizationIdFromLocationId(nestedLocationId)
            if (organizationId) {
              console.log(`✅ [ERROR HANDLER] Resolved organization_id from nested location_id: ${organizationId}`)
            }
          }
        }
        
        if (organizationId) {
          const { enqueueWebhookJob } = require('../../../../lib/workflows/webhook-job-queue')
          
          await enqueueWebhookJob(prisma, {
            eventType: eventData.type,
            eventId: eventData.event_id,
            eventCreatedAt: eventData.created_at,
            payload: payload,
            organizationId: organizationId,
            error: error.message || String(error)
          })
          
          console.log(`📦 [ERROR HANDLER] Enqueued failed webhook ${eventData.type} (${eventData.event_id}) with organization_id: ${organizationId} for retry`)
        } else {
          console.warn(`⚠️ [ERROR HANDLER] Cannot enqueue failed webhook ${eventData.type}: organization_id could not be resolved`)
          console.warn(`   Payload keys: ${Object.keys(payload).join(', ')}`)
          console.warn(`   Event data keys: ${Object.keys(eventData).filter(k => k !== 'data').join(', ')}`)
        }
      } catch (enqueueError) {
        console.error(`❌ Failed to enqueue webhook job:`, enqueueError.message)
        // Continue to return 500 so Square retries
      }
    }
    
    // Return 500 so Square will retry the webhook
    return new Response(JSON.stringify(serializeBigInt({ 
      error: 'Processing failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      eventType: eventData?.type || 'unknown'
    })), { 
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

    // Resolve organization_id - PRIORITIZE location_id (always available, fast database lookup)
    let organizationId = null
    
    // STEP 1: Try location_id FIRST (always available in webhooks, fast DB lookup)
    if (locationId) {
      console.log(`📍 Resolving organization_id from location_id: ${locationId}`)
      organizationId = await resolveOrganizationIdFromLocationId(locationId)
      if (organizationId) {
        console.log(`✅ Resolved organization_id from location: ${organizationId}`)
      }
    }
    
    // STEP 2: Fallback to merchant_id (if location lookup failed)
    if (!organizationId && merchantId) {
      try {
        const org = await prisma.$queryRaw`
          SELECT id FROM organizations 
          WHERE square_merchant_id = ${merchantId}
          LIMIT 1
        `
        if (org && org.length > 0) {
          organizationId = org[0].id
          console.log(`✅ Resolved organization_id from merchant_id: ${organizationId}`)
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

    // Location lookup already done above (STEP 1), skip duplicate lookup

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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:585',message:'customer upsert - before insert',data:{customerId,organizationId,attemptingToSetId:'gen_random_uuid()'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        await prisma.$executeRaw`
          INSERT INTO square_existing_clients (
            organization_id,
            square_customer_id,
            got_signup_bonus,
            created_at,
            updated_at
          ) VALUES (
            ${organizationId}::uuid,
            ${customerId},
            false,
            NOW(),
            NOW()
          )
          ON CONFLICT (organization_id, square_customer_id) DO NOTHING
        `
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:603',message:'customer upsert - after insert',data:{customerId,success:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
      } catch (err) {
        // Customer might already exist
        console.warn(`⚠️ Customer upsert warning: ${err.message}`)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:606',message:'customer upsert - error',data:{customerId,error:err.message,errorCode:err.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
      }
    }

    const locationUuid = await resolveLocationUuidForSquareLocationId(prisma, locationId, organizationId)

    // Ensure order exists if provided
    if (orderId) {
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:620',message:'order upsert - before insert',data:{orderId,locationId,squareLocationId:locationId,locationUuid,hasLocationUuid:!!locationUuid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // ✅ FIX: Only insert order if locationUuid exists (required foreign key)
        if (locationUuid) {
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
        } else {
          console.warn(`⚠️ Cannot insert order ${orderId}: locationUuid is null (location ${locationId} not found)`)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:640',message:'order upsert - skipped due to null locationUuid',data:{orderId,locationId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
        }
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:639',message:'order upsert - after insert',data:{orderId,success:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
      } catch (err) {
        // Order might already exist
        console.warn(`⚠️ Order upsert warning: ${err.message}`)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:642',message:'order upsert - error',data:{orderId,error:err.message,errorCode:err.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
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

    // Look up team member UUID from Square team_member_id
    // The administrator_id field expects an internal UUID, not Square's team_member_id
    const squareTeamMemberId = getValue(paymentData, 'teamMemberId', 'team_member_id') || 
                               getValue(paymentData, 'employeeId', 'employee_id') || null
    let administratorUuid = null
    if (squareTeamMemberId && organizationId) {
      try {
        const teamMember = await prisma.$queryRaw`
          SELECT id FROM team_members 
          WHERE square_team_member_id = ${squareTeamMemberId}
            AND organization_id = ${organizationId}::uuid
          LIMIT 1
        `
        if (teamMember && teamMember.length > 0) {
          administratorUuid = teamMember[0].id
          console.log(`✅ Resolved administrator UUID from team_member_id ${squareTeamMemberId}: ${administratorUuid}`)
        } else {
          console.log(`ℹ️ Team member ${squareTeamMemberId} not found in database (will save payment without administrator_id)`)
        }
      } catch (teamMemberErr) {
        console.warn(`⚠️ Could not look up team member UUID: ${teamMemberErr.message}`)
      }
    }

    // Build payment record (exactly matching schema and backfill script)
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:714',message:'payment record - before build',data:{paymentId,hasPaymentIdField:false,idValue:paymentId,idType:'Square ID string'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const paymentRecord = {
      // id is auto-generated UUID, do not set it
      payment_id: paymentId, // ✅ FIX: Square payment ID (external identifier)
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
      status: paymentData.status || 'UNKNOWN', // Required field, cannot be null
      source_type: getValue(paymentData, 'sourceType', 'source_type'),
      delay_action: getValue(paymentData, 'delayAction', 'delay_action'),
      delay_duration: getValue(paymentData, 'delayDuration', 'delay_duration'),
      delayed_until: getValue(paymentData, 'delayedUntil', 'delayed_until') 
        ? new Date(getValue(paymentData, 'delayedUntil', 'delayed_until'))
        : null,
      
      // Staff/Team Member - use resolved UUID (looked up above from team_members table)
      administrator_id: administratorUuid,
      
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:817',message:'payment record - after build',data:{paymentId,hasPaymentIdField:!paymentRecord.payment_id,idValue:paymentRecord.id,whereClause:'id: paymentId'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    // Upsert payment
    // ✅ FIX: Use raw SQL for composite unique constraint upsert (more reliable than Prisma's findUnique + update/create)
    // Validate required fields before attempting database operation
    if (!paymentId) {
      throw new Error(`Cannot save payment: paymentId is required but missing`)
    }
    if (!organizationId) {
      throw new Error(`Cannot save payment: organizationId is required but missing`)
    }
    if (!paymentRecord.payment_id) {
      throw new Error(`Cannot save payment: paymentRecord.payment_id is required but missing. paymentId: ${paymentId}`)
    }
    // #region agent log
    const beforeLog = {location:'route.js:850',message:'payment upsert - before',data:{paymentId,organizationId,hasPaymentId:!!paymentRecord.payment_id,paymentIdValue:paymentRecord.payment_id,usingRawQuery:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(beforeLog)}).catch(()=>{});
    console.log('[DEBUG] Payment upsert before:', JSON.stringify(beforeLog));
    // #endregion
    
    // First, try to find existing payment
    const existingPayment = await prisma.$queryRaw`
      SELECT id FROM payments
      WHERE organization_id = ${organizationId}::uuid
        AND payment_id = ${paymentId}
      LIMIT 1
    `
    
    let payment
    try {
      if (existingPayment && existingPayment.length > 0) {
        // Update existing payment
        const paymentUuid = existingPayment[0].id
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:865',message:'payment upsert - updating existing',data:{paymentId,paymentUuid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        console.log(`[DEBUG] Updating payment ${paymentId} with UUID ${paymentUuid}`)
        payment = await prisma.payment.update({
          where: { id: paymentUuid },
          data: paymentRecord,
        })
      } else {
        // Create new payment
        // #region agent log
        const createLogData = {location:'route.js:872',message:'payment upsert - creating new',data:{paymentId,hasPaymentId:!!paymentRecord.payment_id,paymentIdValue:paymentRecord.payment_id,paymentRecordKeys:Object.keys(paymentRecord)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(createLogData)}).catch(()=>{});
        console.log('[DEBUG] Creating payment:', JSON.stringify(createLogData));
        // #endregion
        console.log(`[DEBUG] Payment record keys:`, Object.keys(paymentRecord))
        console.log(`[DEBUG] Payment record payment_id:`, paymentRecord.payment_id)
        // Double-check payment_id is set before creating
        if (!paymentRecord.payment_id) {
          throw new Error(`Cannot create payment: paymentRecord.payment_id is missing. paymentId: ${paymentId}, paymentRecord keys: ${Object.keys(paymentRecord).join(', ')}`)
        }
        // Ensure payment_id is explicitly set (defensive programming)
        const createData = {
          ...paymentRecord,
          payment_id: paymentRecord.payment_id || paymentId, // Explicitly ensure it's set
        }
        console.log(`[DEBUG] Creating payment with payment_id:`, createData.payment_id)
        payment = await prisma.payment.create({
          data: createData,
        })
      }
    } catch (paymentError) {
      // #region agent log
      const errorLogData = {location:'route.js:882',message:'payment upsert - error',data:{paymentId,error:paymentError.message,errorCode:paymentError.code,errorName:paymentError.name,paymentRecordKeys:Object.keys(paymentRecord),hasPaymentId:!!paymentRecord.payment_id,paymentIdValue:paymentRecord.payment_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'};
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(errorLogData)}).catch(()=>{});
      console.error('[DEBUG ERROR]', safeStringify(errorLogData));
      safeLogError('[DEBUG ERROR] Full error:', paymentError);
      // #endregion
      // Create a clean error without BigInt values to prevent serialization issues
      const cleanPaymentError = new Error(paymentError?.message || 'Failed to save payment')
      cleanPaymentError.name = paymentError?.name || 'PaymentSaveError'
      cleanPaymentError.code = paymentError?.code
      throw cleanPaymentError
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:824',message:'payment upsert - after',data:{paymentId,paymentUuid:payment.id,success:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    // Handle tenders (extract from payment data)
    const tenders = paymentData.tenders || paymentData.tender || []
    
    // Delete existing tenders and recreate (to handle updates)
    // ✅ FIX: Use payment UUID (internal id), not Square payment ID
    const paymentUuid = payment.id
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:830',message:'tender delete - before',data:{paymentId,paymentUuid,whereClause:'payment_id: paymentUuid (UUID)',tenderCount:tenders.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    await prisma.paymentTender.deleteMany({
      where: { payment_id: paymentUuid } // ✅ FIX: Use UUID, not Square ID
    })
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:832',message:'tender delete - after',data:{paymentId,paymentUuid,success:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

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
          payment_id: paymentUuid, // ✅ FIX: Use UUID, not Square ID
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:920',message:'tender create - before',data:{paymentId,paymentUuid,tenderCount:tenderRecordsWithOrg.length,firstTenderPaymentId:tenderRecordsWithOrg[0]?.payment_id,paymentIdType:typeof tenderRecordsWithOrg[0]?.payment_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      await prisma.paymentTender.createMany({
        data: tenderRecordsWithOrg
      })
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:922',message:'tender create - after',data:{paymentId,paymentUuid,success:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    }

    console.log(`✅ Payment ${paymentId} saved to database (${eventType}) with organization_id: ${organizationId}`)
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:701',message:'payment saved successfully',data:{paymentId,orderId,orderUuid,customerId,hasOrderUuid:!!orderUuid,organizationId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
    // #endregion
    
    // Try to populate booking_id in payment if order exists
    if (orderId && organizationId) {
      // First, try to get booking_id from order if it already has one
      const orderWithBooking = await prisma.$queryRaw`
        SELECT booking_id FROM orders
        WHERE order_id = ${orderId}
          AND booking_id IS NOT NULL
        LIMIT 1
      `
      
      if (orderWithBooking && orderWithBooking.length > 0) {
        // Order already has booking_id, copy to payment
        // Use payment_id (Square ID) and organization_id to find the payment
        await prisma.$executeRaw`
          UPDATE payments
          SET booking_id = ${orderWithBooking[0].booking_id}::uuid,
              updated_at = NOW()
          WHERE payment_id = ${paymentId}
            AND organization_id = ${organizationId}::uuid
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
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:954',message:'payment save error caught',data:{error:error.message,paymentId:paymentData?.id,errorCode:error.code,errorName:error.name,fullError:error.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    // Don't throw - allow webhook to continue processing
    // BUT: This might be hiding errors! Consider re-throwing for critical errors
  }
}

/**
 * Reconcile booking_id across payments, orders, and order_line_items
 * Called by payment and order webhooks to ensure eventual consistency
 * Uses 2 methods in priority order:
 * 1. PRIMARY: Square API (deriveBookingFromSquareApi)
 * 2. FALLBACK: Database match by Customer + Location + Time
 */
async function reconcileBookingLinks(orderId, paymentId = null) {
  try {
    // Get order UUID and details
    const orderRecord = await prisma.$queryRaw`
      SELECT id, organization_id, customer_id, location_id, created_at, booking_id
      FROM orders 
      WHERE order_id = ${orderId}
      LIMIT 1
    `
    
    if (!orderRecord || orderRecord.length === 0) {
      console.log(`ℹ️ Order ${orderId} not found in database yet (might arrive later)`)
      return { bookingId: null, source: 'order_not_in_db', confidence: 'none' }
    }
    
    const orderUuid = orderRecord[0].id
    const organizationId = orderRecord[0].organization_id
    const customerId = orderRecord[0].customer_id
    const locationId = orderRecord[0].location_id
    const orderCreatedAt = orderRecord[0].created_at
    const existingBookingId = orderRecord[0].booking_id
    
    // If order already has booking_id, we can still update payments and line items
    let bookingId = existingBookingId
    let bookingLinkSource = existingBookingId ? 'existing' : null
    let bookingLinkConfidence = existingBookingId ? 'high' : null
    
    // ============================================================
    // PRIMARY METHOD: Square API
    // ============================================================
    if (!bookingId && orderId) {
      console.log(`🔄 [RECONCILE] Trying Square API for order ${orderId}...`)
      
      const squareResult = await deriveBookingFromSquareApi(orderId)
      
      if (squareResult.bookingId) {
        // Square API returned a booking ID - find or create in our database
        const existingBooking = await prisma.$queryRaw`
          SELECT id FROM bookings 
          WHERE booking_id = ${squareResult.bookingId}
          LIMIT 1
        `
        
        if (existingBooking && existingBooking.length > 0) {
          bookingId = existingBooking[0].id
          console.log(`✅ [RECONCILE] Found existing booking in DB: ${bookingId}`)
        } else {
          // Booking not in database - fetch and save it
          console.log(`📥 [RECONCILE] Booking ${squareResult.bookingId} not in DB, fetching from Square...`)
          try {
            const bookingsApi = getBookingsApi()
            const bookingResponse = await bookingsApi.retrieveBooking(squareResult.bookingId)
            const squareBooking = bookingResponse.result?.booking
            
            if (squareBooking) {
              const newBookingId = squareBooking.id
              const bookingCustomerId = squareBooking.customerId
              const bookingLocationId = squareBooking.locationId
              const bookingStatus = squareBooking.status
              const bookingVersion = squareBooking.version
              const bookingStartAt = squareBooking.startAt ? new Date(squareBooking.startAt) : null
              
              let bookingOrgId = organizationId
              if (!bookingOrgId && bookingLocationId) {
                bookingOrgId = await resolveOrganizationIdFromLocationId(bookingLocationId)
              }
              
              if (!bookingOrgId) {
                console.error('[BOOKING-INSERT] organization_id missing', {
                  bookingId: newBookingId,
                  squareLocationId: bookingLocationId,
                })
              } else {
                const bookingLocationUuid = await resolveLocationUuidForSquareLocationId(
                  prisma,
                  bookingLocationId,
                  bookingOrgId
                )

                if (!bookingLocationUuid) {
                  console.error('[BOOKING-INSERT] Location UUID resolution failed', {
                    bookingId: newBookingId,
                    squareLocationId: bookingLocationId,
                    organizationId: bookingOrgId,
                  })
                } else {
                  await prisma.$executeRaw`
                    INSERT INTO bookings (
                      organization_id, booking_id, customer_id, location_id, status, version,
                      start_at, created_at, updated_at, raw_json
                    ) VALUES (
                      ${bookingOrgId}::uuid, ${newBookingId}, ${bookingCustomerId}, ${bookingLocationUuid}::uuid, 
                      ${bookingStatus}, ${bookingVersion || 1}, ${bookingStartAt}::timestamptz,
                      NOW(), NOW(), ${safeStringify(squareBooking)}::jsonb
                    )
                    ON CONFLICT (organization_id, booking_id) DO UPDATE SET
                      status = EXCLUDED.status,
                      version = EXCLUDED.version,
                      updated_at = NOW(),
                      raw_json = EXCLUDED.raw_json
                    RETURNING id
                  `
                  
                  const insertedBooking = await prisma.$queryRaw`
                    SELECT id FROM bookings WHERE booking_id = ${newBookingId} LIMIT 1
                  `
                  if (insertedBooking && insertedBooking.length > 0) {
                    bookingId = insertedBooking[0].id
                    console.log(`✅ [RECONCILE] Saved and linked booking: ${bookingId}`)
                  }
                }
              }
            }
          } catch (fetchError) {
            console.error(`❌ [RECONCILE] Error fetching booking from Square:`, fetchError.message)
          }
        }
        
        bookingLinkSource = squareResult.source
        bookingLinkConfidence = squareResult.confidence
      } else {
        console.log(`ℹ️ [RECONCILE] Square API found no booking. Reason: ${squareResult.source}`)
      }
    }
    
    // ============================================================
    // FALLBACK METHOD: Database Customer + Location + Time
    // ============================================================
    if (!bookingId && customerId && locationId) {
      console.log(`🔄 [RECONCILE] Square API failed, trying database fallback...`)
      
      // Time window: 7 days before order, 1 day after
      const startWindow = new Date(orderCreatedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
      const endWindow = new Date(orderCreatedAt.getTime() + 1 * 24 * 60 * 60 * 1000)
      
      // Determine if location is UUID or square_location_id
      let squareLocationId = null
      let locationUuid = null
      
      if (locationId && locationId.length < 36) {
        // It's a square_location_id
        squareLocationId = locationId
        locationUuid = await resolveLocationUuidForSquareLocationId(prisma, locationId, organizationId)
      } else {
        // It's a UUID
        locationUuid = locationId
        const loc = await prisma.$queryRaw`
          SELECT square_location_id FROM locations 
          WHERE id = ${locationId}::uuid
          LIMIT 1
        `
        if (loc && loc.length > 0) {
          squareLocationId = loc[0].square_location_id
        }
      }
      
      // Find booking by customer + location + time
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
        bookingLinkSource = 'database_fallback'
        bookingLinkConfidence = 'medium'
        console.log(`✅ [RECONCILE] Matched booking by customer+location+time: ${bookingId}`)
      } else {
        console.log(`ℹ️ [RECONCILE] Database fallback also found no booking`)
        bookingLinkSource = 'no_match'
        bookingLinkConfidence = 'none'
      }
    }
    
    // Update orders table if booking found
    if (bookingId) {
      // Extract technician_id and administrator_id from booking
      const bookingDetails = await prisma.$queryRaw`
        SELECT technician_id, administrator_id
        FROM bookings
        WHERE id = ${bookingId}::uuid
        LIMIT 1
      `
      
      const technicianId = bookingDetails?.[0]?.technician_id || null
      const administratorId = bookingDetails?.[0]?.administrator_id || null
      
      // Update order with booking_id, technician_id, and administrator_id
      await prisma.$executeRaw`
        UPDATE orders
        SET booking_id = ${bookingId}::uuid,
            technician_id = COALESCE(technician_id, ${technicianId}::uuid),
            administrator_id = COALESCE(administrator_id, ${administratorId}::uuid),
            updated_at = NOW()
        WHERE id = ${orderUuid}::uuid
          AND (booking_id IS NULL OR booking_id != ${bookingId}::uuid)
      `
      console.log(`✅ Updated order ${orderId} with booking_id: ${bookingId}`)
      if (technicianId) {
        console.log(`   - technician_id: ${technicianId}`)
      }
      if (administratorId) {
        console.log(`   - administrator_id: ${administratorId}`)
      }
      
      // Update order_line_items with booking_id, technician_id, and administrator_id
      await prisma.$executeRaw`
        UPDATE order_line_items
        SET booking_id = ${bookingId}::uuid,
            technician_id = COALESCE(technician_id, ${technicianId}::uuid),
            administrator_id = COALESCE(administrator_id, ${administratorId}::uuid),
            updated_at = NOW()
        WHERE order_id = ${orderUuid}::uuid
          AND (booking_id IS NULL OR booking_id != ${bookingId}::uuid)
      `
      console.log(`✅ Updated order_line_items for order ${orderId} with booking_id: ${bookingId}`)
      if (technicianId) {
        console.log(`   - Applied technician_id to line items`)
      }
      if (administratorId) {
        console.log(`   - Applied administrator_id to line items`)
      }
      
      // Update payments if paymentId provided
      // paymentId is Square payment ID (TEXT), need to use payment_id column
      if (paymentId && organizationId) {
        await prisma.$executeRaw`
          UPDATE payments
          SET booking_id = ${bookingId}::uuid,
              updated_at = NOW()
          WHERE payment_id = ${paymentId}
            AND organization_id = ${organizationId}::uuid
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
      
      console.log(`📊 [RECONCILE] Booking link complete:`)
      console.log(`   Order: ${orderId}`)
      console.log(`   Booking: ${bookingId}`)
      console.log(`   Source: ${bookingLinkSource}`)
      console.log(`   Confidence: ${bookingLinkConfidence}`)
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:910',message:'reconcileBookingLinks exit',data:{orderId,bookingId,success:!!bookingId,source:bookingLinkSource,confidence:bookingLinkConfidence},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return { bookingId, source: bookingLinkSource, confidence: bookingLinkConfidence }
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:913',message:'reconcileBookingLinks error',data:{orderId,error:error.message,code:error.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    console.error(`❌ Error in reconcileBookingLinks: ${error.message}`)
    if (error.stack) {
      console.error('Stack:', error.stack.split('\n').slice(0, 5).join('\n'))
    }
    return { bookingId: null, source: 'error', confidence: 'none' }
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

    // Update order with booking_id, technician_id, and administrator_id if not already set
    if (bookingId) {
      // First get the primary technician from booking
      const bookingTech = await prisma.$queryRaw`
        SELECT technician_id FROM bookings 
        WHERE id = ${bookingId}::uuid AND technician_id IS NOT NULL
        LIMIT 1
      `
      const technicianId = bookingTech?.[0]?.technician_id || null
      
      await prisma.$executeRaw`
        UPDATE orders
        SET booking_id = COALESCE(booking_id, ${bookingId}::uuid),
            technician_id = COALESCE(technician_id, ${technicianId}::uuid),
            administrator_id = COALESCE(administrator_id, ${administratorId}::uuid),
            updated_at = NOW()
        WHERE id = ${orderUuid}::uuid
      `
      console.log(`✅ Updated order with booking_id: ${bookingId}, technician_id: ${technicianId}, administrator_id: ${administratorId}`)
      
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

    // Prefer segment-level mapping (deterministic)
    const segmentMappings = await prisma.$queryRaw`
      SELECT DISTINCT ON (service_variation_id)
        service_variation_id,
        technician_id
      FROM booking_segments
      WHERE booking_id = ${bookingId}::uuid
        AND is_active = true
        AND service_variation_id IS NOT NULL
        AND technician_id IS NOT NULL
      ORDER BY
        service_variation_id,
        duration_minutes DESC NULLS LAST,
        segment_index ASC,
        id ASC
    `

    // Fallback to legacy bookings table if no segments found
    const bookings = segmentMappings && segmentMappings.length > 0
      ? segmentMappings
      : await prisma.$queryRaw`
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

async function processOrderWebhook(webhookData, eventType, webhookMerchantId = null) {
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
    
    console.log(`📦 Processing ${eventType} webhook for order ${orderId}`)
    if (webhookMerchantId) {
      console.log(`   merchant_id from webhook: ${webhookMerchantId}`)
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:1807',message:'Extracted locationId from webhook metadata',data:{orderId,locationId:locationId||'missing',orderState,orderMetadataKeys:Object.keys(orderMetadata||{})},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    console.log(`📦 Fetching full order details for order ${orderId} (state: ${orderState})`)
    
    const token = process.env.SQUARE_ACCESS_TOKEN?.trim() || ''
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token
    console.log(`   [DEBUG] Token length: ${cleanToken.length}, Preview: ${cleanToken.substring(0, 10)}...`)

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
      // Create a clean error without BigInt values to prevent serialization issues
      const cleanApiError = new Error(apiError?.message || 'Failed to fetch order from Square API')
      cleanApiError.name = apiError?.name || 'SquareAPIError'
      cleanApiError.code = apiError?.code
      throw cleanApiError
    }

    // Use location_id from full order (more reliable than webhook metadata)
    // Note: Square API may return camelCase (locationId) or snake_case (location_id)
    const orderLocationId = order.location_id || order.locationId || null
    const finalLocationId = orderLocationId || locationId || null
    const customerId = order.customer_id || order.customerId || null
    const lineItems = order.line_items || order.lineItems || []
    // Use merchant_id from order API response, fallback to webhook merchant_id
    const merchantId = order.merchant_id || order.merchantId || webhookMerchantId || null

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:801',message:'Order webhook - extracted IDs',data:{orderId,merchantId:merchantId?.substring(0,16)||'missing',locationIdFromWebhook:locationId?.substring(0,16)||'missing',orderLocationId:orderLocationId?.substring(0,16)||'missing',finalLocationId:finalLocationId?.substring(0,16)||'missing',orderKeys:Object.keys(order).join(',')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    // Resolve organization_id - For order.created/updated, merchant_id is ALWAYS present
    // STEP 1: Resolve organization_id from merchant_id FIRST (source of truth from Square)
    let organizationId = null
    
    if (merchantId) {
      try {
        console.log(`📍 Resolving organization_id from merchant_id: ${merchantId}`)
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
    }
    
    // STEP 2: Fallback to location_id (if merchant_id lookup failed)
    if (!organizationId && finalLocationId) {
      console.log(`📍 Fallback: Resolving organization_id from location_id: ${finalLocationId}`)
      organizationId = await resolveOrganizationIdFromLocationId(finalLocationId)
      if (organizationId) {
        console.log(`✅ Resolved organization_id from location (fallback): ${organizationId.substring(0, 8)}...`)
      }
    }

    if (!merchantId && !organizationId) {
      console.warn(`⚠️ Order ${orderId} missing merchant_id AND fallback resolution failed`)
    }
    // Note: If merchant_id is missing but organizationId was resolved via location fallback,
    // that's expected behavior (Square webhooks don't always include merchant_id).
    // No need to log this as it's working correctly.

    // Location lookup already done above (STEP 1), no need to duplicate

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
    
    // Get technician_id from booking segments (match by service_variation_id)
    const serviceTechnicianMap = new Map()
    
    if (bookingId) {
      const segmentMappings = await prisma.$queryRaw`
        SELECT DISTINCT ON (service_variation_id)
          service_variation_id,
          technician_id
        FROM booking_segments
        WHERE booking_id = ${bookingId}::uuid
          AND is_active = true
          AND service_variation_id IS NOT NULL
          AND technician_id IS NOT NULL
        ORDER BY
          service_variation_id,
          duration_minutes DESC NULLS LAST,
          segment_index ASC,
          id ASC
      `

      const mappings = segmentMappings && segmentMappings.length > 0
        ? segmentMappings
        : await prisma.$queryRaw`
            SELECT service_variation_id, technician_id
            FROM bookings
            WHERE booking_id LIKE ${`${bookingId}%`}
              AND technician_id IS NOT NULL
          `
      
      mappings.forEach(booking => {
        if (booking.service_variation_id && booking.technician_id) {
          serviceTechnicianMap.set(booking.service_variation_id, booking.technician_id)
        }
      })
      
      if (serviceTechnicianMap.size > 0) {
        console.log(`📋 Found ${serviceTechnicianMap.size} service-technician mappings for booking ${bookingId}`)
      }
    }

    // Get location UUID from square_location_id
    // Square API always provides location_id in order response, so we must always resolve it
    let locationUuid = null
    if (!finalLocationId) {
      throw new Error(`Cannot process order ${orderId}: location_id is required but missing from Square API response`)
    }
    
    if (!organizationId) {
      throw new Error(`Cannot process order ${orderId}: organization_id is required to resolve location`)
    }
    
    try {
      locationUuid = await resolveLocationUuidForSquareLocationId(prisma, finalLocationId, organizationId)
      if (!locationUuid) {
        throw new Error(`Failed to resolve location UUID for square_location_id: ${finalLocationId}`)
      }
    } catch (err) {
      console.error(`❌ Error getting/creating location: ${err.message}`)
      console.error(`   Stack: ${err.stack}`)
      throw new Error(`Cannot process order ${orderId}: failed to resolve location. ${err.message}`)
    }

    // 1. Save/update the order in the orders table
    // locationUuid is guaranteed to be set at this point (thrown error if not)
    if (!locationUuid) {
      throw new Error(`Cannot process order ${orderId}: locationUuid is required but was not resolved`)
    }
    
    // Validate locationUuid format
    if (typeof locationUuid !== 'string' || locationUuid.trim() === '') {
      throw new Error(`Invalid locationUuid format: ${locationUuid} (type: ${typeof locationUuid})`)
    }
    
    // Clean UUID (remove any whitespace)
    const cleanLocationUuid = String(locationUuid).trim()
    
    console.log(`📦 Preparing to save order ${orderId}`)
    console.log(`   locationUuid: ${cleanLocationUuid}`)
    console.log(`   organizationId: ${organizationId}`)
    
    // #region agent log - HYPOTHESIS A: UUID format/type mismatch
    // Log exact UUID value, type, and format before create
    const uuidInfo = {
      value: cleanLocationUuid,
      type: typeof cleanLocationUuid,
      length: cleanLocationUuid.length,
      isUUIDFormat: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanLocationUuid),
      bytes: Buffer.from(cleanLocationUuid).toString('hex'),
      organizationId: organizationId
    }
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:2138',message:'UUID format check before create',data:uuidInfo,timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // #region agent log - HYPOTHESIS B: Direct database query with exact UUID
    // Query location directly with the exact UUID we'll use
    const directLocationCheck = await prisma.$queryRaw`
      SELECT id::text as id, organization_id::text as org_id, square_location_id 
      FROM locations 
      WHERE id = ${cleanLocationUuid}::uuid
    `
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:2145',message:'Direct location query with exact UUID',data:{cleanLocationUuid,found:directLocationCheck?.length>0,locationData:directLocationCheck?.[0]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    // #region agent log - HYPOTHESIS C: FK constraint definition check
    // Check FK constraint definition to see what it's actually checking
    const fkConstraintDef = await prisma.$queryRaw`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.match_option,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      LEFT JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'orders'
        AND kcu.column_name = 'location_id'
    `
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:2160',message:'FK constraint definition',data:{fkConstraintDef},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    // #region agent log - HYPOTHESIS D: Test FK constraint directly with raw SQL
    // Test if we can insert with raw SQL using the exact UUID
    const testFKInsert = await prisma.$queryRaw`
      SELECT EXISTS(
        SELECT 1 FROM locations WHERE id = ${cleanLocationUuid}::uuid
      ) as location_exists
    `
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:2175',message:'FK constraint test with EXISTS',data:{cleanLocationUuid,locationExists:testFKInsert?.[0]?.location_exists},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    // #region agent log - HYPOTHESIS E: Organization ID mismatch check
    // Check if location's organization_id matches order's organization_id
    const orgMatchCheck = await prisma.$queryRaw`
      SELECT 
        l.id::text as location_id,
        l.organization_id::text as location_org_id,
        ${organizationId}::uuid as order_org_id,
        (l.organization_id = ${organizationId}::uuid) as org_match
      FROM locations l
      WHERE l.id = ${cleanLocationUuid}::uuid
    `
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:2185',message:'Organization ID match check',data:{orgMatchCheck:orgMatchCheck?.[0]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    
    // Use raw SQL upsert to handle both create and update atomically (prevents race conditions)
    // This avoids Prisma's composite unique constraint limitations
    let orderUuid = null
    try {
      const createdAt = order.created_at ? new Date(order.created_at) : new Date()
      const updatedAt = order.updated_at ? new Date(order.updated_at) : new Date()
      const orderStateValue = orderState || order.state || null
      const versionValue = order.version ? Number(order.version) : null
      const rawJsonValue = safeStringify(order) // Use safeStringify to handle BigInt values
      
      const upsertedOrder = await prisma.$queryRaw`
        INSERT INTO orders (
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
          ${organizationId}::uuid,
          ${orderId},
          ${cleanLocationUuid}::uuid,
          ${customerId || null},
          ${orderStateValue},
          ${versionValue},
          ${order.reference_id || null},
          ${createdAt}::timestamptz,
          ${updatedAt}::timestamptz,
          ${rawJsonValue}::jsonb
        )
        ON CONFLICT (organization_id, order_id)
        DO UPDATE SET
          location_id = EXCLUDED.location_id,
          customer_id = EXCLUDED.customer_id,
          state = EXCLUDED.state,
          version = EXCLUDED.version,
          reference_id = EXCLUDED.reference_id,
          updated_at = EXCLUDED.updated_at,
          raw_json = EXCLUDED.raw_json
        RETURNING id, order_id, organization_id, state
      `
      
      if (upsertedOrder && upsertedOrder.length > 0) {
        // Extract values safely to avoid BigInt serialization issues
        const result = upsertedOrder[0]
        orderUuid = result.id
        const returnedState = result.state
        console.log(`✅ Upserted order ${orderId} to orders table (UUID: ${orderUuid}, state: ${returnedState || orderStateValue || 'N/A'})`)
      } else {
        throw new Error(`Failed to upsert order ${orderId} - no result returned`)
      }
    } catch (orderError) {
      safeLogError(`❌ Error saving order ${orderId} to orders table:`, orderError)
      
      // Create a clean error without BigInt values to prevent serialization issues
      const cleanOrderError = new Error(orderError?.message || 'Failed to save order')
      cleanOrderError.name = orderError?.name || 'OrderSaveError'
      cleanOrderError.code = orderError?.code
      
      // If foreign key constraint error, the location resolution failed
      if (orderError.code === 'P2003' || (orderError.code === '23503' && orderError.message?.includes('location_id_fkey'))) {
        console.error(`❌ Foreign key constraint violation: location ${cleanLocationUuid} does not exist`)
        // #region agent log - Post-error investigation
        // Final check: Does location exist? Check multiple ways
        try {
          const locationCheck1 = await prisma.$queryRaw`
            SELECT id::text as id FROM locations WHERE id = ${cleanLocationUuid}::uuid LIMIT 1
          `
          const locationCheck2 = await prisma.$queryRaw`
            SELECT id::text as id, organization_id::text as org_id FROM locations 
            WHERE id::text = ${cleanLocationUuid} LIMIT 1
          `
          const locationCheck3 = await prisma.location.findUnique({
            where: { id: cleanLocationUuid }
          })
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'route.js:2245',message:'Post-error location checks',data:{cleanLocationUuid,check1:locationCheck1?.length>0,check2:locationCheck2?.length>0,check3:!!locationCheck3,check1Data:locationCheck1?.[0],check2Data:locationCheck2?.[0],check3Data:locationCheck3?.id,errorCode:orderError.code,errorMessage:orderError.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'ALL'})}).catch(()=>{});
          // #endregion
          if (!locationCheck1 || locationCheck1.length === 0) {
            console.error(`❌ Location ${cleanLocationUuid} does NOT exist - location resolution failed`)
            throw new Error(`Foreign key constraint violation: location ${cleanLocationUuid} does not exist. This indicates a bug in location resolution logic.`)
          } else {
            console.error(`⚠️ Location ${cleanLocationUuid} EXISTS but FK still failed - this is very strange!`)
            throw cleanOrderError // Throw clean error instead of original
          }
        } catch (checkErr) {
          console.error(`❌ Error checking location after FK error:`, checkErr.message)
          throw cleanOrderError // Throw clean error instead of original
        }
      }
      throw cleanOrderError // Always throw clean error to prevent BigInt serialization issues
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
      // locationUuid is guaranteed to be set at this point
      if (!locationUuid) {
        throw new Error(`Cannot process order: locationUuid is required but was not resolved`)
      }
      
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
              ${safeStringify(order)}::jsonb
            )
            ON CONFLICT (organization_id, order_id) DO UPDATE SET
            location_id = EXCLUDED.location_id,
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
        // Create a clean error without BigInt values
        const cleanRetryError = new Error(retryError?.message || 'Failed to create order on retry')
        cleanRetryError.name = retryError?.name || 'OrderRetryError'
        cleanRetryError.code = retryError?.code
        
        // If foreign key constraint error, the location resolution failed - this should not happen
        if (retryError.code === '23503' && retryError.message?.includes('location_id_fkey')) {
          throw new Error(`Foreign key constraint violation: location ${locationUuid} does not exist. This indicates a bug in location resolution logic. Original error: ${cleanRetryError.message}`)
        }
        // Still throw error so webhook fails and Square retries
        throw new Error(`Cannot process order: failed to save order and could not create order UUID. Original error: ${cleanRetryError.message}`)
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
        
        // Build lineItemData - explicitly exclude removed fields (recipient_name, shipping fields, fulfillment_type/state)
        // These fields were removed from schema but may still be in old Prisma Client cache
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
          catalog_version: lineItem.catalog_version ? Number(lineItem.catalog_version) : null,
          quantity: lineItem.quantity || null,
          name: lineItem.name || null,
          variation_name: lineItem.variation_name || null,
          item_type: lineItem.item_type || null,
          discount_name: discountName,
          
          // Optional fields from Square API - serialize to handle BigInt values
          metadata: lineItem.metadata ? JSON.parse(safeStringify(lineItem.metadata)) : null,
          custom_attributes: (lineItem.customAttributes || lineItem.custom_attributes) ? JSON.parse(safeStringify(lineItem.customAttributes || lineItem.custom_attributes)) : null,
          fulfillments: (lineItem.fulfillments || lineItem.fulfillment) ? JSON.parse(safeStringify(lineItem.fulfillments || lineItem.fulfillment)) : null,
          applied_taxes: (lineItem.appliedTaxes || lineItem.applied_taxes) ? JSON.parse(safeStringify(lineItem.appliedTaxes || lineItem.applied_taxes)) : null,
          applied_discounts: (lineItem.appliedDiscounts || lineItem.applied_discounts) ? JSON.parse(safeStringify(lineItem.appliedDiscounts || lineItem.applied_discounts)) : null,
          applied_service_charges: (lineItem.appliedServiceCharges || lineItem.applied_service_charges) ? JSON.parse(safeStringify(lineItem.appliedServiceCharges || lineItem.applied_service_charges)) : null,
          note: lineItem.note || null,
          modifiers: lineItem.modifiers ? JSON.parse(safeStringify(lineItem.modifiers)) : null,
          
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
          order_version: order.version ? Number(order.version) : null, // Cast to Number (safe, Square version is small integer)
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
          
          // Raw JSON - serialize to handle BigInt values from Square API
          raw_json: JSON.parse(safeStringify(lineItem)),
        }
        
        // Explicitly exclude removed fields to prevent Prisma errors if old client is cached
        // These fields were removed from schema but may exist in old Prisma Client
        delete lineItemData.recipient_name
        delete lineItemData.recipient_email
        delete lineItemData.recipient_phone
        delete lineItemData.shipping_address_line_1
        delete lineItemData.shipping_address_line_2
        delete lineItemData.shipping_locality
        delete lineItemData.shipping_administrative_district_level_1
        delete lineItemData.shipping_postal_code
        delete lineItemData.shipping_country
        delete lineItemData.fulfillment_type
        delete lineItemData.fulfillment_state

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
              metadata = ${lineItemData.metadata ? safeStringify(lineItemData.metadata) : null}::jsonb,
              custom_attributes = ${lineItemData.custom_attributes ? safeStringify(lineItemData.custom_attributes) : null}::jsonb,
              fulfillments = ${lineItemData.fulfillments ? safeStringify(lineItemData.fulfillments) : null}::jsonb,
              applied_taxes = ${lineItemData.applied_taxes ? safeStringify(lineItemData.applied_taxes) : null}::jsonb,
              applied_discounts = ${lineItemData.applied_discounts ? safeStringify(lineItemData.applied_discounts) : null}::jsonb,
              applied_service_charges = ${lineItemData.applied_service_charges ? safeStringify(lineItemData.applied_service_charges) : null}::jsonb,
              note = ${lineItemData.note},
              modifiers = ${lineItemData.modifiers ? safeStringify(lineItemData.modifiers) : null}::jsonb,
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
              raw_json = COALESCE(${safeStringify(lineItem)}::jsonb, order_line_items.raw_json),
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
        // Ensure error is serialized safely before logging
        safeLogError(`❌ Error saving line item ${lineItem.uid || 'no-uid'}:`, lineItemError)
        // Continue processing other line items - don't let one failure stop the rest
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
    safeLogError(`❌ Error processing order webhook (${eventType}):`, error)
    // Re-throw a clean error without BigInt values so Next.js can serialize it
    const cleanError = new Error(error?.message || 'Order webhook processing failed')
    cleanError.name = error?.name || 'OrderWebhookError'
    cleanError.code = error?.code
    throw cleanError
  }
}

// Export processOrderWebhook for use in referrals route
export { processOrderWebhook }