#!/usr/bin/env node
/**
 * Check for errors in recent webhook processing
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkRecentWebhookErrors() {
  console.log('🔍 Checking for errors in recent webhook processing (last hour)...\n')
  
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  
  // Check giftcard_runs for errors
  const runsWithErrors = await prisma.giftCardRun.findMany({
    where: {
      OR: [
        { square_event_type: 'booking.created' },
        { trigger_type: 'booking.created' }
      ],
      created_at: {
        gte: oneHourAgo
      },
      OR: [
        { status: 'error' },
        { last_error: { not: null } }
      ]
    },
    orderBy: {
      created_at: 'desc'
    },
    take: 20
  })
  
  console.log(`📊 Found ${runsWithErrors.length} booking.created webhook(s) with errors in last hour:\n`)
  
  if (runsWithErrors.length === 0) {
    console.log('✅ No errors found in recent webhook processing.')
  } else {
    for (const run of runsWithErrors) {
      const context = run.context || {}
      const customerId = context.customerId || run.resource_id || 'N/A'
      console.log(`   Run ID: ${run.id}`)
      console.log(`   Correlation ID: ${run.correlation_id}`)
      console.log(`   Customer ID: ${customerId}`)
      console.log(`   Status: ${run.status}`)
      console.log(`   Stage: ${run.stage || 'N/A'}`)
      console.log(`   Error: ${run.last_error || 'N/A'}`)
      console.log(`   Created At: ${run.created_at}`)
      console.log('')
    }
  }
  
  // Check for runs that are stuck in "running" status
  const stuckRuns = await prisma.giftCardRun.findMany({
    where: {
      OR: [
        { square_event_type: 'booking.created' },
        { trigger_type: 'booking.created' }
      ],
      status: 'running',
      created_at: {
        gte: oneHourAgo,
        lte: new Date(Date.now() - 5 * 60 * 1000) // More than 5 minutes ago
      }
    },
    orderBy: {
      created_at: 'desc'
    },
    take: 10
  })
  
  console.log(`\n📊 Found ${stuckRuns.length} booking.created webhook(s) stuck in running status:\n`)
  
  if (stuckRuns.length > 0) {
    for (const run of stuckRuns) {
      const context = run.context || {}
      const customerId = context.customerId || run.resource_id || 'N/A'
      console.log(`   Run ID: ${run.id}`)
      console.log(`   Correlation ID: ${run.correlation_id}`)
      console.log(`   Customer ID: ${customerId}`)
      console.log(`   Stage: ${run.stage || 'N/A'}`)
      console.log(`   Created At: ${run.created_at}`)
      if (run.last_error) {
        console.log(`   Error: ${run.last_error}`)
      }
      console.log('')
    }
  }
  
  // Check the most recent booking webhook in detail
  const mostRecentRun = await prisma.giftCardRun.findFirst({
    where: {
      OR: [
        { square_event_type: 'booking.created' },
        { trigger_type: 'booking.created' }
      ]
    },
    orderBy: {
      created_at: 'desc'
    }
  })
  
  if (mostRecentRun) {
    console.log(`\n📋 Most Recent Booking Webhook:\n`)
    console.log(`   Run ID: ${mostRecentRun.id}`)
    console.log(`   Correlation ID: ${mostRecentRun.correlation_id}`)
    console.log(`   Status: ${mostRecentRun.status}`)
    console.log(`   Stage: ${mostRecentRun.stage || 'N/A'}`)
    console.log(`   Created At: ${mostRecentRun.created_at}`)
    if (mostRecentRun.last_error) {
      console.log(`   ❌ Error: ${mostRecentRun.last_error}`)
    }
    if (mostRecentRun.context) {
      const context = mostRecentRun.context
      console.log(`   Customer ID: ${context.customerId || 'N/A'}`)
      console.log(`   Booking ID: ${context.bookingId || 'N/A'}`)
    }
    console.log('')
  }
  
  await prisma.$disconnect()
}

checkRecentWebhookErrors().catch(console.error)



