/**
 * User Registration Endpoint
 * Creates Supabase Auth user and links to organization
 */

import { createClient } from '@supabase/supabase-js'
import { prisma } from '../../../../lib/prisma-client'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Create Supabase client with service role for admin operations
const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    // Check if Supabase is configured
    if (!supabaseAdmin) {
      return Response.json(
        { error: 'Supabase not configured. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY' },
        { status: 500 }
      )
    }

    const body = await request.json()
    const { email, password, organizationName, squareMerchantId } = body

    // Validate input
    if (!email || !password || !organizationName || !squareMerchantId) {
      return Response.json(
        { error: 'Missing required fields: email, password, organizationName, squareMerchantId' },
        { status: 400 }
      )
    }

    // 1. Create Supabase Auth user with timeout handling
    let authData, authError
    try {
      // Add timeout wrapper for Supabase Auth calls
      const authPromise = supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true // Auto-confirm email
      })
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Supabase Auth service timeout - service may be unavailable')), 10000)
      )
      
      const result = await Promise.race([authPromise, timeoutPromise])
      authData = result.data
      authError = result.error
    } catch (error) {
      // Handle timeout or network errors
      if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        console.error('Supabase Auth service unavailable:', error.message)
        return Response.json({ 
          error: 'Authentication service is currently unavailable. Please try again in a few minutes.',
          details: 'Supabase Auth service may be recovering from maintenance. Check Supabase dashboard for service status.'
        }, { status: 503 })
      }
      throw error
    }

    if (authError) {
      console.error('Auth error:', authError)
      // Provide helpful error messages for common issues
      if (authError.message?.includes('timeout') || authError.status === 522) {
        return Response.json({ 
          error: 'Authentication service timeout. The service may be temporarily unavailable.',
          details: 'Please check Supabase dashboard for service status and try again in a few minutes.'
        }, { status: 503 })
      }
      return Response.json({ error: authError.message }, { status: 400 })
    }

    const userId = authData.user.id

    // 2. Find or create organization by square_merchant_id
    let organization = await prisma.organization.findUnique({
      where: { square_merchant_id: squareMerchantId },
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
    })

    if (!organization) {
      // Create new organization
      organization = await prisma.organization.create({
        data: {
          square_merchant_id: squareMerchantId,
        },
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
      })
    }

    // 3. Check if user already has any organization
    const existingUserOrgs = await prisma.organizationUser.findMany({
      where: { user_id: userId }
    })

    // 4. Determine role and primary status
    const isFirstUserInOrg = await prisma.organizationUser.count({
      where: { organization_id: organization.id }
    }) === 0

    const role = isFirstUserInOrg ? 'owner' : 'viewer'
    // First organization for this user is always primary
    const isPrimary = existingUserOrgs.length === 0

    // 5. Create organization_user record
    const organizationUser = await prisma.organizationUser.create({
      data: {
        user_id: userId,
        organization_id: organization.id,
        role: role,
        is_primary: isPrimary
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

    return Response.json({
      success: true,
      user: {
        id: userId,
        email: authData.user.email,
        role: role,
        is_primary: isPrimary,
        organization: {
          id: organization.id,
          square_merchant_id: organization.square_merchant_id,
          locations: organization.locations
        }
      }
    }, { status: 201 })

  } catch (error) {
    console.error('Signup error:', error)
    return Response.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}



