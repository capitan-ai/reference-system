#!/usr/bin/env node

/**
 * Replays analytics events that were previously written to the analytics_dead_letter queue.
 * Usage:
 *   ENABLE_REFERRAL_ANALYTICS=true node scripts/replay-analytics-dead-letters.js
 */

require('dotenv').config()

const prisma = require('../lib/prisma-client')
const {
  recordReferralEvent,
  recordNotificationEvent,
  recordRevenueEvent,
} = require('../lib/analytics-service')

if (process.env.ENABLE_REFERRAL_ANALYTICS !== 'true') {
  console.warn('⚠️ ENABLE_REFERRAL_ANALYTICS is not true. Replaying events will be skipped.')
}

const HANDLERS = {
  referral_event: recordReferralEvent,
  notification_event: recordNotificationEvent,
  revenue_event: recordRevenueEvent,
}

async function replayDeadLetters(batchSize = 50) {
  const letters = await prisma.analyticsDeadLetter.findMany({
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  })

  if (!letters.length) {
    console.log('✅ No analytics dead letters to replay.')
    return
  }

  let successCount = 0
  let failureCount = 0

  for (const letter of letters) {
    const handler = HANDLERS[letter.eventType]
    if (!handler) {
      console.warn(`⚠️ Skipping unsupported dead letter type: ${letter.eventType}`)
      failureCount += 1
      continue
    }

    try {
      const result = await handler(letter.payload || {})
      if (!result) {
        throw new Error('Handler returned no result (check ENABLE_REFERRAL_ANALYTICS or payload)')
      }
      await prisma.analyticsDeadLetter.delete({ where: { id: letter.id } })
      successCount += 1
    } catch (error) {
      failureCount += 1
      console.error(`❌ Failed to replay ${letter.eventType} (${letter.id}):`, error.message)
    }
  }

  console.log(`Replayed analytics dead letters: ${successCount} succeeded, ${failureCount} failed.`)
  if (successCount && failureCount === 0) {
    console.log('✨ All queued analytics events were reinserted successfully.')
  }
}

replayDeadLetters()
  .catch((error) => {
    console.error('❌ Dead letter replay crashed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

