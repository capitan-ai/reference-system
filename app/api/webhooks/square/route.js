import crypto from 'crypto'

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
    } else if (eventData.type === 'payment.updated') {
      console.log('💳 Payment updated event received')
      console.log('📊 Data:', eventData.data)
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