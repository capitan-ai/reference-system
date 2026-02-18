/**
 * Appointments KPI API
 * Returns ACCEPTED appointments by location and date
 * 
 * GET /api/admin/analytics/appointments?organizationId=xxx&startDate=2026-02-01&endDate=2026-02-28&locationId=yyy
 */

export const dynamic = 'force-dynamic'

import { PrismaClient } from '@prisma/client'
import { getUserFromRequest } from '@/lib/auth-utils'

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
        appointments_count as accepted_appointments,
        cancelled_appointments,
        no_show_appointments,
        unique_customers,
        new_customers
      FROM analytics_appointments_by_location_daily
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

    const appointments = await prisma.$queryRawUnsafe(query, ...params)

    // Calculate totals
    const totals = {
      total_appointments: 0,
      total_cancellations: 0,
      total_no_shows: 0,
      unique_customers: 0,
      new_customers: 0,
      records: appointments.length
    }

    appointments.forEach(record => {
      totals.total_appointments += Number(record.accepted_appointments || 0)
      totals.total_cancellations += Number(record.cancelled_appointments || 0)
      totals.total_no_shows += Number(record.no_show_appointments || 0)
      totals.unique_customers += Number(record.unique_customers || 0)
      totals.new_customers += Number(record.new_customers || 0)
    })

    return Response.json({
      filters: {
        organizationId,
        startDate,
        endDate,
        locationId: locationId || null
      },
      appointments,
      totals
    })
  } catch (error) {
    console.error('Appointments KPI error:', error)
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

