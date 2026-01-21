#!/usr/bin/env node
/**
 * Unlock stuck jobs that have been running for too long
 * This will reset them back to queued status so they can be retried
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function unlockStuckJobs() {
  console.log('🔓 Unlocking Stuck Jobs\n')
  
  try {
    // Find stuck jobs (running > 5 minutes)
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
    `
    
    if (stuckJobs.length === 0) {
      console.log('✅ No stuck jobs found')
      await prisma.$disconnect()
      return
    }
    
    console.log(`Found ${stuckJobs.length} stuck job(s)\n`)
    
    // Ask for confirmation
    const readline = require('readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    const answer = await new Promise((resolve) => {
      rl.question(`Do you want to unlock ${stuckJobs.length} stuck job(s)? (yes/no): `, resolve)
    })
    rl.close()
    
    if (answer.toLowerCase() !== 'yes') {
      console.log('Cancelled')
      await prisma.$disconnect()
      return
    }
    
    // Unlock all stuck jobs
    console.log('\nUnlocking jobs...')
    const result = await prisma.$queryRaw`
      UPDATE giftcard_jobs
      SET
        status = 'queued',
        locked_at = NULL,
        lock_owner = NULL,
        scheduled_at = NOW(),
        updated_at = NOW()
      WHERE status = 'running'
        AND locked_at < NOW() - INTERVAL '5 minutes'
      RETURNING id, correlation_id, stage
    `
    
    console.log(`✅ Unlocked ${result.length} job(s)\n`)
    
    // Show summary
    console.log('Unlocked jobs:')
    result.forEach((job, idx) => {
      console.log(`  ${idx + 1}. ${job.stage} - ${job.correlation_id}`)
    })
    
    console.log('\n✅ Jobs are now back in queue and will be processed by cron job')
    
  } catch (error) {
    console.error('\n❌ Error unlocking jobs:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

unlockStuckJobs()



