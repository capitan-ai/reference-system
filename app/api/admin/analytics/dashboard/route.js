/**
 * Comprehensive Analytics Dashboard
 * Returns all KPI data: appointments, cancellations, revenue
 * 
 * GET /api/admin/analytics/dashboard?organizationId=xxx&startDate=2026-02-01&endDate=2026-02-28&locationId=yyy
 */

export const dynamic = 'force-dynamic'

import prisma from '@/lib/prisma-client'
import { checkOrganizationAccess } from '@/lib/auth/check-access'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')

    if (!organizationId) {
      return Response.json({ error: 'organizationId is required' }, { status: 400 })
    }

    const access = await checkOrganizationAccess(request, organizationId)
    if (!access) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Build parameterized queries
    // --- Appointments query ---
    let apptQuery = `
      SELECT
        date, location_name,
        appointments_count as accepted_appointments,
        cancelled_appointments, no_show_appointments,
        unique_customers, new_customers
      FROM analytics_appointments_by_location_daily
      WHERE organization_id = $1::uuid
    `
    const apptParams = [organizationId]

    if (startDate) {
      apptQuery += ` AND date >= $${apptParams.length + 1}::date`
      apptParams.push(startDate)
    }
    if (endDate) {
      apptQuery += ` AND date <= $${apptParams.length + 1}::date`
      apptParams.push(endDate)
    }
    if (locationId) {
      apptQuery += ` AND location_id = $${apptParams.length + 1}::uuid`
      apptParams.push(locationId)
    }
    apptQuery += ` ORDER BY date DESC, location_name`

    const appointmentsData = await prisma.$queryRawUnsafe(apptQuery, ...apptParams)

    // --- Revenue query ---
    let revQuery = `
      SELECT
        date, location_name,
        revenue_cents, revenue_dollars,
        payment_count, unique_customers
      FROM analytics_revenue_by_location_daily
      WHERE organization_id = $1::uuid
    `
    const revParams = [organizationId]

    if (startDate) {
      revQuery += ` AND date >= $${revParams.length + 1}::date`
      revParams.push(startDate)
    }
    if (endDate) {
      revQuery += ` AND date <= $${revParams.length + 1}::date`
      revParams.push(endDate)
    }
    if (locationId) {
      revQuery += ` AND location_id = $${revParams.length + 1}::uuid`
      revParams.push(locationId)
    }
    revQuery += ` ORDER BY date DESC, location_name`

    const revenueData = await prisma.$queryRawUnsafe(revQuery, ...revParams)

    // --- Unique customers query ---
    let ucQuery = `
      SELECT COUNT(DISTINCT ca.square_customer_id)::int as unique_customers_period
      FROM customer_analytics ca
      WHERE ca.organization_id = $1::uuid
        AND ca.first_visit_at IS NOT NULL
    `
    const ucParams = [organizationId]

    if (startDate) {
      ucQuery += ` AND DATE(ca.first_visit_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') >= $${ucParams.length + 1}::date`
      ucParams.push(startDate)
    }
    if (endDate) {
      ucQuery += ` AND DATE(ca.first_visit_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') <= $${ucParams.length + 1}::date`
      ucParams.push(endDate)
    }
    if (locationId) {
      ucQuery += ` AND EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = ca.square_customer_id
        AND b.organization_id = ca.organization_id
        AND b.location_id = $${ucParams.length + 1}::uuid
      )`
      ucParams.push(locationId)
    }

    const uniqueCustomersResult = await prisma.$queryRawUnsafe(ucQuery, ...ucParams)
    const uniqueCustomersPeriod = uniqueCustomersResult[0]?.unique_customers_period || 0

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
      // unique_customers теперь берется из customer_analytics, не суммируем здесь
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
      // unique_customers теперь берется из customer_analytics, не суммируем здесь
    })

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

    // Calculate average ticket: Total Revenue / Total Payments
    if (revenueTotals.total_payments > 0) {
      revenueTotals.average_transaction = revenueTotals.total_revenue_dollars / revenueTotals.total_payments
    }

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
          unique_customers: uniqueCustomersPeriod,  // Используем точный подсчет из customer_analytics
          new_customers: appointmentsTotals.new_customers
        },
        revenue: {
          total_dollars: Number(revenueTotals.total_revenue_dollars.toFixed(2)),
          total_payments: revenueTotals.total_payments,
          average_transaction: Number(revenueTotals.average_transaction.toFixed(2)),
          unique_customers: uniqueCustomersPeriod  // Используем точный подсчет из customer_analytics
        }
      },
      daily: combinedDaily.sort((a, b) => new Date(b.date) - new Date(a.date))
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

