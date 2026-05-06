import { createRequire } from 'module'
import prisma from '@/lib/prisma-client'
import { authorizeCron } from '@/lib/auth/cron-auth'

const require = createRequire(import.meta.url)
const { processMasterEarnings } = require('@/lib/workers/master-earnings-worker')
const { processDiscountAdjustments } = require('@/lib/workers/discount-engine-worker')
const { refreshMasterPerformance } = require('@/scripts/refresh-master-performance')

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

async function handle(request) {
  const auth = authorizeCron(request)
  if (!auth.authorized) {
    return json({ error: 'Unauthorized' }, 401)
  }
  
  try {
    const organizations = await prisma.organization.findMany({
      where: { is_active: true },
      select: { id: true }
    })

    console.log(`[CRON-EARNINGS] Found ${organizations.length} organizations to process.`)

    const results = []
    for (const org of organizations) {
      console.log(`[CRON-EARNINGS] Processing org: ${org.id}`)
      await processMasterEarnings(org.id)
      await processDiscountAdjustments(org.id)
      await refreshMasterPerformance(org.id)
      results.push({ orgId: org.id, status: 'success' })
    }

    return json({ success: true, results })
  } catch (error) {
    console.error('[CRON-EARNINGS] ❌ Master Earnings failed:', error.message)
    return json({ success: false, error: 'Internal server error' }, 500)
  }
}

export async function POST(request) {
  return handle(request)
}

export async function GET(request) {
  return handle(request)
}

