/**
 * Twilio Status Callback Webhook
 * Receives SMS delivery status updates and updates notification_events.
 *
 * POST /api/webhooks/twilio
 *
 * Setup in Twilio:
 *   Messaging Service → Status Callback URL → this endpoint
 *   Or pass StatusCallback param when sending each message
 */

export const dynamic = 'force-dynamic'

import prisma from '@/lib/prisma-client'
import { createHmac } from 'crypto'

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN

// Map Twilio status to our NotificationStatus enum
const TWILIO_STATUS_MAP = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'failed',
  failed: 'failed',
}

// Status priority — only upgrade, never downgrade
const STATUS_PRIORITY = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  failed: 10,
  bounced: 10,
}

/**
 * Validate Twilio request signature
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
function validateTwilioSignature(url, params, signature) {
  if (!TWILIO_AUTH_TOKEN) return true // skip if not configured

  // Build the data string: URL + sorted params
  let data = url
  const sortedKeys = Object.keys(params).sort()
  for (const key of sortedKeys) {
    data += key + params[key]
  }

  const expected = createHmac('sha1', TWILIO_AUTH_TOKEN)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64')

  return signature === expected
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const params = Object.fromEntries(formData.entries())

    const {
      MessageSid,
      MessageStatus,
      ErrorCode,
      ErrorMessage,
      To,
      From,
    } = params

    // Validate signature
    const twilioSignature = request.headers.get('x-twilio-signature')
    if (TWILIO_AUTH_TOKEN && twilioSignature) {
      const requestUrl = new URL(request.url)
      // Use the full URL as Twilio sees it (might need the public URL)
      const fullUrl = process.env.NEXT_PUBLIC_BASE_URL
        ? `${process.env.NEXT_PUBLIC_BASE_URL}/api/webhooks/twilio`
        : requestUrl.toString()

      if (!validateTwilioSignature(fullUrl, params, twilioSignature)) {
        console.warn('Twilio webhook: invalid signature')
        return new Response('<Response></Response>', {
          status: 403,
          headers: { 'Content-Type': 'text/xml' }
        })
      }
    }

    if (!MessageSid || !MessageStatus) {
      return new Response('<Response></Response>', {
        status: 400,
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    const newStatus = TWILIO_STATUS_MAP[MessageStatus]
    if (!newStatus) {
      // Unknown status — acknowledge but don't process
      return new Response('<Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    // Find the notification by externalId (Twilio MessageSid)
    const notification = await prisma.notificationEvent.findFirst({
      where: {
        externalId: MessageSid,
        channel: 'SMS'
      },
      select: { id: true, status: true }
    })

    if (!notification) {
      console.log(`Twilio webhook: no notification found for SID ${MessageSid}`)
      return new Response('<Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' }
      })
    }

    // Only update if new status is higher priority
    const shouldUpdate = (STATUS_PRIORITY[newStatus] ?? 0) > (STATUS_PRIORITY[notification.status] ?? 0)

    if (shouldUpdate) {
      await prisma.notificationEvent.update({
        where: { id: notification.id },
        data: {
          status: newStatus,
          statusAt: new Date(),
          errorCode: ErrorCode || null,
          errorMessage: ErrorMessage || null,
        }
      })
      console.log(`Twilio webhook: ${MessageSid} → ${newStatus}`)
    }

    // Twilio expects TwiML response
    return new Response('<Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' }
    })

  } catch (error) {
    console.error('Twilio webhook error:', error.message)
    return new Response('<Response></Response>', {
      status: 500,
      headers: { 'Content-Type': 'text/xml' }
    })
  }
}
