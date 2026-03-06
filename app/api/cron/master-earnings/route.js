import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { PrismaClient } = require('@prisma/client')
const { processMasterEarnings } = require('../../../../lib/workers/master-earnings-worker')
const { refreshMasterPerformance } = require('../../../../scripts/refresh-master-performance')

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function authorize(request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.warn('⚠️ CRON_SECRET not set - allowing unauthenticated access (development only)')
    return { authorized: true, method: 'no-secret-set' }
  }

  const authHeader = request.headers.get('Authorization') || ''
  const cronHeader = request.headers.get('x-cron-secret') || request.headers.get('x-cron-key') || ''
  const userAgent = request.headers.get('user-agent') || ''
  
  if (authHeader === `Bearer ${cronSecret}` || authHeader === cronSecret) {
    return { authorized: true, method: 'vercel-cron-auth-header' }
  }

  if (cronHeader === cronSecret) {
    return { authorized: true, method: 'vercel-cron-header' }
  }

  const isVercelRequest = 
    userAgent.includes('vercel-cron') || 
    userAgent.includes('vercel') ||
    userAgent.toLowerCase().includes('vercel') ||
    (!userAgent || userAgent.length === 0)
  
  if (isVercelRequest) {
    return { authorized: true, method: 'vercel-cron-user-agent' }
  }

  return { authorized: false, reason: 'no-matching-secret', method: 'unknown' }
}

async function handle(request) {
  const auth = authorize(request)
  if (!auth.authorized) {
    return json({ error: 'Unauthorized', reason: auth.reason }, 401)
  }
  
  const prisma = new PrismaClient()

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
      await refreshMasterPerformance(org.id)
      results.push({ orgId: org.id, status: 'success' })
    }

    return json({ success: true, results })
  } catch (error) {
    console.error('[CRON-EARNINGS] ❌ Master Earnings failed:', error.message)
    return json({ success: false, error: error.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST(request) {
  return handle(request)
}

export async function GET(request) {
  return handle(request)
}

