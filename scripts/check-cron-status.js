#!/usr/bin/env node
/**
 * Check cron job status and configuration
 * Verifies:
 * - Cron endpoint is accessible
 * - Vercel cron configuration
 * - Job queue status
 * - Recent cron activity
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkCronStatus() {
  console.log('🔍 Checking Cron Job Status\n')
  console.log('='.repeat(80))
  
  try {
    // 1. Check configuration
    console.log('\n1️⃣ Configuration:')
    const cronSecret = process.env.CRON_SECRET
    const jobsPerRun = Number(process.env.GIFTCARD_JOBS_PER_CRON_RUN) || 10
    const cronUrl = process.env.NEXT_PUBLIC_APP_URL 
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/cron/giftcard-jobs`
      : 'https://zorinastudio-referral.com/api/cron/giftcard-jobs'
    
    console.log(`   Cron URL: ${cronUrl}`)
    console.log(`   CRON_SECRET: ${cronSecret ? '✅ Set' : '❌ Not set (WARNING: Allows unauthenticated access)'}`)
    console.log(`   Jobs per run: ${jobsPerRun}`)
    console.log(`   Schedule: Every minute (* * * * *)`)
    
    // 2. Check vercel.json configuration
    console.log('\n2️⃣ Vercel Configuration:')
    try {
      const fs = require('fs')
      const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'))
      const cronConfig = vercelConfig.crons || []
      console.log(`   Cron jobs configured: ${cronConfig.length}`)
      cronConfig.forEach((cron, idx) => {
        console.log(`   ${idx + 1}. Path: ${cron.path}`)
        console.log(`      Schedule: ${cron.schedule}`)
      })
    } catch (error) {
      console.log(`   ⚠️  Could not read vercel.json: ${error.message}`)
    }
    
    // 3. Check job queue status
    console.log('\n3️⃣ Job Queue Status:')
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
    
    console.log(`   Queued: ${queued}`)
    console.log(`   Running: ${running}`)
    console.log(`   Completed: ${completed}`)
    console.log(`   Error: ${error}`)
    console.log(`   Total: ${queued + running + completed + error}`)
    
    // 4. Check ready jobs (scheduled_at <= NOW())
    console.log('\n4️⃣ Ready Jobs (scheduled_at <= NOW()):')
    const readyJobs = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as count
      FROM giftcard_jobs
      WHERE status = 'queued'
        AND scheduled_at <= NOW()
    `
    const readyCount = Number(readyJobs[0].count)
    console.log(`   Ready to process: ${readyCount}`)
    
    if (readyCount > 0) {
      console.log(`   ⚠️  ${readyCount} job(s) are ready but not processed`)
      console.log(`   💡 Cron job may not be running or failing`)
    } else {
      console.log(`   ✅ No jobs waiting to be processed`)
    }
    
    // 5. Check recent cron activity (jobs processed in last 5 minutes)
    console.log('\n5️⃣ Recent Activity (last 5 minutes):')
    const recentActivity = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '5 minutes') as recent_count,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '1 hour') as hour_count,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '24 hours') as day_count
      FROM giftcard_jobs
      WHERE status = 'completed'
    `
    const recent = Number(recentActivity[0].recent_count)
    const hour = Number(recentActivity[0].hour_count)
    const day = Number(recentActivity[0].day_count)
    
    console.log(`   Completed in last 5 min: ${recent}`)
    console.log(`   Completed in last hour: ${hour}`)
    console.log(`   Completed in last 24 hours: ${day}`)
    
    if (recent === 0 && readyCount > 0) {
      console.log(`   ⚠️  No jobs processed recently but ${readyCount} jobs are ready!`)
      console.log(`   💡 Cron job may be down or failing`)
    } else if (recent > 0) {
      console.log(`   ✅ Cron job appears to be working`)
    }
    
    // 6. Check stuck jobs
    console.log('\n6️⃣ Stuck Jobs (running > 5 minutes):')
    const stuckJobs = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as count
      FROM giftcard_jobs
      WHERE status = 'running'
        AND locked_at < NOW() - INTERVAL '5 minutes'
    `
    const stuckCount = Number(stuckJobs[0].count)
    console.log(`   Stuck: ${stuckCount}`)
    
    if (stuckCount > 0) {
      console.log(`   ⚠️  ${stuckCount} job(s) are stuck`)
      console.log(`   💡 Run: node scripts/unlock-stuck-jobs.js`)
    }
    
    // 7. Check upcoming jobs
    console.log('\n7️⃣ Upcoming Jobs (scheduled_at > NOW()):')
    const upcomingJobs = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as count,
        MIN(scheduled_at) as next_scheduled
      FROM giftcard_jobs
      WHERE status = 'queued'
        AND scheduled_at > NOW()
    `
    const upcomingCount = Number(upcomingJobs[0].count)
    const nextScheduled = upcomingJobs[0].next_scheduled
    
    console.log(`   Upcoming: ${upcomingCount}`)
    if (nextScheduled) {
      const nextDate = new Date(nextScheduled)
      const now = new Date()
      const minutesUntil = Math.round((nextDate - now) / 1000 / 60)
      console.log(`   Next job: ${nextDate.toISOString()} (in ${minutesUntil} minutes)`)
    }
    
    // 8. Manual test command
    console.log('\n8️⃣ Manual Test:')
    if (cronSecret) {
      console.log(`   Test cron endpoint:`)
      console.log(`   curl -X GET "${cronUrl}" -H "Authorization: Bearer ${cronSecret}"`)
    } else {
      console.log(`   ⚠️  CRON_SECRET not set - endpoint allows unauthenticated access`)
      console.log(`   Test cron endpoint:`)
      console.log(`   curl -X GET "${cronUrl}"`)
    }
    
    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('📊 SUMMARY')
    console.log('='.repeat(80))
    
    const issues = []
    if (!cronSecret) {
      issues.push('❌ CRON_SECRET not set (security risk)')
    }
    if (readyCount > 0 && recent === 0) {
      issues.push(`⚠️  ${readyCount} jobs ready but not being processed`)
    }
    if (stuckCount > 0) {
      issues.push(`⚠️  ${stuckCount} stuck jobs need to be unlocked`)
    }
    if (readyCount === 0 && recent === 0 && day === 0 && queued === 0) {
      issues.push('ℹ️  No recent activity - this is normal if no new jobs are created')
    }
    
    if (issues.length > 0) {
      console.log('\n⚠️  Issues found:')
      issues.forEach(issue => console.log(`   ${issue}`))
    } else {
      console.log('\n✅ No issues detected')
    }
    
    if (readyCount > 0) {
      console.log('\n💡 Recommendations:')
      console.log('   1. Check Vercel cron job logs')
      console.log('   2. Verify CRON_SECRET is set in Vercel environment variables')
      console.log('   3. Test the cron endpoint manually (see command above)')
      console.log('   4. Check if cron endpoint is returning errors')
    }
    
    console.log('\n')
    
  } catch (error) {
    console.error('❌ Error checking cron status:', error)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkCronStatus()



