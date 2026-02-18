/**
 * KPI Dashboard with Period Comparison
 * Returns 4 main KPIs: Appointments, Cancelled, No-Show, Revenue
 * Each with comparison to previous period
 * 
 * GET /api/admin/analytics/kpi?organizationId=xxx&startDate=2026-02-01&endDate=2026-02-28&locationId=yyy
 */

export const dynamic = 'force-dynamic'

import { PrismaClient } from '@prisma/client'
import { getUserFromRequest } from '@/lib/auth/check-access'

const prisma = new PrismaClient()

function calculatePeriodDates(startDate, endDate) {
  const start = new Date(startDate)
  const end = new Date(endDate)
  
  // Calculate period length
  const periodLength = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1
  
  // Previous period
  const prevEnd = new Date(start)
  prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - periodLength + 1)
  
  return {
    current: {
      start: startDate,
      end: endDate
    },
    previous: {
      start: prevStart.toISOString().split('T')[0],
      end: prevEnd.toISOString().split('T')[0]
    }
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) {
    return current > 0 ? 100 : 0
  }
  return ((current - previous) / previous * 100).toFixed(1)
}

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

    // If no dates provided, default to current month
    let currentStart = startDate
    let currentEnd = endDate
    
    if (!currentStart || !currentEnd) {
      const today = new Date()
      currentEnd = today.toISOString().split('T')[0]
      currentStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    }

    // Calculate previous period
    const periods = calculatePeriodDates(currentStart, currentEnd)
    
    let locationFilter = ''
    if (locationId) {
      locationFilter = `AND location_id = '${locationId}'::uuid`
    }

    // Get current period data
    const currentData = await prisma.$queryRawUnsafe(`
      SELECT 
        SUM(appointments_count)::int as total_appointments,
        SUM(cancelled_appointments)::int as total_cancelled,
        SUM(no_show_appointments)::int as total_no_show
      FROM analytics_appointments_by_location_daily
      WHERE organization_id = '${organizationId}'::uuid
        AND date BETWEEN '${periods.current.start}'::date AND '${periods.current.end}'::date
        ${locationFilter}
    `)

    const currentRevenue = await prisma.$queryRawUnsafe(`
      SELECT 
        SUM(revenue_dollars)::numeric as total_revenue,
        SUM(payment_count)::int as total_payments
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = '${organizationId}'::uuid
        AND date BETWEEN '${periods.current.start}'::date AND '${periods.current.end}'::date
        ${locationFilter}
    `)

    // Get previous period data
    const previousData = await prisma.$queryRawUnsafe(`
      SELECT 
        SUM(appointments_count)::int as total_appointments,
        SUM(cancelled_appointments)::int as total_cancelled,
        SUM(no_show_appointments)::int as total_no_show
      FROM analytics_appointments_by_location_daily
      WHERE organization_id = '${organizationId}'::uuid
        AND date BETWEEN '${periods.previous.start}'::date AND '${periods.previous.end}'::date
        ${locationFilter}
    `)

    const previousRevenue = await prisma.$queryRawUnsafe(`
      SELECT 
        SUM(revenue_dollars)::numeric as total_revenue,
        SUM(payment_count)::int as total_payments
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = '${organizationId}'::uuid
        AND date BETWEEN '${periods.previous.start}'::date AND '${periods.previous.end}'::date
        ${locationFilter}
    `)

    // Extract values with defaults
    const currAppts = currentData[0]?.total_appointments || 0
    const currCancelled = currentData[0]?.total_cancelled || 0
    const currNoShow = currentData[0]?.total_no_show || 0
    const currRevenue = Number(currentRevenue[0]?.total_revenue || 0)
    const currPayments = currentRevenue[0]?.total_payments || 0

    const prevAppts = previousData[0]?.total_appointments || 0
    const prevCancelled = previousData[0]?.total_cancelled || 0
    const prevNoShow = previousData[0]?.total_no_show || 0
    const prevRevenue = Number(previousRevenue[0]?.total_revenue || 0)
    const prevPayments = previousRevenue[0]?.total_payments || 0

    // Calculate changes
    const appointmentsChange = calculatePercentageChange(currAppts, prevAppts)
    const cancelledChange = calculatePercentageChange(currCancelled, prevCancelled)
    const noShowChange = calculatePercentageChange(currNoShow, prevNoShow)
    const revenueChange = calculatePercentageChange(currRevenue, prevRevenue)

    return Response.json({
      periods: {
        current: periods.current,
        previous: periods.previous
      },
      kpis: {
        appointments: {
          label: 'Appointments',
          current: currAppts,
          previous: prevAppts,
          change_percent: parseFloat(appointmentsChange),
          change_direction: currAppts >= prevAppts ? 'up' : 'down'
        },
        cancelled: {
          label: 'Cancelled',
          current: currCancelled,
          previous: prevCancelled,
          change_percent: parseFloat(cancelledChange),
          change_direction: currCancelled >= prevCancelled ? 'up' : 'down'
        },
        no_show: {
          label: 'No-Show',
          current: currNoShow,
          previous: prevNoShow,
          change_percent: parseFloat(noShowChange),
          change_direction: currNoShow >= prevNoShow ? 'up' : 'down'
        },
        revenue: {
          label: 'Revenue',
          current: currRevenue,
          current_formatted: `$${currRevenue.toFixed(2)}`,
          previous: prevRevenue,
          previous_formatted: `$${prevRevenue.toFixed(2)}`,
          change_percent: parseFloat(revenueChange),
          change_direction: currRevenue >= prevRevenue ? 'up' : 'down',
          payments: currPayments,
          average_transaction: currPayments > 0 ? (currRevenue / currPayments).toFixed(2) : 0
        }
      },
      summary: {
        period_label: `${periods.current.start} to ${periods.current.end}`,
        period_days: Math.floor((new Date(periods.current.end) - new Date(periods.current.start)) / (1000 * 60 * 60 * 24)) + 1,
        locations: locationId ? 1 : 'All'
      }
    })
  } catch (error) {
    console.error('KPI error:', error)
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

