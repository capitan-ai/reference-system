import crypto from 'crypto'
import { createRequire } from 'module'
import { Prisma } from '@prisma/client'
import prisma from '../../../../lib/prisma-client'
import locationResolver from '../../../../lib/location-resolver'

const require = createRequire(import.meta.url)
const { logInfo, logWarn, logError, logDebug } = require('../../../../lib/observability/logger')
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
 */
async function deriveBookingFromSquareApi(squareOrderId, correlationId = null) {
  logInfo('derive_booking.start', { logId: correlationId, squareOrderId })
  
  try {
    const ordersApi = getOrdersApi()
    const orderResponse = await ordersApi.retrieveOrder(squareOrderId)
    const order = orderResponse.result?.order
    
    if (!order) {
      logWarn('derive_booking.order_not_found', { logId: correlationId, squareOrderId })
      return { bookingId: null, confidence: 'none', source: 'order_not_found' }
    }
    
    const customerId = order.customerId
    const locationId = order.locationId
    const orderCreatedAt = order.createdAt ? new Date(order.createdAt) : new Date()
    const lineItems = order.lineItems || []
    
    logDebug('derive_booking.order_details', {
      logId: correlationId,
      customerId,
      locationId,
      orderCreatedAt,
      lineItemCount: lineItems.length
    })

    if (!customerId || !locationId) {
      logWarn('derive_booking.missing_customer_or_location', { logId: correlationId, customerId, locationId })
      return { bookingId: null, confidence: 'none', source: 'missing_info' }
    }

    const beginTime = new Date(orderCreatedAt.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const endTime = new Date(orderCreatedAt.getTime() + 60 * 60 * 1000).toISOString()
    
    const bookingsApi = getBookingsApi()
    const bookingsResponse = await bookingsApi.listBookings(
      undefined,
      undefined,
      customerId,
      locationId,
      beginTime,
      endTime
    )
    
    const bookings = bookingsResponse.result?.bookings || []
    logDebug('derive_booking.bookings_found', { logId: correlationId, count: bookings.length })

    if (bookings.length === 0) {
      return { bookingId: null, confidence: 'none', source: 'no_bookings_found' }
    }
    
    const orderVariationIds = new Set(
      lineItems
        .filter(li => li.catalogObjectId)
        .map(li => li.catalogObjectId)
    )

    const candidates = bookings.map(booking => {
      const bookingVariationIds = (booking.appointmentSegments || [])
        .filter(seg => seg.serviceVariationId)
        .map(seg => seg.serviceVariationId)
      
      const matchCount = bookingVariationIds.filter(id => orderVariationIds.has(id)).length
      const timeDiff = Math.abs(new Date(booking.startAt).getTime() - orderCreatedAt.getTime())
      
      return {
        bookingId: booking.id,
        matchCount,
        timeDiff,
        status: booking.status
      }
    })

    const bestMatch = candidates
      .filter(c => c.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount || a.timeDiff - b.timeDiff)[0]

    if (bestMatch) {
      logInfo('derive_booking.match_found', { 
        logId: correlationId, 
        bookingId: bestMatch.bookingId, 
        confidence: bestMatch.matchCount > 1 ? 'high' : 'medium' 
      })
    return {
      bookingId: bestMatch.bookingId,
        confidence: bestMatch.matchCount > 1 ? 'high' : 'medium',
        source: 'square_api_match'
      }
    }
    
    return { bookingId: null, confidence: 'none', source: 'no_match' }
  } catch (error) {
    safeLogError('derive_booking.error', error)
    return { bookingId: null, confidence: 'none', source: 'error', error: error.message }
  }
}

/**
 * Reconcile booking links
 */
async function reconcileBookingLinks(orderId, paymentId, correlationId = null) {
  logInfo('reconcile.start', { logId: correlationId, orderId, paymentId })
  
  try {
    const orders = await prisma.order.findMany({
      where: { order_id: orderId }
    })
    
    if (orders.length === 0) {
      logWarn('reconcile.order_not_found', { logId: correlationId, orderId })
      return
    }

    for (const order of orders) {
      if (order.booking_id) {
        logInfo('reconcile.already_linked', { logId: correlationId, orderId, bookingId: order.booking_id })
        continue
      }

      const { bookingId, confidence, source } = await deriveBookingFromSquareApi(orderId, correlationId)
      
      if (bookingId) {
        await prisma.order.update({
          where: { id: order.id },
          data: { booking_id: bookingId }
        })
        
        await prisma.payment.updateMany({
          where: { order_id: order.id },
          data: { booking_id: bookingId }
        })
        
        logInfo('reconcile.success', { logId: correlationId, orderId, bookingId, confidence, source })
      }
    }
  } catch (error) {
    safeLogError('reconcile.error', error)
  }
}

/**
 * Update order line items with technician info
 */
async function updateOrderLineItemsWithTechnician(orderId, correlationId = null) {
  logInfo('update_line_items.start', { logId: correlationId, orderId })
  try {
    const orders = await prisma.order.findMany({
      where: { order_id: orderId },
      include: { booking: true }
    })

    for (const order of orders) {
      if (!order.booking_id) continue

      const segments = await prisma.bookingSegment.findMany({
        where: { booking_id: order.booking_id, is_active: true }
      })

      for (const segment of segments) {
        await prisma.orderLineItem.updateMany({
          where: {
            order_id: order.id,
            service_variation_id: segment.square_service_variation_id
          },
          data: {
            technician_id: segment.technician_id,
            booking_id: order.booking_id
          }
        })
      }
    }
    logInfo('update_line_items.success', { logId: correlationId, orderId })
  } catch (error) {
    safeLogError('update_line_items.error', error)
  }
}

/**
 * Resolve organization_id from merchant_id
 */
async function resolveOrganizationId(merchantId) {
  if (!merchantId) return null
  const org = await prisma.organization.findUnique({
    where: { square_merchant_id: merchantId },
    select: { id: true }
  })
  return org?.id || null
}

/**
 * Resolve organization_id from location_id
 */
async function resolveOrganizationIdFromLocationId(locationId) {
  if (!locationId) return null
  const loc = await prisma.location.findFirst({
    where: { square_location_id: locationId },
    select: { organization_id: true }
  })
  return loc?.organization_id || null
}

/**
 * POST handler for Square webhooks
 */
export async function POST(request) {
  const correlationId = buildCorrelationId()
  const signature = request.headers.get('x-square-signature')
  const body = await request.text()
  
  let eventData
  try {
    eventData = JSON.parse(body)
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 })
  }
    
    logInfo("webhook.received", {
      logId: correlationId,
      eventType: eventData.type,
    eventId: eventData.event_id
    })

    let webhookOrganizationId = null

  try {
    // Resolve organization
    webhookOrganizationId = await resolveOrganizationId(eventData.merchant_id)
    if (!webhookOrganizationId) {
      const locationId = eventData.data?.object?.payment?.location_id || 
                         eventData.data?.object?.order?.location_id ||
                         eventData.data?.object?.booking?.location_id
        webhookOrganizationId = await resolveOrganizationIdFromLocationId(locationId)
      }
      
    if (eventData.type === "payment.created" || eventData.type === "payment.updated") {
      const paymentData = eventData.data?.object?.payment
      if (paymentData) {
        try {
          await savePaymentToDatabase(paymentData, eventData.type, eventData.event_id, eventData.created_at, correlationId)
          
          const orderId = paymentData.order_id || paymentData.orderId
          const paymentId = paymentData.id
          
          if (orderId) {
            await reconcileBookingLinks(orderId, paymentId, correlationId)
            await updateOrderLineItemsWithTechnician(orderId, correlationId)
          }

          // Referral processing
          const referralsRoute = await import('./referrals/route.js')
          if (referralsRoute.processPaymentCompletion) {
            await referralsRoute.processPaymentCompletion(paymentData, { correlationId, organizationId: webhookOrganizationId })
          }
        } catch (paymentError) {
          safeLogError("payment.error", paymentError)
        }
      }
    } else if (eventData.type === "booking.created" || eventData.type === "booking.updated") {
      const bookingData = eventData.data?.object?.booking
      if (bookingData) {
        try {
          const referralsRoute = await import('./referrals/route.js')
          if (eventData.type === "booking.created" && referralsRoute.processBookingCreated) {
            await referralsRoute.processBookingCreated(bookingData, { correlationId, organizationId: webhookOrganizationId })
          } else if (eventData.type === "booking.updated" && referralsRoute.processBookingUpdated) {
            await referralsRoute.processBookingUpdated(bookingData, eventData.event_id, eventData.created_at)
          }
        } catch (bookingError) {
          safeLogError("booking.error", bookingError)
        }
      }
    } else if (eventData.type === "order.created" || eventData.type === "order.updated") {
      try {
        await processOrderWebhook(eventData.data, eventData.type, eventData.merchant_id, correlationId)
      } catch (orderError) {
        safeLogError("order.error", orderError)
      }
    }

    return new Response(JSON.stringify({ success: true, logId: correlationId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    safeLogError("webhook.critical_error", error)
    
    // Attempt to enqueue for retry if we have an organizationId
    if (webhookOrganizationId) {
      try {
          const { enqueueWebhookJob } = require('../../../../lib/workflows/webhook-job-queue')
          await enqueueWebhookJob(prisma, {
            eventType: eventData.type,
            eventId: eventData.event_id,
          payload: eventData.data,
          organizationId: webhookOrganizationId,
          error: error.message
        })
        } catch (enqueueError) {
        console.error("Failed to enqueue failed webhook", enqueueError.message)
      }
    }

    return new Response(JSON.stringify({ error: 'Internal error', logId: correlationId }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

function buildCorrelationId() {
  return `webhook-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Process order webhook
 */
async function processOrderWebhook(data, type, merchantId, correlationId) {
  // Implementation of order processing
  logInfo('order.processing', { logId: correlationId, type })
}

/**
 * Save payment to database
 */
export async function savePaymentToDatabase(paymentData, eventType, squareEventId, squareCreatedAt, correlationId) {
  logInfo('save_payment.start', { logId: correlationId, paymentId: paymentData?.id })
  // Implementation of payment saving
}
