#!/usr/bin/env node
/**
 * Retry unfinished gift card jobs
 * 
 * This script finds and retries:
 * 1. Failed jobs (status = 'error')
 * 2. Stuck jobs (status = 'running' for more than 5 minutes)
 * 3. Jobs that exceeded max attempts but are still queued
 * 
 * Usage:
 *   node scripts/retry-unfinished-jobs.js              # Retry all unfinished jobs
 *   node scripts/retry-unfinished-jobs.js --stuck-only # Only retry stuck jobs
 *   node scripts/retry-unfinished-jobs.js --failed-only # Only retry failed jobs
 */

require('dotenv').config({ path: '.env.local' })
require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function retryUnfinishedJobs(options = {}) {
  const { stuckOnly = false, failedOnly = false } = options
  
  try {
    console.log('🔍 Finding unfinished jobs...\n')
    
    let totalRetried = 0
    
    // 1. Find failed jobs (status = 'error')
    if (!stuckOnly) {
      console.log('1️⃣ Checking for failed jobs (status = error)...')
      const failedJobs = await prisma.$queryRaw`
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
        LIMIT 100
      `
      
      if (!failedJobs || failedJobs.length === 0) {
        console.log('   ✅ No failed jobs found\n')
      } else {
        console.log(`   📋 Found ${failedJobs.length} failed job(s):\n`)
        
        failedJobs.forEach((job, idx) => {
          console.log(`   ${idx + 1}. ${job.stage} (${job.correlation_id})`)
          console.log(`      Job ID: ${job.id}`)
          console.log(`      Attempts: ${job.attempts}/${job.max_attempts}`)
          if (job.last_error) {
            const errorPreview = job.last_error.length > 80 
              ? job.last_error.substring(0, 80) + '...' 
              : job.last_error
            console.log(`      Error: ${errorPreview}`)
          }
          console.log('')
        })
        
        if (!failedOnly) {
          // Reset failed jobs to queued
          const failedResult = await prisma.$executeRaw`
            UPDATE giftcard_jobs
            SET 
              status = 'queued',
              scheduled_at = NOW(),
              attempts = 0,
              locked_at = NULL,
              lock_owner = NULL,
              last_error = NULL,
              updated_at = NOW()
            WHERE status = 'error'
          `
          console.log(`   ✅ Reset ${failedJobs.length} failed job(s) to queued status\n`)
          totalRetried += failedJobs.length
        }
      }
    }
    
    // 2. Find stuck jobs (status = 'running' for more than 5 minutes)
    if (!failedOnly) {
      console.log('2️⃣ Checking for stuck jobs (running > 5 minutes)...')
      const stuckJobs = await prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
          trigger_type,
          attempts,
          locked_at,
          EXTRACT(EPOCH FROM (NOW() - locked_at)) / 60 as minutes_running
        FROM giftcard_jobs
        WHERE status = 'running'
          AND locked_at < NOW() - INTERVAL '5 minutes'
        ORDER BY locked_at ASC
        LIMIT 100
      `
      
      if (!stuckJobs || stuckJobs.length === 0) {
        console.log('   ✅ No stuck jobs found\n')
      } else {
        console.log(`   📋 Found ${stuckJobs.length} stuck job(s):\n`)
        
        stuckJobs.forEach((job, idx) => {
          console.log(`   ${idx + 1}. ${job.stage} (${job.correlation_id})`)
          console.log(`      Job ID: ${job.id}`)
          console.log(`      Attempts: ${job.attempts}`)
          console.log(`      Stuck for: ${Math.round(job.minutes_running)} minutes`)
          console.log(`      Locked at: ${job.locked_at}`)
          console.log('')
        })
        
        // Reset stuck jobs to queued
        const stuckResult = await prisma.$executeRaw`
          UPDATE giftcard_jobs
          SET 
            status = 'queued',
            scheduled_at = NOW(),
            locked_at = NULL,
            lock_owner = NULL,
            last_error = NULL,
            updated_at = NOW()
          WHERE status = 'running'
            AND locked_at < NOW() - INTERVAL '5 minutes'
        `
        console.log(`   ✅ Reset ${stuckJobs.length} stuck job(s) to queued status\n`)
        totalRetried += stuckJobs.length
      }
    }
    
    // 3. Find jobs that exceeded max attempts but are still queued
    if (!stuckOnly && !failedOnly) {
      console.log('3️⃣ Checking for jobs that exceeded max attempts...')
      const exceededJobs = await prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          stage,
          trigger_type,
          attempts,
          max_attempts,
          scheduled_at
        FROM giftcard_jobs
        WHERE status = 'queued'
          AND attempts >= max_attempts
          AND scheduled_at > NOW()
        ORDER BY scheduled_at ASC
        LIMIT 100
      `
      
      if (!exceededJobs || exceededJobs.length === 0) {
        console.log('   ✅ No jobs that exceeded max attempts found\n')
      } else {
        console.log(`   📋 Found ${exceededJobs.length} job(s) that exceeded max attempts:\n`)
        
        exceededJobs.forEach((job, idx) => {
          console.log(`   ${idx + 1}. ${job.stage} (${job.correlation_id})`)
          console.log(`      Attempts: ${job.attempts}/${job.max_attempts}`)
          console.log(`      Scheduled at: ${job.scheduled_at}`)
          console.log('')
        })
        
        // Reset these jobs to retry immediately
        const exceededResult = await prisma.$executeRaw`
          UPDATE giftcard_jobs
          SET 
            status = 'queued',
            scheduled_at = NOW(),
            attempts = 0,
            last_error = NULL,
            updated_at = NOW()
          WHERE status = 'queued'
            AND attempts >= max_attempts
            AND scheduled_at > NOW()
        `
        console.log(`   ✅ Reset ${exceededJobs.length} job(s) for immediate retry\n`)
        totalRetried += exceededJobs.length
      }
    }
    
    console.log(`\n${'='.repeat(60)}`)
    console.log(`✅ Summary: Retried ${totalRetried} unfinished job(s)`)
    console.log(`${'='.repeat(60)}\n`)
    
    if (totalRetried > 0) {
      console.log('ℹ️  These jobs will be processed on the next cron run')
      console.log('   Or run manually: node scripts/giftcard-worker.js\n')
    }
    
  } catch (error) {
    console.error('❌ Error retrying unfinished jobs:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Parse command line arguments
const args = process.argv.slice(2)
const options = {}

args.forEach(arg => {
  if (arg === '--stuck-only') options.stuckOnly = true
  if (arg === '--failed-only') options.failedOnly = true
})

retryUnfinishedJobs(options).catch(console.error)

