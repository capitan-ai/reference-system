/**
 * Get Current User Endpoint
 * Returns authenticated user with their organizations
 * Super admin sees all organizations
 */

import { getUserFromRequest, isSuperAdmin } from '../../../../lib/auth/check-access'
import { prisma } from '../../../../lib/prisma-client'

// Force dynamic rendering since we use request.headers
export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    // Get user from token
    const user = await getUserFromRequest(request)
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if super admin
    const userIsSuperAdmin = await isSuperAdmin(user.id)

    if (userIsSuperAdmin) {
      // Super admin - return all organizations
      const allOrganizations = await prisma.organization.findMany({
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
              square_existing_clients: true
            }
          }
        },
        orderBy: {
          created_at: 'desc'
        }
      })

      return Response.json({
        user: {
          id: user.id,
          email: user.email,
          is_super_admin: true,
          organizations: allOrganizations.map(org => ({
            organization_id: org.id,
            role: 'super_admin',
            organization: {
              id: org.id,
              square_merchant_id: org.square_merchant_id,
              locations: org.locations,
              stats: {
                bookings: org._count.bookings,
                payments: org._count.payments,
                customers: org._count.square_existing_clients
              }
            }
          }))
        }
      })
    }

    // Regular user - get their organizations
    const organizationUsers = await prisma.organizationUser.findMany({
      where: { user_id: user.id },
      include: {
        organization: {
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
            }
          }
        }
      },
      orderBy: [
        { is_primary: 'desc' }, // Primary organization first
        { created_at: 'asc' }
      ]
    })

    // Find primary organization
    const primaryOrg = organizationUsers.find(ou => ou.is_primary) || organizationUsers[0]

    return Response.json({
      user: {
        id: user.id,
        email: user.email,
        is_super_admin: false,
        primary_organization: primaryOrg ? {
          organization_id: primaryOrg.organization_id,
          role: primaryOrg.role,
          is_primary: primaryOrg.is_primary,
          organization: {
            id: primaryOrg.organization.id,
            square_merchant_id: primaryOrg.organization.square_merchant_id,
            locations: primaryOrg.organization.locations
          }
        } : null,
        organizations: organizationUsers.map(ou => ({
          organization_id: ou.organization_id,
          role: ou.role,
          is_primary: ou.is_primary,
          organization: {
            id: ou.organization.id,
            square_merchant_id: ou.organization.square_merchant_id,
            locations: ou.organization.locations
          }
        }))
      }
    })

  } catch (error) {
    console.error('Get user error:', error)
    return Response.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

