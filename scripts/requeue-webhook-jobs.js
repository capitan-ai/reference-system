#!/usr/bin/env node
/**
 * Requeue errored webhook jobs
 * 
 * This script resets webhook jobs with status 'error' back to 'queued'
 * so they can be processed again by the cron job.
 * 
 * Usage:
 *   node scripts/requeue-webhook-jobs.js                    # Requeue all errored jobs
 *   node scripts/requeue-webhook-jobs.js --event-type booking.created    # Requeue only specific event type
 *   node scripts/requeue-webhook-jobs.js --dry-run          # Show what would be requeued without updating
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function requeueWebhookJobs(options = {}) {
  const { eventType, dryRun = false } = options
  
  try {
    console.log('🔍 Finding errored webhook jobs to requeue...\n')
    
    // Find jobs with status 'error'
    let errorJobsQuery
    if (eventType) {
      errorJobsQuery = prisma.$queryRaw`
        SELECT 
          id,
          organization_id,
          event_type,
          event_id,
          attempts,
          max_attempts,
          status,
          scheduled_at,
          last_error,
          created_at,
          updated_at
        FROM webhook_jobs
        WHERE status = 'error'
          AND event_type = ${eventType}
        ORDER BY updated_at DESC
      `
    } else {
      errorJobsQuery = prisma.$queryRaw`
        SELECT 
          id,
          organization_id,
          event_type,
          event_id,
          attempts,
          max_attempts,
          status,
          scheduled_at,
          last_error,
          created_at,
          updated_at
        FROM webhook_jobs
        WHERE status = 'error'
        ORDER BY updated_at DESC
      `
    }
    
    const errorJobs = await errorJobsQuery
    
    if (errorJobs.length === 0) {
      console.log('✅ No errored webhook jobs found to requeue')
      return
    }
    
    console.log(`📋 Found ${errorJobs.length} errored webhook job(s):\n`)
    
    // Group by event type for reporting
    const byEventType = {}
    errorJobs.forEach(job => {
      if (!byEventType[job.event_type]) {
        byEventType[job.event_type] = []
      }
      byEventType[job.event_type].push(job)
    })
    
    console.log('📝 Job breakdown by event type:')
    Object.entries(byEventType).forEach(([eventType, jobs]) => {
      console.log(`   - ${eventType}: ${jobs.length} job(s)`)
    })
    console.log('')
    
    // Show sample job details
    if (errorJobs.length > 0) {
      console.log('📝 Sample job details (first 10):\n')
      errorJobs.slice(0, 10).forEach((job, idx) => {
        console.log(`  ${idx + 1}. ${job.event_type} (event_id: ${job.event_id})`)
        console.log(`     Job ID: ${job.id}`)
        console.log(`     Attempts: ${job.attempts}/${job.max_attempts}`)
        const errorAt = new Date(job.updated_at)
        const ago = Math.round((Date.now() - errorAt.getTime()) / 1000 / 60) // minutes ago
        console.log(`     Failed: ${ago} minutes ago`)
        if (job.last_error) {
          const errorPreview = job.last_error.length > 100 
            ? job.last_error.substring(0, 100) + '...' 
            : job.last_error
          console.log(`     Error: ${errorPreview}`)
        }
        console.log('')
      })
      
      if (errorJobs.length > 10) {
        console.log(`   ... and ${errorJobs.length - 10} more job(s)\n`)
      }
    }
    
    if (dryRun) {
      console.log('🔍 DRY RUN: No changes made. Remove --dry-run to actually requeue jobs.\n')
      return
    }
    
    console.log('🔄 Requeuing jobs for immediate processing...\n')
    
    // Update error jobs
    let updateQuery
    if (eventType) {
      updateQuery = prisma.$executeRaw`
        UPDATE webhook_jobs
        SET 
          status = 'queued',
          scheduled_at = NOW(),
          attempts = 0,
          last_error = NULL,
          locked_at = NULL,
          lock_owner = NULL,
          updated_at = NOW()
        WHERE status = 'error'
          AND event_type = ${eventType}
      `
    } else {
      updateQuery = prisma.$executeRaw`
        UPDATE webhook_jobs
        SET 
          status = 'queued',
          scheduled_at = NOW(),
          attempts = 0,
          last_error = NULL,
          locked_at = NULL,
          lock_owner = NULL,
          updated_at = NOW()
        WHERE status = 'error'
      `
    }
    
    await updateQuery
    console.log(`✅ Successfully requeued ${errorJobs.length} webhook job(s) for immediate processing`)
    console.log(`   They will be processed on the next cron run (every minute)\n`)
    
  } catch (error) {
    console.error('❌ Error requeuing webhook jobs:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  dryRun: args.includes('--dry-run')
}

args.forEach((arg, idx) => {
  if (arg === '--event-type' && args[idx + 1]) {
    options.eventType = args[idx + 1]
  }
})

requeueWebhookJobs(options).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

