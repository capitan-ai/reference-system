#!/usr/bin/env node
/**
 * Check status of queued gift card jobs
 * Shows:
 * - Jobs by status (queued, running, completed, error)
 * - Recent jobs
 * - Jobs stuck in running state
 * - Cron job status
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkQueuedJobs() {
  console.log('📊 Checking Gift Card Job Queue Status\n')
  
  try {
    // Check if table exists
    try {
      await prisma.$queryRaw`SELECT 1 FROM "giftcard_jobs" WHERE 1 = 0 LIMIT 1`
    } catch (error) {
      if (error.message?.includes('does not exist')) {
        console.log('❌ giftcard_jobs table does not exist!')
        console.log('   Run: npx prisma migrate deploy')
        process.exit(1)
      }
      throw error
    }

    // 1. Get job counts by status
    console.log('1️⃣ Job Status Summary:')
    const statusCounts = await prisma.$queryRaw`
      SELECT 
        status,
        COUNT(*) as count
      FROM giftcard_jobs
      GROUP BY status
      ORDER BY status
    `
    
    const counts = {}
    statusCounts.forEach(row => {
      counts[row.status] = Number(row.count)
    })
    
    const queued = counts.queued || 0
    const running = counts.running || 0
    const completed = counts.completed || 0
    const error = counts.error || 0
    
    console.log(`   ✅ Queued: ${queued}`)
    console.log(`   ⏳ Running: ${running}`)
    console.log(`   ✅ Completed: ${completed}`)
    console.log(`   ❌ Error: ${error}`)
    console.log(`   📊 Total: ${queued + running + completed + error}`)
    
    // 2. Check for stuck jobs (running for more than 5 minutes)
    console.log('\n2️⃣ Stuck Jobs (running > 5 minutes):')
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
      LIMIT 10
    `
    
    if (stuckJobs.length === 0) {
      console.log('   ✅ No stuck jobs found')
    } else {
      console.log(`   ⚠️  Found ${stuckJobs.length} stuck job(s):`)
      stuckJobs.forEach((job, idx) => {
        console.log(`\n   ${idx + 1}. Job ID: ${job.id}`)
        console.log(`      Correlation ID: ${job.correlation_id}`)
        console.log(`      Stage: ${job.stage}`)
        console.log(`      Trigger: ${job.trigger_type}`)
        console.log(`      Attempts: ${job.attempts}`)
        console.log(`      Running for: ${Math.round(job.minutes_running)} minutes`)
        console.log(`      Locked at: ${job.locked_at}`)
      })
    }
    
    // 3. Recent queued jobs
    console.log('\n3️⃣ Recent Queued Jobs (last 10):')
    const recentQueued = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        stage,
        trigger_type,
        status,
        attempts,
        scheduled_at,
        created_at
      FROM giftcard_jobs
      WHERE status = 'queued'
      ORDER BY scheduled_at ASC, created_at ASC
      LIMIT 10
    `
    
    if (recentQueued.length === 0) {
      console.log('   ℹ️  No queued jobs')
    } else {
      recentQueued.forEach((job, idx) => {
        const scheduledAt = new Date(job.scheduled_at)
        const now = new Date()
        const delay = scheduledAt < now ? 'READY' : `in ${Math.round((scheduledAt - now) / 1000)}s`
        
        console.log(`\n   ${idx + 1}. ${job.stage} (${job.trigger_type})`)
        console.log(`      Correlation ID: ${job.correlation_id}`)
        console.log(`      Attempts: ${job.attempts}`)
        console.log(`      Scheduled: ${scheduledAt.toISOString()} (${delay})`)
      })
    }
    
    // 4. Recent completed jobs
    console.log('\n4️⃣ Recent Completed Jobs (last 5):')
    const recentCompleted = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        stage,
        trigger_type,
        attempts,
        updated_at
      FROM giftcard_jobs
      WHERE status = 'completed'
      ORDER BY updated_at DESC
      LIMIT 5
    `
    
    if (recentCompleted.length === 0) {
      console.log('   ℹ️  No completed jobs yet')
    } else {
      recentCompleted.forEach((job, idx) => {
        const completedAt = new Date(job.updated_at)
        const ago = Math.round((Date.now() - completedAt.getTime()) / 1000)
        console.log(`\n   ${idx + 1}. ${job.stage} (${job.trigger_type})`)
        console.log(`      Correlation ID: ${job.correlation_id}`)
        console.log(`      Attempts: ${job.attempts}`)
        console.log(`      Completed: ${ago}s ago`)
      })
    }
    
    // 5. Recent errors
    console.log('\n5️⃣ Recent Errors (last 5):')
    const recentErrors = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        stage,
        trigger_type,
        attempts,
        last_error,
        updated_at
      FROM giftcard_jobs
      WHERE status = 'error'
      ORDER BY updated_at DESC
      LIMIT 5
    `
    
    if (recentErrors.length === 0) {
      console.log('   ✅ No errors')
    } else {
      recentErrors.forEach((job, idx) => {
        const errorAt = new Date(job.updated_at)
        const ago = Math.round((Date.now() - errorAt.getTime()) / 1000)
        console.log(`\n   ${idx + 1}. ${job.stage} (${job.trigger_type})`)
        console.log(`      Correlation ID: ${job.correlation_id}`)
        console.log(`      Attempts: ${job.attempts}`)
        console.log(`      Error: ${(job.last_error || 'N/A').substring(0, 100)}`)
        console.log(`      Failed: ${ago}s ago`)
      })
    }
    
    // 6. Check cron job configuration
    console.log('\n6️⃣ Cron Job Configuration:')
    const cronUrl = process.env.NEXT_PUBLIC_APP_URL 
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/cron/giftcard-jobs`
      : 'https://zorinastudio-referral.com/api/cron/giftcard-jobs'
    
    console.log(`   Endpoint: ${cronUrl}`)
    console.log(`   Schedule: Every minute (* * * * *)`)
    console.log(`   CRON_SECRET: ${process.env.CRON_SECRET ? '✅ Set' : '❌ Not set'}`)
    
    // 7. Summary and recommendations
    console.log('\n' + '='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    
    if (queued > 0) {
      console.log(`⚠️  ${queued} job(s) waiting in queue`)
      console.log('   💡 Cron job should process them automatically')
    } else {
      console.log('✅ No jobs in queue')
    }
    
    if (running > 0) {
      console.log(`⏳ ${running} job(s) currently running`)
    }
    
    if (stuckJobs.length > 0) {
      console.log(`❌ ${stuckJobs.length} job(s) appear to be stuck`)
      console.log('   💡 These jobs may need manual intervention')
    }
    
    if (error > 0) {
      console.log(`❌ ${error} job(s) failed`)
      console.log('   💡 Check error messages above for details')
    }
    
    console.log('\n💡 To manually trigger job processing:')
    console.log(`   curl -X POST "${cronUrl}" -H "Authorization: Bearer ${process.env.CRON_SECRET || 'YOUR_SECRET'}"`)
    
  } catch (error) {
    console.error('\n❌ Error checking jobs:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkQueuedJobs()





