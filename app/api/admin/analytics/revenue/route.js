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

    // Get revenue data from analytics view
    let revenueQuery = `
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
      revenueQuery += ` AND date >= $${params.length + 1}::date`
      params.push(startDate)
    }

    if (endDate) {
      revenueQuery += ` AND date <= $${params.length + 1}::date`
      params.push(endDate)
    }

    if (locationId) {
      revenueQuery += ` AND location_id = $${params.length + 1}::uuid`
      params.push(locationId)
    }

    revenueQuery += ` ORDER BY date DESC, location_name`

    const revenue = await prisma.$queryRawUnsafe(revenueQuery, ...params)

    // Get appointments data for weighted average calculation
    let appointmentsQuery = `
      SELECT 
        date,
        location_name,
        appointments_count as accepted_appointments
      FROM analytics_appointments_by_location_daily
      WHERE organization_id = $1::uuid
    `

    const appointmentParams = [organizationId]

    if (startDate) {
      appointmentsQuery += ` AND date >= $${appointmentParams.length + 1}::date`
      appointmentParams.push(startDate)
    }

    if (endDate) {
      appointmentsQuery += ` AND date <= $${appointmentParams.length + 1}::date`
      appointmentParams.push(endDate)
    }

    if (locationId) {
      appointmentsQuery += ` AND location_id = $${appointmentParams.length + 1}::uuid`
      appointmentParams.push(locationId)
    }

    appointmentsQuery += ` ORDER BY date DESC, location_name`

    const appointments = await prisma.$queryRawUnsafe(appointmentsQuery, ...appointmentParams)

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

    // Calculate weighted average ticket (weighted by appointments count)
    // Create a map of appointments by date and location for easy lookup
    const appointmentsByDay = {}
    appointments.forEach(record => {
      const key = `${record.date}-${record.location_name}`
      appointmentsByDay[key] = Number(record.accepted_appointments || 0)
    })

    // Calculate weighted ticket sum
    let weightedTicketSum = 0
    let totalAppointments = 0
    revenue.forEach(record => {
      const key = `${record.date}-${record.location_name}`
      const dayAppointments = appointmentsByDay[key] || 0
      const dayPayments = Number(record.payment_count || 0)
      const dayRevenue = Number(record.revenue_dollars || 0)

      if (dayPayments > 0 && dayAppointments > 0) {
        const dailyAvgTicket = dayRevenue / dayPayments
        weightedTicketSum += dailyAvgTicket * dayAppointments
      }
      totalAppointments += dayAppointments
    })

    if (totalAppointments > 0) {
      totals.average_transaction = (weightedTicketSum / totalAppointments) * 100 // convert to cents for consistency
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

