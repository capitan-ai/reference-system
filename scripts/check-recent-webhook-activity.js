#!/usr/bin/env node
/**
 * Check for recent webhook processing activity
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkRecentWebhookActivity() {
  console.log('🔍 Checking for recent webhook processing activity (last hour)...\n')
  
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  
  // Check giftcard_runs for recent booking.created events
  const recentRuns = await prisma.giftCardRun.findMany({
    where: {
      OR: [
        { square_event_type: 'booking.created' },
        { trigger_type: 'booking.created' }
      ],
      created_at: {
        gte: oneHourAgo
      }
    },
    orderBy: {
      created_at: 'desc'
    },
    take: 20
  })
  
  console.log(`📊 Found ${recentRuns.length} booking.created webhook event(s) in last hour:\n`)
  
  if (recentRuns.length === 0) {
    console.log('✅ No booking.created webhooks processed in the last hour.')
    console.log('   This could mean:')
    console.log('   1. No booking webhooks were received')
    console.log('   2. The webhook was blocked by validation')
    console.log('   3. The webhook is still queued for processing\n')
  } else {
    for (const run of recentRuns) {
      const context = run.context || {}
      const customerId = context.customerId || run.resource_id || 'N/A'
      console.log(`   Run ID: ${run.id}`)
      console.log(`   Correlation ID: ${run.correlation_id}`)
      console.log(`   Customer ID: ${customerId}`)
      console.log(`   Status: ${run.status}`)
      console.log(`   Stage: ${run.stage || 'N/A'}`)
      console.log(`   Created At: ${run.created_at}`)
      if (run.last_error) {
        console.log(`   ❌ Error: ${run.last_error}`)
      }
      console.log('')
    }
  }
  
  // Also check giftcard_jobs for recent booking jobs
  try {
    const recentJobs = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        stage,
        status,
        trigger_type,
        attempts,
        last_error,
        created_at,
        scheduled_at,
        locked_at
      FROM giftcard_jobs
      WHERE trigger_type = 'booking.created'
        AND created_at >= ${oneHourAgo}
      ORDER BY created_at DESC
      LIMIT 20
    `
    
    console.log(`\n📊 Found ${recentJobs.length} booking.created job(s) in last hour:\n`)
    
    if (recentJobs.length > 0) {
      for (const job of recentJobs) {
        console.log(`   Job ID: ${job.id}`)
        console.log(`   Correlation ID: ${job.correlation_id}`)
        console.log(`   Status: ${job.status}`)
        console.log(`   Stage: ${job.stage}`)
        console.log(`   Attempts: ${job.attempts}`)
        console.log(`   Created At: ${job.created_at}`)
        if (job.last_error) {
          console.log(`   ❌ Error: ${job.last_error}`)
        }
        console.log('')
      }
    }
  } catch (error) {
    if (error.message?.includes('does not exist')) {
      console.log('\n⚠️ giftcard_jobs table does not exist (this is OK if job queue is not enabled)')
    } else {
      throw error
    }
  }
  
  await prisma.$disconnect()
}

checkRecentWebhookActivity().catch(console.error)



