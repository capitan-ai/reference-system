/**
 * Comprehensive Analytics Dashboard
 * Returns all KPI data: appointments, cancellations, revenue
 * 
 * GET /api/admin/analytics/dashboard?organizationId=xxx&startDate=2026-02-01&endDate=2026-02-28&locationId=yyy
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

    // Build WHERE clause for dates
    let dateFilter = ''
    if (startDate && endDate) {
      dateFilter = `AND date BETWEEN '${startDate}'::date AND '${endDate}'::date`
    } else if (startDate) {
      dateFilter = `AND date >= '${startDate}'::date`
    } else if (endDate) {
      dateFilter = `AND date <= '${endDate}'::date`
    }

    let locationFilter = ''
    if (locationId) {
      locationFilter = `AND location_id = '${locationId}'::uuid`
    }

    // Get appointments data (ACCEPTED only for KPI)
    const appointmentsData = await prisma.$queryRawUnsafe(`
      SELECT 
        date,
        location_name,
        appointments_count as accepted_appointments,
        cancelled_appointments,
        no_show_appointments,
        unique_customers,
        new_customers
      FROM analytics_appointments_by_location_daily
      WHERE organization_id = '${organizationId}'::uuid
        ${dateFilter}
        ${locationFilter}
      ORDER BY date DESC, location_name
    `)

    // Get revenue data
    const revenueData = await prisma.$queryRawUnsafe(`
      SELECT 
        date,
        location_name,
        revenue_cents,
        revenue_dollars,
        payment_count,
        unique_customers
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = '${organizationId}'::uuid
        ${dateFilter}
        ${locationFilter}
      ORDER BY date DESC, location_name
    `)

    // Calculate totals
    let appointmentsTotals = {
      total_accepted: 0,
      total_cancelled: 0,
      total_no_shows: 0,
      unique_customers: 0,
      new_customers: 0
    }

    appointmentsData.forEach(record => {
      appointmentsTotals.total_accepted += Number(record.accepted_appointments || 0)
      appointmentsTotals.total_cancelled += Number(record.cancelled_appointments || 0)
      appointmentsTotals.total_no_shows += Number(record.no_show_appointments || 0)
      appointmentsTotals.unique_customers += Number(record.unique_customers || 0)
      appointmentsTotals.new_customers += Number(record.new_customers || 0)
    })

    let revenueTotals = {
      total_revenue_cents: 0,
      total_revenue_dollars: 0,
      total_payments: 0,
      unique_customers: 0,
      average_transaction: 0
    }

    revenueData.forEach(record => {
      revenueTotals.total_revenue_cents += Number(record.revenue_cents || 0)
      revenueTotals.total_revenue_dollars += Number(record.revenue_dollars || 0)
      revenueTotals.total_payments += Number(record.payment_count || 0)
      revenueTotals.unique_customers += Number(record.unique_customers || 0)
    })

    if (revenueTotals.total_payments > 0) {
      revenueTotals.average_transaction = revenueTotals.total_revenue_cents / revenueTotals.total_payments
    }

    // Build combined daily data
    const dailyData = {}
    
    appointmentsData.forEach(record => {
      const key = `${record.date}-${record.location_name}`
      if (!dailyData[key]) {
        dailyData[key] = {
          date: record.date,
          location: record.location_name,
          appointments: { accepted: 0, cancelled: 0, no_show: 0, unique_customers: 0 },
          revenue: { dollars: 0, payments: 0 }
        }
      }
      dailyData[key].appointments.accepted = Number(record.accepted_appointments || 0)
      dailyData[key].appointments.cancelled = Number(record.cancelled_appointments || 0)
      dailyData[key].appointments.no_show = Number(record.no_show_appointments || 0)
      dailyData[key].appointments.unique_customers = Number(record.unique_customers || 0)
    })

    revenueData.forEach(record => {
      const key = `${record.date}-${record.location_name}`
      if (!dailyData[key]) {
        dailyData[key] = {
          date: record.date,
          location: record.location_name,
          appointments: { accepted: 0, cancelled: 0, no_show: 0 },
          revenue: { dollars: 0, payments: 0 }
        }
      }
      dailyData[key].revenue.dollars = Number(record.revenue_dollars || 0)
      dailyData[key].revenue.payments = Number(record.payment_count || 0)
    })

    const combinedDaily = Object.values(dailyData)

    return Response.json({
      filters: {
        organizationId,
        startDate: startDate || null,
        endDate: endDate || null,
        locationId: locationId || null
      },
      kpis: {
        appointments: {
          accepted: appointmentsTotals.total_accepted,
          cancelled: appointmentsTotals.total_cancelled,
          no_show: appointmentsTotals.total_no_shows,
          unique_customers: appointmentsTotals.unique_customers,
          new_customers: appointmentsTotals.new_customers
        },
        revenue: {
          total_dollars: Number(revenueTotals.total_revenue_dollars.toFixed(2)),
          total_payments: revenueTotals.total_payments,
          average_transaction: Number((revenueTotals.average_transaction / 100).toFixed(2)),
          unique_customers: revenueTotals.unique_customers
        }
      },
      daily: combinedDaily.sort((a, b) => new Date(b.date) - new Date(a.date))
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

