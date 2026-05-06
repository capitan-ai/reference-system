#!/usr/bin/env node
/**
 * Requeue failed giftcard jobs for immediate retry
 * 
 * This script resets failed jobs (that have exceeded maxAttempts) 
 * to be processed immediately instead of waiting for scheduled_at
 * 
 * Usage:
 *   node scripts/requeue-failed-jobs.js                    # Requeue all failed jobs
 *   node scripts/requeue-failed-jobs.js --stage payment    # Requeue only payment stage
 *   node scripts/requeue-failed-jobs.js --hours 6          # Requeue jobs scheduled more than 6 hours ago
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { Prisma } = require('@prisma/client')

async function requeueFailedJobs(options = {}) {
  const { stage, hours } = options
  
  try {
    console.log('🔍 Finding failed jobs to requeue...\n')
    
    // Build query conditions
    let query
    if (stage && hours) {
      const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000)
      query = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
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
          AND scheduled_at <= ${hoursAgo}
        ORDER BY scheduled_at ASC
      `
    } else if (stage) {
      query = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
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
    } else if (hours) {
      const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000)
      query = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
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
          AND scheduled_at <= ${hoursAgo}
        ORDER BY scheduled_at ASC
      `
    } else {
      query = prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
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
    
    const failedJobs = await query
    
    if (!failedJobs || failedJobs.length === 0) {
      console.log('✅ No failed jobs found to requeue')
      return
    }
    
    console.log(`📋 Found ${failedJobs.length} failed job(s):\n`)
    
    failedJobs.forEach((job, idx) => {
      const scheduledAt = job.scheduled_at ? new Date(job.scheduled_at) : null
      const scheduledIn = scheduledAt ? Math.round((scheduledAt.getTime() - Date.now()) / (60 * 60 * 1000)) : null
      console.log(`  ${idx + 1}. ${job.stage} (${job.correlation_id})`)
      console.log(`     Attempts: ${job.attempts}/${job.max_attempts}`)
      if (scheduledIn !== null) {
        console.log(`     Scheduled: ${scheduledIn > 0 ? `in ${scheduledIn}h` : `${Math.abs(scheduledIn)}h ago`}`)
      }
      if (job.last_error) {
        const errorPreview = job.last_error.length > 60 
          ? job.last_error.substring(0, 60) + '...' 
          : job.last_error
        console.log(`     Error: ${errorPreview}`)
      }
      console.log('')
    })
    
    console.log('🔄 Requeuing jobs for immediate processing...\n')
    
    // Build UPDATE query with same conditions
    let updateQuery
    if (stage && hours) {
      const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000)
      updateQuery = prisma.$executeRaw`
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
          AND scheduled_at <= ${hoursAgo}
      `
    } else if (stage) {
      updateQuery = prisma.$executeRaw`
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
    } else if (hours) {
      const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000)
      updateQuery = prisma.$executeRaw`
        UPDATE giftcard_jobs
        SET 
          status = 'queued',
          scheduled_at = NOW(),
          attempts = 0,
          last_error = NULL,
          updated_at = NOW()
        WHERE status = 'queued'
          AND attempts >= max_attempts
          AND scheduled_at <= ${hoursAgo}
      `
    } else {
      updateQuery = prisma.$executeRaw`
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
    
    const result = await updateQuery
    
    console.log(`✅ Requeued ${failedJobs.length} job(s) for immediate processing`)
    console.log(`   They will be processed on the next cron run\n`)
    
  } catch (error) {
    console.error('❌ Error requeuing failed jobs:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Parse command line arguments
const args = process.argv.slice(2)
const options = {}

args.forEach((arg, idx) => {
  if (arg === '--stage' && args[idx + 1]) {
    options.stage = args[idx + 1]
  }
  if (arg === '--hours' && args[idx + 1]) {
    options.hours = parseInt(args[idx + 1], 10)
  }
})

requeueFailedJobs(options).catch(console.error)

