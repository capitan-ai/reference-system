import prisma from '../../../../lib/prisma-client'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  try {
    const { refCode } = params

    if (!refCode) {
      return Response.json({ error: 'Referral code is required' }, { status: 400 })
    }

    // Normalize the code (trim and uppercase)
    const normalizedCode = refCode.trim().toUpperCase()

    // Try to get organization_id from query parameter (if provided)
    const url = new URL(request.url)
    let organizationId = url.searchParams.get('organization_id') || url.searchParams.get('org')

    // First, try to find in referral_profiles table (newer normalized table)
    // This will give us the organization_id if not provided
    let referralProfile = await prisma.referralProfile.findFirst({
      where: {
        ...(organizationId ? { organization_id: organizationId } : {}),
        OR: [
          { personal_code: { equals: normalizedCode, mode: 'insensitive' } },
          { referral_code: { equals: normalizedCode, mode: 'insensitive' } }
        ]
      },
      include: {
        customer: {
          ...(organizationId ? { where: { organization_id: organizationId } } : {}),
          select: {
            square_customer_id: true,
            given_name: true,
            family_name: true,
            email_address: true
          }
        }
      }
    })

    // If we found a referral profile, use its organization_id for subsequent queries
    if (referralProfile && !organizationId) {
      organizationId = referralProfile.organization_id
    }

    if (referralProfile && referralProfile.customer) {
      const referrerName = `${referralProfile.customer.given_name || ''} ${referralProfile.customer.family_name || ''}`.trim() || null
      return Response.json({
        referrerName: referrerName,
        found: true,
        code: normalizedCode
      })
    }

    // Fallback to square_existing_clients for backward compatibility
    // Try normalized match first
    let referrer = await prisma.$queryRaw`
      SELECT 
        given_name,
        family_name,
        email_address,
        personal_code,
        square_customer_id,
        organization_id
      FROM square_existing_clients
      WHERE UPPER(TRIM(personal_code)) = ${normalizedCode}
        ${organizationId ? Prisma.sql`AND organization_id = ${organizationId}::uuid` : Prisma.sql``}
      LIMIT 1
    `

    // If we found a referrer, use its organization_id for consistency
    if (referrer && referrer.length > 0 && !organizationId) {
      organizationId = referrer[0].organization_id
    }

    // If not found, try exact match (case-sensitive)
    if (!referrer || referrer.length === 0) {
      referrer = await prisma.$queryRaw`
        SELECT 
          given_name,
          family_name,
          email_address,
          personal_code,
          square_customer_id,
          organization_id
        FROM square_existing_clients
        WHERE personal_code = ${refCode}
          ${organizationId ? Prisma.sql`AND organization_id = ${organizationId}::uuid` : Prisma.sql``}
        LIMIT 1
      `
      
      // If we found a referrer, use its organization_id for consistency
      if (referrer && referrer.length > 0 && !organizationId) {
        organizationId = referrer[0].organization_id
      }
    }

    if (!referrer || referrer.length === 0) {
      return Response.json({ 
        referrerName: null,
        found: false
      }, { status: 200 }) // Return 200 but with found: false so page can still show generic message
    }

    const customer = referrer[0]
    const referrerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || null

    return Response.json({
      referrerName: referrerName,
      found: true,
      code: refCode
    })

  } catch (error) {
    console.error('Error fetching referrer info:', error)
    return Response.json({ 
      error: 'Failed to fetch referrer information',
      referrerName: null,
      found: false
    }, { status: 500 })
  }
}
