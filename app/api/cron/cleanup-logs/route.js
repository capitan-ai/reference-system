import prisma from '@/lib/prisma-client'
import { logInfo, logError } from '@/lib/observability/logger'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    // Delete logs older than 30 days
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const deleted = await prisma.$executeRaw`
      DELETE FROM "application_logs" 
      WHERE "created_at" < ${thirtyDaysAgo}
    `

    logInfo('cleanup.logs.success', { deletedCount: deleted })
    
    return Response.json({ 
      success: true, 
      message: `Deleted ${deleted} old log entries.` 
    })
  } catch (error) {
    logError('cleanup.logs.error', { error: error.message })
    return Response.json({ success: false, error: error.message }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

