/**
 * Get All Organizations (Super Admin Only)
 * Returns list of all organizations with statistics
 */

import { isSuperAdminFromRequest } from '../../../../lib/auth/check-access'
import { prisma } from '../../../../lib/prisma-client'

export async function GET(request) {
  try {
    // Only super admin can see all organizations
    const isSuperAdmin = await isSuperAdminFromRequest(request)
    if (!isSuperAdmin) {
      return Response.json(
        { error: 'Unauthorized. Super admin access required.' },
        { status: 403 }
      )
    }

    const organizations = await prisma.organization.findMany({
      include: {
        locations: {
          select: {
            id: true,
            square_location_id: true,
            name: true,
            address_line_1: true,
            locality: true,
            administrative_district_level_1: true,
            postal_code: true
          }
        },
        _count: {
          select: {
            bookings: true,
            payments: true,
            square_existing_clients: true,
            organization_users: true
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    })

    return Response.json({
      organizations: organizations.map(org => ({
        id: org.id,
        square_merchant_id: org.square_merchant_id,
        created_at: org.created_at,
        updated_at: org.updated_at,
        locations: org.locations,
        stats: {
          bookings: org._count.bookings,
          payments: org._count.payments,
          customers: org._count.square_existing_clients,
          users: org._count.organization_users
        }
      }))
    })

  } catch (error) {
    console.error('Get organizations error:', error)
    return Response.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

