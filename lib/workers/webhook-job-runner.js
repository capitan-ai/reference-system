const { PrismaClient } = require('@prisma/client')
const { lockNextWebhookJob, completeWebhookJob, failWebhookJob } = require('../workflows/webhook-job-queue')

const prisma = new PrismaClient()

/**
 * Process a single webhook job
 */
async function processWebhookJob(job) {
  const { eventType, eventId, payload } = job
  
  console.log(`[WEBHOOK-JOB] Processing ${eventType} (event_id: ${eventId})`)
  
  // Import webhook processors
  const handlerModule = await import('../../app/api/webhooks/square/webhook-processors.js')
  
  // Map event types to handler functions
  const handlerMap = {
    'booking.created': handlerModule.processBookingCreated,
    'booking.updated': handlerModule.processBookingUpdated,
    'customer.created': handlerModule.processCustomerCreated,
    'payment.updated': handlerModule.processPaymentUpdated,
    'gift_card.activity.created': handlerModule.processGiftCardActivityCreated,
    'gift_card.activity.updated': handlerModule.processGiftCardActivityUpdated,
    'gift_card.customer_linked': handlerModule.processGiftCardCustomerLinked,
    'gift_card.updated': handlerModule.processGiftCardUpdated,
    'refund.created': handlerModule.processRefundCreated,
    'refund.updated': handlerModule.processRefundUpdated,
    'order.updated': handlerModule.processOrderUpdated,
    'team_member.created': handlerModule.processTeamMemberCreated
  }
  
  const handler = handlerMap[eventType]
  
  if (!handler) {
    throw new Error(`Unknown webhook event type: ${eventType}`)
  }
  
  // Call handler with payload
  await handler(payload, eventId, job.eventCreatedAt)
}

/**
 * Run a single webhook job from the queue
 */
async function runWebhookJobOnce({ workerId = `serverless-${require('crypto').randomUUID()}` } = {}) {
  const job = await lockNextWebhookJob(prisma, workerId)
  
  if (!job) {
    return { processed: false }
  }
  
  try {
    await processWebhookJob(job)
    await completeWebhookJob(prisma, job.id)
    
    return {
      processed: true,
      jobId: job.id,
      eventType: job.eventType,
      eventId: job.eventId
    }
  } catch (error) {
    await failWebhookJob(prisma, job.id, error)
    throw error
  }
}

module.exports = {
  runWebhookJobOnce
}


