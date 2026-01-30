// Admin endpoint to view registration history
// GET /api/wallet/v1/admin/registrations?limit=50&deviceId=...&serialNumber=...

import prisma from '@/lib/prisma-client'

export async function GET(request) {
  try {
    // Optional auth check - set ADMIN_KEY env var to enable
    // If ADMIN_KEY is set, require it. Otherwise allow access (for development)
    if (process.env.ADMIN_KEY) {
      const adminKey = request.headers.get('x-admin-key')
      if (adminKey !== process.env.ADMIN_KEY) {
        return new Response('Unauthorized - Invalid admin key', { status: 401 })
      }
    } else {
      // In production, you should set ADMIN_KEY for security
      console.warn('⚠️ ADMIN_KEY not set - allowing unauthenticated access to registration history')
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const deviceId = searchParams.get('deviceId')
    const serialNumber = searchParams.get('serialNumber')
    const days = parseInt(searchParams.get('days') || '30')

    // Build where clause
    const where = {}
    if (deviceId) {
      where.deviceLibraryIdentifier = deviceId
    }
    if (serialNumber) {
      where.serialNumber = serialNumber
    }
    if (days) {
      const dateThreshold = new Date()
      dateThreshold.setDate(dateThreshold.getDate() - days)
      where.createdAt = {
        gte: dateThreshold
      }
    }

    // Get registrations
    const registrations = await prisma.devicePassRegistration.findMany({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      take: limit
    })

    // Get summary stats
    const total = await prisma.devicePassRegistration.count({ where })
    const byDate = {}
    registrations.forEach(r => {
      const date = r.createdAt.toISOString().split('T')[0]
      byDate[date] = (byDate[date] || 0) + 1
    })

    return new Response(JSON.stringify({
      total,
      count: registrations.length,
      registrations: registrations.map(r => ({
        deviceLibraryIdentifier: r.deviceLibraryIdentifier,
        serialNumber: r.serialNumber,
        customerName: r.customerName,
        customerEmail: r.customerEmail,
        squareCustomerId: r.squareCustomerId,
        giftCardGan: r.giftCardGan,
        giftCardId: r.giftCardId,
        balanceCents: r.balanceCents,
        hasPushToken: !!r.pushToken,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString()
      })),
      summary: {
        byDate: Object.entries(byDate).map(([date, count]) => ({ date, count }))
      }
    }, null, 2), {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (error) {
    console.error('Error fetching registrations:', error)
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    })
  }
}

