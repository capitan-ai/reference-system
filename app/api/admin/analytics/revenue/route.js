/**
 * Revenue KPI API
 * Returns revenue and payments by location and date
 * 
 * GET /api/admin/analytics/revenue?organizationId=xxx&startDate=2026-02-01&endDate=2026-02-28&locationId=yyy
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
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')

    if (!organizationId) {
      return Response.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Get data from analytics view
    let query = `
      SELECT 
        date,
        location_name,
        revenue_cents,
        revenue_dollars,
        payment_count,
        unique_customers
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = $1::uuid
    `

    const params = [organizationId]

    if (startDate) {
      query += ` AND date >= $${params.length + 1}::date`
      params.push(startDate)
    }

    if (endDate) {
      query += ` AND date <= $${params.length + 1}::date`
      params.push(endDate)
    }

    if (locationId) {
      query += ` AND location_id = $${params.length + 1}::uuid`
      params.push(locationId)
    }

    query += ` ORDER BY date DESC, location_name`

    const revenue = await prisma.$queryRawUnsafe(query, ...params)

    // Calculate totals
    const totals = {
      total_revenue_cents: 0,
      total_revenue_dollars: 0,
      total_payments: 0,
      unique_customers: 0,
      records: revenue.length,
      average_transaction: 0
    }

    revenue.forEach(record => {
      totals.total_revenue_cents += Number(record.revenue_cents || 0)
      totals.total_revenue_dollars += Number(record.revenue_dollars || 0)
      totals.total_payments += Number(record.payment_count || 0)
      totals.unique_customers += Number(record.unique_customers || 0)
    })

    if (totals.total_payments > 0) {
      totals.average_transaction = totals.total_revenue_cents / totals.total_payments
    }

    return Response.json({
      filters: {
        organizationId,
        startDate,
        endDate,
        locationId: locationId || null
      },
      revenue,
      totals: {
        ...totals,
        total_revenue_dollars: Number(totals.total_revenue_dollars.toFixed(2)),
        average_transaction: Number((totals.average_transaction / 100).toFixed(2))
      }
    })
  } catch (error) {
    console.error('Revenue KPI error:', error)
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

