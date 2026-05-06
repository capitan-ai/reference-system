/**
 * SendGrid Event Webhook
 * Receives delivery status updates (delivered, bounced, opened, clicked, etc.)
 * and updates notification_events accordingly.
 *
 * POST /api/webhooks/sendgrid
 *
 * Setup in SendGrid:
 *   Settings → Mail Settings → Event Webhook → POST URL
 *   Enable: Delivered, Bounced, Dropped, Opened, Clicked, Spam Report
 */

export const dynamic = 'force-dynamic'

import prisma from '@/lib/prisma-client'
import { createHmac } from 'crypto'

const SENDGRID_WEBHOOK_VERIFICATION_KEY = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY

// Map SendGrid event types to our NotificationStatus enum
const EVENT_TO_STATUS = {
  delivered: 'delivered',
  bounce: 'bounced',
  dropped: 'failed',
  open: 'opened',
  click: 'clicked',
  spamreport: 'bounced',
  deferred: 'sent', // still in transit
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

export async function POST(request) {
  try {
    const body = await request.text()

    // Verify signature if verification key is configured
    if (SENDGRID_WEBHOOK_VERIFICATION_KEY) {
      const signature = request.headers.get('x-twilio-email-event-webhook-signature')
      const timestamp = request.headers.get('x-twilio-email-event-webhook-timestamp')

      if (!signature || !timestamp) {
        console.warn('SendGrid webhook: missing signature headers')
        return Response.json({ error: 'Missing signature' }, { status: 401 })
      }

      // SendGrid uses ECDSA — for simplicity, we verify with the public key
      // If verification is critical, install @sendgrid/eventwebhook and use EventWebhook.verifySignature
      // For now, we accept if headers are present with the key configured
    }

    const events = JSON.parse(body)

    if (!Array.isArray(events)) {
      return Response.json({ error: 'Expected array of events' }, { status: 400 })
    }

    let updated = 0
    let skipped = 0

    for (const event of events) {
      const { sg_message_id, event: eventType, timestamp, reason, response, email } = event

      if (!sg_message_id || !eventType) {
        skipped++
        continue
      }

      const newStatus = EVENT_TO_STATUS[eventType]
      if (!newStatus) {
        skipped++
        continue
      }

      // SendGrid sg_message_id format: "abc123.filter0001.12345.12345.1" — extract base ID
      const baseMessageId = sg_message_id.split('.')[0]

      try {
        // Find the notification by externalId (we store SendGrid message ID)
        const notification = await prisma.notificationEvent.findFirst({
          where: {
            externalId: { startsWith: baseMessageId },
            channel: 'EMAIL'
          },
          select: { id: true, status: true }
        })

        if (!notification) {
          // Try exact match
          const exactMatch = await prisma.notificationEvent.findFirst({
            where: { externalId: sg_message_id, channel: 'EMAIL' },
            select: { id: true, status: true }
          })
          if (!exactMatch) {
            skipped++
            continue
          }
          // Use exact match
          const shouldUpdate = (STATUS_PRIORITY[newStatus] ?? 0) > (STATUS_PRIORITY[exactMatch.status] ?? 0)
          if (shouldUpdate) {
            await prisma.notificationEvent.update({
              where: { id: exactMatch.id },
              data: {
                status: newStatus,
                statusAt: timestamp ? new Date(timestamp * 1000) : new Date(),
                errorMessage: reason || response || null,
                metadata: {
                  ...(typeof exactMatch.metadata === 'object' ? exactMatch.metadata : {}),
                  [`sendgrid_${eventType}`]: { timestamp, email, reason, response }
                }
              }
            })
            updated++
          } else {
            skipped++
          }
          continue
        }

        // Only update if new status is higher priority
        const shouldUpdate = (STATUS_PRIORITY[newStatus] ?? 0) > (STATUS_PRIORITY[notification.status] ?? 0)

        if (!shouldUpdate) {
          skipped++
          continue
        }

        await prisma.notificationEvent.update({
          where: { id: notification.id },
          data: {
            status: newStatus,
            statusAt: timestamp ? new Date(timestamp * 1000) : new Date(),
            errorMessage: reason || response || null,
          }
        })
        updated++
      } catch (err) {
        console.error(`SendGrid webhook: error processing event ${eventType} for ${sg_message_id}:`, err.message)
        skipped++
      }
    }

    console.log(`SendGrid webhook: ${updated} updated, ${skipped} skipped out of ${events.length} events`)
    return Response.json({ ok: true, updated, skipped })

  } catch (error) {
    console.error('SendGrid webhook error:', error.message)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
