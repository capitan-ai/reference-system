/**
 * Authentication and Authorization Helpers
 * For multi-tenant organization access control
 */

import { createClient } from '@supabase/supabase-js'
import { prisma } from '../prisma-client'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Check if user is super admin
 * @param {string} userId - Supabase Auth user ID
 * @returns {Promise<boolean>}
 */
export async function isSuperAdmin(userId) {
  try {
    const superAdmin = await prisma.organizationUser.findFirst({
      where: {
        user_id: userId,
        role: 'super_admin'
      }
    })
    return !!superAdmin
  } catch (error) {
    console.error('Check super admin error:', error)
    return false
  }
}

/**
 * Verify user token and check if they have access to organization
 * Super admin has access to all organizations
 * @param {Request} request - Next.js request object
 * @param {string} organizationId - Organization ID to check access for
 * @param {string[]} allowedRoles - Roles that have access (default: ['owner', 'admin', 'viewer'])
 * @returns {Promise<{user: object, organizationUser: object, isSuperAdmin: boolean} | null>}
 */
export async function checkOrganizationAccess(request, organizationId, allowedRoles = ['owner', 'admin', 'viewer']) {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('⚠️ Supabase credentials not configured')
      return null
    }

    // Get auth token
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null
    }

    const token = authHeader.replace('Bearer ', '')
    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // Verify token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return null
    }

    // Check if user is super admin
    const userIsSuperAdmin = await isSuperAdmin(user.id)
    
    if (userIsSuperAdmin) {
      // Super admin has access to all organizations
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
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
      })

      if (!organization) {
        return null
      }

      return {
        user,
        organizationUser: {
          role: 'super_admin',
          organization,
          is_super_admin: true
        },
        isSuperAdmin: true
      }
    }

    // Regular organization access check
    const organizationUser = await prisma.organizationUser.findUnique({
      where: {
        user_id_organization_id: {
          user_id: user.id,
          organization_id: organizationId
        }
      },
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
      }
    })

    if (!organizationUser) {
      return null
    }

    // Check role
    if (!allowedRoles.includes(organizationUser.role)) {
      return null
    }

    return {
      user,
      organizationUser,
      isSuperAdmin: false
    }

  } catch (error) {
    console.error('Check access error:', error)
    return null
  }
}

/**
 * Get user's primary organization
 * @param {string} userId - Supabase Auth user ID
 * @returns {Promise<object | null>}
 */
export async function getPrimaryOrganization(userId) {
  try {
    const primaryOrg = await prisma.organizationUser.findFirst({
      where: {
        user_id: userId,
        is_primary: true
      },
      include: {
        organization: {
          include: {
            locations: {
              select: {
                id: true,
                square_location_id: true,
                name: true,
                address_line_1: true,
                locality: true
              }
            }
          }
        }
      }
    })

    return primaryOrg
  } catch (error) {
    console.error('Get primary org error:', error)
    return null
  }
}

/**
 * Get user from request token
 * @param {Request} request - Next.js request object
 * @returns {Promise<object | null>}
 */
export async function getUserFromRequest(request) {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return null
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null
    }

    const token = authHeader.replace('Bearer ', '')
    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return null
    }

    return user
  } catch (error) {
    console.error('Get user from request error:', error)
    return null
  }
}

/**
 * Check if user is super admin (from request)
 * @param {Request} request - Next.js request object
 * @returns {Promise<boolean>}
 */
export async function isSuperAdminFromRequest(request) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return false
    return await isSuperAdmin(user.id)
  } catch (error) {
    console.error('Check super admin from request error:', error)
    return false
  }
}

