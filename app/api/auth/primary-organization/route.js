/**
 * Update Primary Organization Endpoint
 * Allows user to change their primary organization
 */

import { checkOrganizationAccess } from '../../../../lib/auth/check-access'
import { prisma } from '../../../../lib/prisma-client'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const body = await request.json()
    const { organizationId } = body

    if (!organizationId) {
      return Response.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Check if user has access to this organization
    const access = await checkOrganizationAccess(request, organizationId, ['owner', 'admin', 'viewer'])
    if (!access) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Update: set this organization as primary, unset others
    await prisma.$transaction(async (tx) => {
      // Unset all primary organizations for this user
      await tx.organizationUser.updateMany({
        where: {
          user_id: access.user.id,
          is_primary: true
        },
        data: {
          is_primary: false
        }
      })

      // Set this organization as primary
      await tx.organizationUser.update({
        where: {
          user_id_organization_id: {
            user_id: access.user.id,
            organization_id: organizationId
          }
        },
        data: {
          is_primary: true
        }
      })
    })

    return Response.json({
      success: true,
      message: 'Primary organization updated'
    })

  } catch (error) {
    console.error('Update primary org error:', error)
    return Response.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}



