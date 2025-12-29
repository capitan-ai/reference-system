#!/usr/bin/env node
/**
 * Check why giftcard jobs are stuck in queued status
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkJobStatus() {
  console.log('🔍 Checking GiftCard Job Processing Status\n')
  
  const fifteenDaysAgo = new Date()
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15)

  try {
    // Check job statuses
    console.log('1️⃣ Checking giftcard_jobs status breakdown...')
    
    const jobStatuses = await prisma.$queryRaw`
      SELECT 
        status,
        trigger_type,
        COUNT(*)::bigint AS count,
        MIN(created_at) AS oldest,
        MAX(created_at) AS newest
      FROM giftcard_jobs
      WHERE created_at >= ${fifteenDaysAgo}
      GROUP BY status, trigger_type
      ORDER BY status, trigger_type
    `

    console.log('\n   Job Status Summary:')
    jobStatuses.forEach(row => {
      console.log(`   ${row.status} (${row.trigger_type}): ${row.count} jobs`)
      console.log(`      Oldest: ${row.oldest}`)
      console.log(`      Newest: ${row.newest}`)
    })

    // Check queued jobs in detail
    console.log('\n2️⃣ Checking queued jobs (customer.created)...')
    
    const queuedJobs = await prisma.giftCardJob.findMany({
      where: {
        status: 'queued',
        trigger_type: 'customer.created',
        created_at: { gte: fifteenDaysAgo }
      },
      orderBy: { created_at: 'asc' },
      take: 10,
      select: {
        id: true,
        correlation_id: true,
        stage: true,
        status: true,
        attempts: true,
        max_attempts: true,
        scheduled_at: true,
        locked_at: true,
        lock_owner: true,
        last_error: true,
        created_at: true
      }
    })

    console.log(`   Found ${queuedJobs.length} queued jobs (showing first 10)`)
    
    if (queuedJobs.length > 0) {
      console.log('\n   Sample Queued Jobs:')
      queuedJobs.forEach((job, idx) => {
        console.log(`\n   ${idx + 1}. Created: ${job.created_at.toISOString()}`)
        console.log(`      Scheduled: ${job.scheduled_at.toISOString()}`)
        console.log(`      Stage: ${job.stage}`)
        console.log(`      Attempts: ${job.attempts}/${job.max_attempts}`)
        console.log(`      Locked: ${job.locked_at ? job.locked_at.toISOString() : 'No'}`)
        console.log(`      Lock Owner: ${job.lock_owner || 'None'}`)
        if (job.last_error) {
          console.log(`      Last Error: ${job.last_error.substring(0, 100)}`)
        }
      })
    }

    // Check for errors
    console.log('\n3️⃣ Checking jobs with errors...')
    
    const errorJobs = await prisma.giftCardJob.findMany({
      where: {
        status: 'error',
        created_at: { gte: fifteenDaysAgo }
      },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: {
        id: true,
        trigger_type: true,
        stage: true,
        attempts: true,
        last_error: true,
        created_at: true
      }
    })

    console.log(`   Found ${errorJobs.length} jobs with errors`)
    if (errorJobs.length > 0) {
      errorJobs.forEach((job, idx) => {
        console.log(`\n   ${idx + 1}. ${job.trigger_type} - ${job.stage}`)
        console.log(`      Attempts: ${job.attempts}`)
        console.log(`      Error: ${job.last_error?.substring(0, 200) || 'No error message'}`)
        console.log(`      Created: ${job.created_at.toISOString()}`)
      })
    }

    // Check giftcard_runs status
    console.log('\n4️⃣ Checking giftcard_runs status...')
    
    const runStatuses = await prisma.$queryRaw`
      SELECT 
        status,
        COUNT(*)::bigint AS count
      FROM giftcard_runs
      WHERE created_at >= ${fifteenDaysAgo}
      GROUP BY status
      ORDER BY status
    `

    console.log('\n   Run Status Summary:')
    runStatuses.forEach(row => {
      console.log(`   ${row.status}: ${row.count} runs`)
    })

    // Check if cron is configured
    console.log('\n5️⃣ Checking cron configuration...')
    console.log(`   GIFTCARD_WORKER_CRON_KEY: ${process.env.GIFTCARD_WORKER_CRON_KEY ? '✅ Set' : '❌ Not set'}`)
    console.log(`   ENABLE_REFERRAL_ANALYTICS: ${process.env.ENABLE_REFERRAL_ANALYTICS || 'Not set'}`)

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 DIAGNOSIS')
    console.log('='.repeat(60))
    
    const totalQueued = jobStatuses.find(r => r.status === 'queued')?.count || 0
    const totalRunning = jobStatuses.find(r => r.status === 'running')?.count || 0
    const totalCompleted = jobStatuses.find(r => r.status === 'completed')?.count || 0
    const totalError = jobStatuses.find(r => r.status === 'error')?.count || 0

    console.log(`\nTotal Jobs (last 15 days):`)
    console.log(`  Queued: ${totalQueued}`)
    console.log(`  Running: ${totalRunning}`)
    console.log(`  Completed: ${totalCompleted}`)
    console.log(`  Error: ${totalError}`)

    if (totalQueued > 0 && totalRunning === 0) {
      console.log(`\n⚠️  ISSUE DETECTED:`)
      console.log(`   Jobs are queued but nothing is processing them!`)
      console.log(`   Possible causes:`)
      console.log(`   1. Cron job not running (/api/cron/giftcard-jobs)`)
      console.log(`   2. Cron job not configured in Vercel`)
      console.log(`   3. Worker script not running`)
      console.log(`   4. Jobs are locked but worker crashed`)
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkJobStatus()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

