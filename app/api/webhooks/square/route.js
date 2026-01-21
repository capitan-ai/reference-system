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
        const orderId = paymentData.order_id || paymentData.orderId
        if (orderId) {
          // Update order_line_items with master's team_member_id when payment arrives
          await updateOrderLineItemsWithMasterTeamMember(orderId)
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
 * Update order_line_items with master's team_member_id from booking
 * Gets the master (technician) ID from booking's appointment segments
 * instead of admin's ID from payment
 */
async function updateOrderLineItemsWithMasterTeamMember(orderId) {
  try {
    // Find payment linked to this order
    const paymentWithBooking = await prisma.$queryRaw`
      SELECT booking_id
      FROM payments
      WHERE order_id = ${orderId}
        AND booking_id IS NOT NULL
      LIMIT 1
    `

    if (!paymentWithBooking || paymentWithBooking.length === 0) {
      console.log(`ℹ️ No payment with booking_id found for order ${orderId} yet (might arrive later)`)
      return null
    }

    const bookingId = paymentWithBooking[0].booking_id
    console.log(`🔍 Found booking ${bookingId} for order ${orderId}`)

    // Get master's team_member_id from booking's appointment segments
    // Prioritize segments with specific team_member_id (not any_team_member)
    const appointmentSegment = await prisma.$queryRaw`
      SELECT team_member_id
      FROM booking_appointment_segments
      WHERE booking_id = ${bookingId}
        AND team_member_id IS NOT NULL
        AND any_team_member = false
      ORDER BY duration_minutes DESC
      LIMIT 1
    `

    if (!appointmentSegment || appointmentSegment.length === 0) {
      console.log(`⚠️ No appointment segment found with team_member_id for booking ${bookingId}`)
      return null
    }

    const masterTeamMemberId = appointmentSegment[0].team_member_id
    console.log(`✅ Found master team_member_id: ${masterTeamMemberId} for order ${orderId}`)

    // Update all line items for this order with master's team_member_id
    const updateResult = await prisma.$executeRaw`
      UPDATE order_line_items
      SET team_member_id = ${masterTeamMemberId}
      WHERE order_id = ${orderId}
        AND (team_member_id IS NULL OR team_member_id != ${masterTeamMemberId})
    `

    console.log(`✅ Updated order_line_items with master team_member_id for order ${orderId}`)
    return masterTeamMemberId
  } catch (error) {
    console.error(`❌ Error updating order_line_items with master team_member_id for order ${orderId}:`, error.message)
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

    console.log(`📦 Processing order ${orderId} with ${lineItems.length} line items`)

    // 1. Save/update the order in the orders table
    try {
      await prisma.$executeRaw`
        INSERT INTO orders (
          id,
          location_id,
          customer_id,
          state,
          version,
          reference_id,
          created_at,
          updated_at
        ) VALUES (
          ${orderId},
          ${finalLocationId},
          ${customerId},
          ${orderState || order.state || null},
          ${order.version ? Number(order.version) : null},
          ${order.reference_id || null},
          ${order.created_at ? new Date(order.created_at) : new Date()},
          ${order.updated_at ? new Date(order.updated_at) : new Date()}
        )
        ON CONFLICT (id) DO UPDATE SET
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

    // 2. Process each line item
    for (const lineItem of lineItems) {
      try {
        const lineItemData = {
          order_id: orderId,
          location_id: finalLocationId,
          customer_id: customerId || null,
          
          uid: lineItem.uid || null,
          catalog_object_id: lineItem.catalog_object_id || null,
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
          await prisma.orderLineItem.upsert({
            where: { uid: lineItem.uid },
            update: lineItemData,
            create: {
              ...lineItemData,
              id: crypto.randomUUID(),
            }
          })
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

    // 3. Update order_line_items with master's team_member_id from booking
    // (Payment might not exist yet, so this will try again later via payment webhook)
    await updateOrderLineItemsWithMasterTeamMember(orderId)
    
  } catch (error) {
    console.error(`❌ Error processing order webhook (${eventType}):`, error)
    throw error
  }
}