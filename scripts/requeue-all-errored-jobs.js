#!/usr/bin/env node
/**
 * Requeue all errored and unfinished cron jobs
 * 
 * This script resets:
 * - Jobs with status 'error'
 * - Jobs with status 'queued' that have exceeded max_attempts
 * - Stuck jobs with status 'running' that have been locked for > 5 minutes
 * 
 * Usage:
 *   node scripts/requeue-all-errored-jobs.js                    # Requeue all errored/unfinished jobs
 *   node scripts/requeue-all-errored-jobs.js --stage customer_ingest    # Requeue only specific stage
 *   node scripts/requeue-all-errored-jobs.js --dry-run          # Show what would be requeued without updating
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function requeueAllErroredJobs(options = {}) {
  const { stage, dryRun = false } = options
  
  try {
    console.log('🔍 Finding errored and unfinished jobs to requeue...\n')
    
    // 1. Find jobs with status 'error'
    let errorJobsQuery
    if (stage) {
      errorJobsQuery = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
          trigger_type,
          attempts,
          max_attempts,
          status,
          scheduled_at,
          last_error,
          created_at,
          updated_at
        FROM giftcard_jobs
        WHERE status = 'error'
          AND stage = ${stage}
        ORDER BY updated_at DESC
      `
    } else {
      errorJobsQuery = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
          trigger_type,
          attempts,
          max_attempts,
          status,
          scheduled_at,
          last_error,
          created_at,
          updated_at
        FROM giftcard_jobs
        WHERE status = 'error'
        ORDER BY updated_at DESC
      `
    }
    
    const errorJobs = await errorJobsQuery
    
    // 2. Find queued jobs that exceeded max_attempts
    let queuedFailedQuery
    if (stage) {
      queuedFailedQuery = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
          trigger_type,
          attempts,
          max_attempts,
          status,
          scheduled_at,
          last_error,
          created_at,
          updated_at
        FROM giftcard_jobs
        WHERE status = 'queued'
          AND attempts >= max_attempts
          AND stage = ${stage}
        ORDER BY scheduled_at ASC
      `
    } else {
      queuedFailedQuery = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
          trigger_type,
          attempts,
          max_attempts,
          status,
          scheduled_at,
          last_error,
          created_at,
          updated_at
        FROM giftcard_jobs
        WHERE status = 'queued'
          AND attempts >= max_attempts
        ORDER BY scheduled_at ASC
      `
    }
    
    const queuedFailedJobs = await queuedFailedQuery
    
    // 3. Find stuck running jobs (locked for > 5 minutes)
    let stuckJobsQuery
    if (stage) {
      stuckJobsQuery = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
          trigger_type,
          attempts,
          max_attempts,
          status,
          scheduled_at,
          locked_at,
          lock_owner,
          last_error,
          created_at,
          updated_at,
          EXTRACT(EPOCH FROM (NOW() - locked_at)) / 60 as minutes_locked
        FROM giftcard_jobs
        WHERE status = 'running'
          AND locked_at < NOW() - INTERVAL '5 minutes'
          AND stage = ${stage}
        ORDER BY locked_at ASC
      `
    } else {
      stuckJobsQuery = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
          trigger_type,
          attempts,
          max_attempts,
          status,
          scheduled_at,
          locked_at,
          lock_owner,
          last_error,
          created_at,
          updated_at,
          EXTRACT(EPOCH FROM (NOW() - locked_at)) / 60 as minutes_locked
        FROM giftcard_jobs
        WHERE status = 'running'
          AND locked_at < NOW() - INTERVAL '5 minutes'
        ORDER BY locked_at ASC
      `
    }
    
    const stuckJobs = await stuckJobsQuery
    
    const allJobs = [
      ...(errorJobs || []),
      ...(queuedFailedJobs || []),
      ...(stuckJobs || [])
    ]
    
    if (allJobs.length === 0) {
      console.log('✅ No errored or unfinished jobs found to requeue')
      return
    }
    
    // Group by status for reporting
    const byStatus = {
      error: errorJobs || [],
      queued_failed: queuedFailedJobs || [],
      stuck: stuckJobs || []
    }
    
    console.log(`📋 Found ${allJobs.length} job(s) to requeue:\n`)
    console.log(`   - ${byStatus.error.length} job(s) with status 'error'`)
    console.log(`   - ${byStatus.queued_failed.length} job(s) queued but exceeded max attempts`)
    console.log(`   - ${byStatus.stuck.length} job(s) stuck in 'running' status\n`)
    
    // Show details
    if (allJobs.length > 0) {
      console.log('📝 Job details:\n')
      allJobs.forEach((job, idx) => {
        const statusLabel = job.status === 'error' ? 'ERROR' : 
                           job.status === 'running' ? 'STUCK' : 
                           'QUEUED_FAILED'
        console.log(`  ${idx + 1}. [${statusLabel}] ${job.stage} (${job.trigger_type})`)
        console.log(`     Correlation ID: ${job.correlation_id}`)
        console.log(`     Attempts: ${job.attempts}/${job.max_attempts}`)
        if (job.locked_at) {
          const minutesLocked = Math.round(job.minutes_locked || 0)
          console.log(`     Locked: ${minutesLocked} minutes ago (${job.lock_owner || 'unknown'})`)
        }
        if (job.scheduled_at) {
          const scheduledAt = new Date(job.scheduled_at)
          const scheduledIn = Math.round((scheduledAt.getTime() - Date.now()) / (60 * 60 * 1000))
          console.log(`     Scheduled: ${scheduledIn > 0 ? `in ${scheduledIn}h` : `${Math.abs(scheduledIn)}h ago`}`)
        }
        if (job.last_error) {
          const errorPreview = job.last_error.length > 80 
            ? job.last_error.substring(0, 80) + '...' 
            : job.last_error
          console.log(`     Error: ${errorPreview}`)
        }
        console.log('')
      })
    }
    
    if (dryRun) {
      console.log('🔍 DRY RUN: No changes made. Remove --dry-run to actually requeue jobs.\n')
      return
    }
    
    console.log('🔄 Requeuing jobs for immediate processing...\n')
    
    // Update error jobs
    if (byStatus.error.length > 0) {
      let updateErrorQuery
      if (stage) {
        updateErrorQuery = prisma.$executeRaw`
          UPDATE giftcard_jobs
          SET 
            status = 'queued',
            scheduled_at = NOW(),
            attempts = 0,
            last_error = NULL,
            locked_at = NULL,
            lock_owner = NULL,
            updated_at = NOW()
          WHERE status = 'error'
            AND stage = ${stage}
        `
      } else {
        updateErrorQuery = prisma.$executeRaw`
          UPDATE giftcard_jobs
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
      await updateErrorQuery
      console.log(`   ✅ Requeued ${byStatus.error.length} error job(s)`)
    }
    
    // Update queued failed jobs
    if (byStatus.queued_failed.length > 0) {
      let updateQueuedQuery
      if (stage) {
        updateQueuedQuery = prisma.$executeRaw`
          UPDATE giftcard_jobs
          SET 
            status = 'queued',
            scheduled_at = NOW(),
            attempts = 0,
            last_error = NULL,
            updated_at = NOW()
          WHERE status = 'queued'
            AND attempts >= max_attempts
            AND stage = ${stage}
        `
      } else {
        updateQueuedQuery = prisma.$executeRaw`
          UPDATE giftcard_jobs
          SET 
            status = 'queued',
            scheduled_at = NOW(),
            attempts = 0,
            last_error = NULL,
            updated_at = NOW()
          WHERE status = 'queued'
            AND attempts >= max_attempts
        `
      }
      await updateQueuedQuery
      console.log(`   ✅ Requeued ${byStatus.queued_failed.length} queued failed job(s)`)
    }
    
    // Update stuck running jobs
    if (byStatus.stuck.length > 0) {
      let updateStuckQuery
      if (stage) {
        updateStuckQuery = prisma.$executeRaw`
          UPDATE giftcard_jobs
          SET 
            status = 'queued',
            scheduled_at = NOW(),
            attempts = 0,
            last_error = NULL,
            locked_at = NULL,
            lock_owner = NULL,
            updated_at = NOW()
          WHERE status = 'running'
            AND locked_at < NOW() - INTERVAL '5 minutes'
            AND stage = ${stage}
        `
      } else {
        updateStuckQuery = prisma.$executeRaw`
          UPDATE giftcard_jobs
          SET 
            status = 'queued',
            scheduled_at = NOW(),
            attempts = 0,
            last_error = NULL,
            locked_at = NULL,
            lock_owner = NULL,
            updated_at = NOW()
          WHERE status = 'running'
            AND locked_at < NOW() - INTERVAL '5 minutes'
        `
      }
      await updateStuckQuery
      console.log(`   ✅ Requeued ${byStatus.stuck.length} stuck job(s)`)
    }
    
    console.log(`\n✅ Successfully requeued ${allJobs.length} job(s) for immediate processing`)
    console.log(`   They will be processed on the next cron run (every minute)\n`)
    
  } catch (error) {
    console.error('❌ Error requeuing jobs:', error)
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
  if (arg === '--stage' && args[idx + 1]) {
    options.stage = args[idx + 1]
  }
})

requeueAllErroredJobs(options).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})



