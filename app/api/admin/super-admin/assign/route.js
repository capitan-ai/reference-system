/**
 * Assign Super Admin Role
 * Only existing super admin can assign super admin to other users
 */

import { isSuperAdminFromRequest } from '../../../../../lib/auth/check-access'
import { prisma } from '../../../../../lib/prisma-client'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    // Only super admin can assign super admin
    const isSuperAdmin = await isSuperAdminFromRequest(request)
    if (!isSuperAdmin) {
      return Response.json(
        { error: 'Unauthorized. Super admin access required.' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { email } = body

    if (!email) {
      return Response.json({ error: 'email is required' }, { status: 400 })
    }

    // Check if Supabase is configured
    if (!supabaseUrl || !supabaseServiceKey) {
      return Response.json(
        { error: 'Supabase not configured. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY' },
        { status: 500 }
      )
    }

    // Find user by email in Supabase Auth
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
    const { data: { users }, error: findError } = await supabaseAdmin.auth.admin.listUsers()

    if (findError) {
      console.error('Find user error:', findError)
      return Response.json({ error: findError.message }, { status: 400 })
    }

    const user = users.find(u => u.email === email)
    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }

    // Check if user is already super admin
    const existingSuperAdmin = await prisma.organizationUser.findFirst({
      where: {
        user_id: user.id,
        role: 'super_admin'
      }
    })

    if (existingSuperAdmin) {
      return Response.json(
        { error: 'User is already super admin' },
        { status: 400 }
      )
    }

    // Create super admin record (organization_id = NULL)
    await prisma.organizationUser.create({
      data: {
        user_id: user.id,
        organization_id: null,
        role: 'super_admin',
        is_primary: false
      }
    })

    return Response.json({
      success: true,
      message: `User ${email} is now super admin`
    })

  } catch (error) {
    console.error('Assign super admin error:', error)
    return Response.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}



