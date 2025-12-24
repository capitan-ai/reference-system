const prisma = require('./prisma-client')
const {
  ReferralEventType,
  NotificationChannel,
  NotificationStatus,
  NotificationTemplateType,
  ProcessRunStatus
} = require('@prisma/client')

const MAX_ERROR_LENGTH = 500

function isAnalyticsEnabled() {
  return process.env.ENABLE_REFERRAL_ANALYTICS === 'true'
}

function safeValue(value) {
  if (value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'function') return value.toString()
  return value
}

function sanitizePayload(payload = {}) {
  try {
    return JSON.parse(
      JSON.stringify(payload, (_key, value) => {
        if (value instanceof Date) {
          return value.toISOString()
        }
        if (typeof value === 'bigint') {
          return Number(value)
        }
        if (value === undefined) {
          return null
        }
        return value
      })
    )
  } catch (error) {
    console.warn('⚠️ Unable to sanitize analytics payload:', error.message)
    return { failedToSanitize: true }
  }
}

async function writeDeadLetter(eventType, payload, error) {
  try {
    await prisma.analyticsDeadLetter.create({
      data: {
        eventType: eventType ?? 'unknown',
        payload: sanitizePayload(payload),
        errorMessage: (error?.message || String(error || 'unknown')).slice(0, MAX_ERROR_LENGTH)
      }
    })
  } catch (persistError) {
    console.error('❌ Failed to record analytics dead letter:', persistError.message)
  }
}

async function runAnalyticsOperation(eventType, handler, payloadForDeadLetter = {}) {
  if (!isAnalyticsEnabled()) {
    return null
  }

  try {
    return await handler()
  } catch (error) {
    console.error(`⚠️ Analytics operation "${eventType}" failed:`, error.message)
    await writeDeadLetter(eventType, payloadForDeadLetter, error)
    return null
  }
}

function buildReferralEventData(input = {}) {
  const data = {
    eventType: input.eventType || ReferralEventType.CUSTOM,
    occurredAt: safeValue(input.occurredAt) || new Date(),
    createdAt: safeValue(input.createdAt) || new Date()
  }

  ;[
    'processRunId',
    'referrerCustomerId',
    'friendCustomerId',
    'refRewardId',
    'refLinkId',
    'refMatchId',
    'revenueAttributedId',
    'source'
  ].forEach((key) => {
    if (input[key]) {
      data[key] = input[key]
    }
  })

  if (typeof input.amountCents === 'number') {
    data.amountCents = input.amountCents
  }

  if (input.currency) {
    data.currency = input.currency
  }

  if (input.metadata) {
    data.metadata = sanitizePayload(input.metadata)
  }

  return data
}

async function recordReferralEvent(eventInput = {}) {
  return runAnalyticsOperation(
    'referral_event',
    async () => {
      return prisma.referralEvent.create({
        data: buildReferralEventData(eventInput)
      })
    },
    eventInput
  )
}

function buildNotificationEventData(input = {}) {
  const data = {
    channel: input.channel || NotificationChannel.SMS,
    templateType: input.templateType || NotificationTemplateType.OTHER,
    status: input.status || NotificationStatus.queued,
    createdAt: safeValue(input.createdAt) || new Date()
  }

  ;[
    'customerId',
    'referrerCustomerId',
    'referralEventId',
    'externalId',
    'templateId'
  ].forEach((key) => {
    if (input[key]) {
      data[key] = input[key]
    }
  })

  if (input.errorCode !== undefined && input.errorCode !== null) {
    data.errorCode = String(input.errorCode)
  }

  if (input.sentAt) {
    data.sentAt = input.sentAt
  }
  if (input.statusAt) {
    data.statusAt = input.statusAt
  }
  if (input.errorMessage) {
    data.errorMessage = input.errorMessage.slice(0, MAX_ERROR_LENGTH)
  }
  if (input.metadata) {
    data.metadata = sanitizePayload(input.metadata)
  }

  return data
}

async function recordNotificationEvent(input = {}) {
  return runAnalyticsOperation(
    'notification_event',
    async () => {
      return prisma.notificationEvent.create({
        data: buildNotificationEventData(input)
      })
    },
    input
  )
}

function buildAnalyticsEventData(input = {}) {
  const data = {
    eventType: input.eventType || 'custom',
    createdAt: safeValue(input.createdAt) || new Date()
  }

  ;[
    'source',
    'squareCustomerId',
    'bookingId',
    'paymentId',
    'referralCode'
  ].forEach((key) => {
    if (input[key]) {
      data[key] = input[key]
    }
  })

  if (typeof input.amountCents === 'number' && Number.isFinite(input.amountCents)) {
    data.amountCents = Math.trunc(input.amountCents)
  }
  if (input.metadata) {
    data.metadata = sanitizePayload(input.metadata)
  }

  return data
}

async function recordAnalyticsEvent(input = {}) {
  return runAnalyticsOperation(
    'analytics_event',
    async () => {
      return prisma.analyticsEvent.create({
        data: buildAnalyticsEventData(input)
      })
    },
    input
  )
}

async function startProcessRun({ processType, metadata } = {}) {
  if (!processType) {
    return null
  }

  return runAnalyticsOperation(
    'process_run_start',
    async () => {
      return prisma.referralProcessRun.create({
        data: {
          processType,
          status: ProcessRunStatus.running,
          metadata: metadata ? sanitizePayload(metadata) : undefined
        }
      })
    },
    { processType, metadata }
  )
}

async function completeProcessRun({
  runId,
  status = ProcessRunStatus.completed,
  totals = {},
  metadata,
  durationMs
} = {}) {
  if (!runId) return null

  return runAnalyticsOperation(
    'process_run_complete',
    async () => {
      const completedAt = new Date()

      const updatedRun = await prisma.referralProcessRun.update({
        where: { id: runId },
        data: {
          status,
          completedAt,
          durationMs: typeof durationMs === 'number' ? durationMs : undefined,
          totalCount: typeof totals.totalCount === 'number' ? totals.totalCount : undefined,
          successCount: typeof totals.successCount === 'number' ? totals.successCount : undefined,
          failureCount: typeof totals.failureCount === 'number' ? totals.failureCount : undefined,
          metadata: metadata ? sanitizePayload(metadata) : undefined
        }
      })

      await prisma.referralEvent.create({
        data: buildReferralEventData({
          eventType: ReferralEventType.PROCESS_COMPLETED,
          processRunId: runId,
          occurredAt: completedAt,
          metadata: {
            status,
            totals
          }
        })
      })

      return updatedRun
    },
    { runId, status, totals, metadata }
  )
}

async function recordRevenueEvent({
  paymentId,
  bookingId,
  customerId,
  referrerCustomerId,
  refMatchId,
  amountCents,
  currency = 'USD',
  occurredAt,
  metadata
} = {}) {
  if (!customerId || typeof amountCents !== 'number') {
    return null
  }

  return runAnalyticsOperation(
    'revenue_event',
    async () => {
      const payload = {
        paymentId,
        bookingId,
        customerId,
        referrerCustomerId,
        refMatchId,
        amountCents,
        currency,
        occurredAt: occurredAt || new Date(),
        metadata: metadata ? sanitizePayload(metadata) : undefined
      }

      let record
      if (paymentId) {
        record = await prisma.revenueAttribution.upsert({
          where: { paymentId },
          update: payload,
          create: payload
        })
      } else {
        record = await prisma.revenueAttribution.create({
          data: payload
        })
      }

      await prisma.referralEvent.create({
        data: buildReferralEventData({
          eventType: ReferralEventType.REVENUE_FROM_REFERRAL,
          referrerCustomerId,
          friendCustomerId: customerId,
          amountCents,
          currency,
          refMatchId,
          revenueAttributedId: record.id,
          occurredAt: occurredAt || new Date(),
          metadata
        })
      })

      return record
    },
    { paymentId, bookingId, customerId }
  )
}

module.exports = {
  isAnalyticsEnabled,
  recordReferralEvent,
  recordNotificationEvent,
  recordRevenueEvent,
  recordAnalyticsEvent,
  startProcessRun,
  completeProcessRun,
  ReferralEventType,
  NotificationChannel,
  NotificationStatus,
  NotificationTemplateType,
  ProcessRunStatus
}

