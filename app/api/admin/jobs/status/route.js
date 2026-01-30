const prisma = require('../../../../../lib/prisma-client')

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    // Optional: Add admin auth here if needed
    // const adminKey = request.headers.get('x-admin-key')
    // if (process.env.ADMIN_KEY && adminKey !== process.env.ADMIN_KEY) {
    //   return Response.json({ error: 'Unauthorized' }, { status: 401 })
    // }

    // Check if table exists
    let tableExists = true
    try {
      await prisma.$queryRaw`SELECT 1 FROM "giftcard_jobs" WHERE 1 = 0 LIMIT 1`
    } catch (error) {
      if (error.message?.includes('does not exist')) {
        tableExists = false
      } else {
        throw error
      }
    }

    if (!tableExists) {
      return Response.json({
        success: false,
        error: 'giftcard_jobs table does not exist',
        tableExists: false
      })
    }

    // Get job counts by status
    const statusCounts = await prisma.$queryRaw`
      SELECT 
        status,
        COUNT(*)::int as count
      FROM giftcard_jobs
      GROUP BY status
      ORDER BY status
    `

    const counts = {}
    statusCounts.forEach(row => {
      counts[row.status] = Number(row.count)
    })

    // Get stuck jobs (running > 5 minutes)
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

    // Get recent queued jobs
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

    // Get recent completed jobs
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

    // Get recent errors
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

    return Response.json({
      success: true,
      tableExists: true,
      summary: {
        queued: counts.queued || 0,
        running: counts.running || 0,
        completed: counts.completed || 0,
        error: counts.error || 0,
        total: (counts.queued || 0) + (counts.running || 0) + (counts.completed || 0) + (counts.error || 0)
      },
      stuckJobs: stuckJobs.map(job => ({
        id: job.id,
        correlationId: job.correlation_id,
        stage: job.stage,
        triggerType: job.trigger_type,
        attempts: job.attempts,
        lockedAt: job.locked_at,
        minutesRunning: Math.round(job.minutes_running)
      })),
      recentQueued: recentQueued.map(job => ({
        id: job.id,
        correlationId: job.correlation_id,
        stage: job.stage,
        triggerType: job.trigger_type,
        attempts: job.attempts,
        scheduledAt: job.scheduled_at,
        createdAt: job.created_at
      })),
      recentCompleted: recentCompleted.map(job => ({
        id: job.id,
        correlationId: job.correlation_id,
        stage: job.stage,
        triggerType: job.trigger_type,
        attempts: job.attempts,
        completedAt: job.updated_at
      })),
      recentErrors: recentErrors.map(job => ({
        id: job.id,
        correlationId: job.correlation_id,
        stage: job.stage,
        triggerType: job.trigger_type,
        attempts: job.attempts,
        error: job.last_error,
        failedAt: job.updated_at
      })),
      cron: {
        endpoint: process.env.NEXT_PUBLIC_APP_URL 
          ? `${process.env.NEXT_PUBLIC_APP_URL}/api/cron/giftcard-jobs`
          : 'https://zorinastudio-referral.com/api/cron/giftcard-jobs',
        schedule: '* * * * *',
        hasSecret: !!process.env.CRON_SECRET
      }
    })
  } catch (error) {
    console.error('Error getting job status:', error)
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

