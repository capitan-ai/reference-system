import { createRequire } from 'module'
import prisma from '@/lib/prisma-client'
import { authorizeCron } from '@/lib/auth/cron-auth'

const require = createRequire(import.meta.url)
const { saveApplicationLog } = require('../../../../lib/workflows/application-log-queue')
const { refreshReferralAnalytics } = require('../../../../lib/analytics/referral-analytics-refresh')

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export async function GET(request) {
  const startTime = Date.now()
  console.log(`[CRON] Referral analytics refresh triggered at ${new Date().toISOString()}`)

  const auth = authorizeCron(request)
  if (!auth.authorized) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const url = new URL(request.url)
  const daysParam = url.searchParams.get('days')
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')

  const cronId = `cron-refresh-referral-analytics-${Date.now()}`
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (fromParam && !dateRegex.test(fromParam)) {
    return json({ error: 'Invalid date format for "from"' }, 400)
  }
  if (toParam && !dateRegex.test(toParam)) {
    return json({ error: 'Invalid date format for "to"' }, 400)
  }

  try {
    await saveApplicationLog(prisma, {
      logType: 'cron',
      logId: cronId,
      logCreatedAt: new Date(),
      payload: {
        cron_name: 'refresh-referral-analytics',
        worker_id: 'vercel-cron',
        triggered_at: new Date().toISOString(),
        params: { days: daysParam, from: fromParam, to: toParam },
      },
      status: 'processing',
    }).catch(() => {})

    let dateFrom, dateTo
    if (fromParam && toParam) {
      // fromParam/toParam validated above with dateRegex
      dateFrom = `'${fromParam} 00:00:00'`
      dateTo = `'${toParam}'::date + interval '1 day'`
    } else {
      const days = Math.min(Math.max(parseInt(daysParam || '35', 10) || 35, 1), 365)
      dateFrom = `NOW() - interval '${days} days'`
      dateTo = `NOW() + interval '1 day'`
    }

    const result = await refreshReferralAnalytics(prisma, dateFrom, dateTo)
    const duration = Date.now() - startTime

    console.log(`[CRON] Referral analytics: rows_written=${result.rowsWritten} duration_ms=${duration}`)

    await saveApplicationLog(prisma, {
      logType: 'cron',
      logId: cronId,
      logCreatedAt: new Date(),
      payload: {
        cron_name: 'refresh-referral-analytics',
        duration_ms: duration,
        rows_written: result.rowsWritten,
        status: 'success',
      },
      status: 'completed',
    }).catch(() => {})

    return json({ success: true, duration_ms: duration, rows_written: result.rowsWritten })
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[CRON] Error after ${duration}ms refreshing referral analytics:`, error.message)
    console.error(error.stack)

    await saveApplicationLog(prisma, {
      logType: 'cron',
      logId: cronId,
      logCreatedAt: new Date(),
      payload: {
        cron_name: 'refresh-referral-analytics',
        duration_ms: duration,
        error: error.message,
        stack: error.stack,
      },
      status: 'failed',
    }).catch(() => {})

    return json({ error: 'Internal server error', duration_ms: duration }, 500)
  }
}
