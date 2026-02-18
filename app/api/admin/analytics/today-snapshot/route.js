/**
 * Today's Snapshot API
 * Returns appointments and cancellations for today
 * 
 * GET /api/admin/analytics/today-snapshot?organizationId=xxx&locationId=yyy
 */

export const dynamic = 'force-dynamic'

import { PrismaClient } from '@prisma/client'
import { getUserFromRequest } from '@/lib/auth/check-access'

const prisma = new PrismaClient()

export async function GET(request) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    const locationId = searchParams.get('locationId')

    if (!organizationId) {
      return Response.json({ error: 'organizationId is required' }, { status: 400 })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Build query conditions
    const whereConditions = {
      organization_id: organizationId,
      start_at: {
        gte: today,
        lt: tomorrow
      }
    }

    if (locationId) {
      whereConditions.location_id = locationId
    }

    // Get today's appointments (ACCEPTED status)
    const appointmentsToday = await prisma.booking.count({
      where: {
        ...whereConditions,
        status: 'ACCEPTED'
      }
    })

    // Get today's cancellations (CANCELLED_BY_CUSTOMER, CANCELLED_BY_SELLER, NO_SHOW)
    const cancellationsToday = await prisma.booking.count({
      where: {
        ...whereConditions,
        status: {
          in: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'NO_SHOW']
        }
      }
    })

    // Get cancellations by type
    const cancellationDetails = await prisma.booking.groupBy({
      by: ['status'],
      where: {
        ...whereConditions,
        status: {
          in: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'NO_SHOW']
        }
      },
      _count: true
    })

    const cancellationBreakdown = {
      cancelled_by_customer: 0,
      cancelled_by_seller: 0,
      no_show: 0
    }

    cancellationDetails.forEach(detail => {
      if (detail.status === 'CANCELLED_BY_CUSTOMER') {
        cancellationBreakdown.cancelled_by_customer = detail._count
      } else if (detail.status === 'CANCELLED_BY_SELLER') {
        cancellationBreakdown.cancelled_by_seller = detail._count
      } else if (detail.status === 'NO_SHOW') {
        cancellationBreakdown.no_show = detail._count
      }
    })

    // Get revenue for today
    const today_date = today.toISOString().split('T')[0]
    const revenueToday = await prisma.$queryRaw`
      SELECT 
        SUM(revenue_dollars) as total_revenue,
        SUM(payment_count) as total_payments,
        COUNT(*) as location_records
      FROM analytics_revenue_by_location_daily
      WHERE DATE(date) = ${today_date}::date
        AND organization_id = ${organizationId}::uuid
        ${locationId ? `AND location_id = ${locationId}::uuid` : ''}
    `

    const revenue = revenueToday[0]

    return Response.json({
      date: today.toISOString().split('T')[0],
      appointments: {
        accepted: appointmentsToday,
        total: appointmentsToday
      },
      cancellations: {
        total: cancellationsToday,
        by_customer: cancellationBreakdown.cancelled_by_customer,
        by_seller: cancellationBreakdown.cancelled_by_seller,
        no_show: cancellationBreakdown.no_show
      },
      revenue: {
        total_dollars: Number(revenue?.total_revenue || 0),
        total_payments: Number(revenue?.total_payments || 0)
      }
    })
  } catch (error) {
    console.error('Today snapshot error:', error)
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

