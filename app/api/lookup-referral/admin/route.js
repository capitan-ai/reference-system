import { NextResponse } from 'next/server'
import prisma from '../../../../lib/prisma-client'
import { generateReferralUrl } from '../../../../lib/utils/referral-url'
import { findCustomerByPhone, normalizePhoneNumber } from '../../../../lib/utils/phone-matching'

/**
 * Check if a phone number belongs to a team member
 */
async function isTeamMember(phoneNumber) {
  if (!phoneNumber) return false

  const normalized = normalizePhoneNumber(phoneNumber)
  if (!normalized) return false

  // Extract last 10 digits for matching
  const inputDigits = normalized.replace(/\D/g, '')
  const last10Digits = inputDigits.slice(-10)

  // Try exact match first
  let teamMember = await prisma.$queryRaw`
    SELECT id, square_team_member_id, given_name, family_name, phone_number, role, status
    FROM team_members
    WHERE phone_number = ${normalized}
       OR phone_number = ${normalized.replace(/^\+/, '')}
    LIMIT 1
  `

  // If no exact match, try matching by last 10 digits
  if (!teamMember || teamMember.length === 0) {
    const pattern1 = `%${last10Digits}`
    const pattern2 = `%${last10Digits.slice(0, 3)}%${last10Digits.slice(3, 6)}%${last10Digits.slice(6)}`
    const pattern3 = `%${last10Digits.slice(0, 3)})%${last10Digits.slice(3, 6)}-%${last10Digits.slice(6)}`

    const potentialMatches = await prisma.$queryRaw`
      SELECT id, square_team_member_id, given_name, family_name, phone_number, role, status
      FROM team_members
      WHERE (
        phone_number LIKE ${pattern1}
        OR phone_number LIKE ${pattern2}
        OR phone_number LIKE ${pattern3}
      )
      AND status = 'ACTIVE'
      LIMIT 5
    `

    // Filter to exact last 10 digit matches
    if (potentialMatches && potentialMatches.length > 0) {
      for (const match of potentialMatches) {
        if (!match.phone_number) continue
        const dbDigits = match.phone_number.replace(/\D/g, '')
        const dbLast10 = dbDigits.slice(-10)
        if (dbLast10 === last10Digits && dbLast10.length === 10) {
          teamMember = [match]
          break
        }
      }
    }
  }

  if (!teamMember || teamMember.length === 0) {
    return false
  }

  const member = teamMember[0]
  // Only allow active team members
  return member.status === 'ACTIVE'
}

/**
 * Find customer by name (for admin search)
 */
async function findCustomerByName(givenName, familyName) {
  if (!givenName && !familyName) {
    return null
  }

  const trimmedGiven = givenName ? givenName.trim() : ''
  const trimmedFamily = familyName ? familyName.trim() : ''

  let customers = []

  try {
    if (trimmedGiven && trimmedFamily) {
      const givenPattern = `%${trimmedGiven.toLowerCase()}%`
      const familyPattern = `%${trimmedFamily.toLowerCase()}%`
      customers = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          phone_number,
          personal_code,
          referral_url,
          given_name,
          family_name,
          email_address,
          updated_at
        FROM square_existing_clients
        WHERE LOWER(given_name) LIKE ${givenPattern}
          AND LOWER(family_name) LIKE ${familyPattern}
        ORDER BY updated_at DESC, square_customer_id DESC
        LIMIT 20
      `
    } else if (trimmedGiven) {
      const givenPattern = `%${trimmedGiven.toLowerCase()}%`
      customers = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          phone_number,
          personal_code,
          referral_url,
          given_name,
          family_name,
          email_address,
          updated_at
        FROM square_existing_clients
        WHERE LOWER(given_name) LIKE ${givenPattern}
        ORDER BY updated_at DESC, square_customer_id DESC
        LIMIT 20
      `
    } else if (trimmedFamily) {
      const familyPattern = `%${trimmedFamily.toLowerCase()}%`
      customers = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          phone_number,
          personal_code,
          referral_url,
          given_name,
          family_name,
          email_address,
          updated_at
        FROM square_existing_clients
        WHERE LOWER(family_name) LIKE ${familyPattern}
        ORDER BY updated_at DESC, square_customer_id DESC
        LIMIT 20
      `
    }
  } catch (error) {
    console.error('Error in findCustomerByName:', error)
    throw error
  }

  if (!customers || customers.length === 0) {
    return null
  }

  // Prioritize exact matches
  const sorted = customers.sort((a, b) => {
    const aGivenExact = trimmedGiven && a.given_name && 
                       a.given_name.toLowerCase() === trimmedGiven.toLowerCase()
    const aFamilyExact = trimmedFamily && a.family_name && 
                        a.family_name.toLowerCase() === trimmedFamily.toLowerCase()
    const bGivenExact = trimmedGiven && b.given_name && 
                       b.given_name.toLowerCase() === trimmedGiven.toLowerCase()
    const bFamilyExact = trimmedFamily && b.family_name && 
                        b.family_name.toLowerCase() === trimmedFamily.toLowerCase()

    const aExactBoth = trimmedGiven && trimmedFamily && aGivenExact && aFamilyExact
    const bExactBoth = trimmedGiven && trimmedFamily && bGivenExact && bFamilyExact

    if (aExactBoth && !bExactBoth) return -1
    if (!aExactBoth && bExactBoth) return 1

    const aExactOne = aGivenExact || aFamilyExact
    const bExactOne = bGivenExact || bFamilyExact
    if (aExactOne && !bExactOne) return -1
    if (!aExactOne && bExactOne) return 1

    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0
    return bTime - aTime
  })

  return sorted[0]
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { 
      teamMemberPhone, // Team member's phone to verify they're staff
      customerPhone,   // Customer phone to search
      customerGivenName, // Customer first name
      customerFamilyName // Customer last name
    } = body

    // Verify team member
    if (!teamMemberPhone) {
      return NextResponse.json(
        { error: 'Team member phone number is required for admin access' },
        { status: 401 }
      )
    }

    const isTeamMemberVerified = await isTeamMember(teamMemberPhone)
    if (!isTeamMemberVerified) {
      return NextResponse.json(
        { error: 'Unauthorized: Phone number not found in active team members' },
        { status: 403 }
      )
    }

    // Validate search criteria
    if (!customerPhone && !customerGivenName && !customerFamilyName) {
      return NextResponse.json(
        { error: 'Please provide customer phone number or name to search' },
        { status: 400 }
      )
    }

    let customer = null

    // Priority: phone number > name
    if (customerPhone) {
      customer = await findCustomerByPhone(customerPhone)
    }

    // If no customer found by phone, or no phone provided, try name search
    if (!customer && (customerGivenName || customerFamilyName)) {
      customer = await findCustomerByName(customerGivenName, customerFamilyName)
    }

    if (!customer) {
      return NextResponse.json(
        { 
          found: false,
          error: 'Customer not found'
        },
        { status: 200 }
      )
    }

    // Generate personal_code if missing
    if (!customer.personal_code) {
      const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Customer'
      
      function generatePersonalCode(name, id) {
        let namePart = 'CUST'
        if (name) {
          namePart = name.toString().trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10)
        }
        let idPart = ''
        if (id) {
          const idStr = id.toString()
          const numericMatches = idStr.match(/\d+/g)
          if (numericMatches && numericMatches.length > 0) {
            const allNums = numericMatches.join('')
            idPart = allNums.slice(-4).padStart(4, '0')
          } else {
            idPart = idStr.slice(-4).toUpperCase()
          }
        } else {
          idPart = Date.now().toString().slice(-4)
        }
        if (idPart.length < 3) idPart = idPart.padStart(4, '0')
        if (idPart.length > 4) idPart = idPart.slice(-4)
        return `${namePart}${idPart}`
      }

      let personalCode = generatePersonalCode(customerName, customer.square_customer_id)
      let attempts = 0
      const maxAttempts = 10

      while (attempts < maxAttempts) {
        const existing = await prisma.$queryRaw`
          SELECT square_customer_id 
          FROM square_existing_clients
          WHERE personal_code = ${personalCode}
          LIMIT 1
        `
        
        if (!existing || existing.length === 0) {
          break
        }
        
        personalCode = generatePersonalCode(customerName, `${customer.square_customer_id}_${Date.now()}`)
        attempts++
      }

      await prisma.$executeRaw`
        UPDATE square_existing_clients
        SET personal_code = ${personalCode}, updated_at = NOW()
        WHERE square_customer_id = ${customer.square_customer_id}
      `
      
      customer.personal_code = personalCode
    }

    // Generate referral URL if missing
    if (!customer.referral_url && customer.personal_code) {
      const referralUrl = generateReferralUrl(customer.personal_code)
      await prisma.$executeRaw`
        UPDATE square_existing_clients
        SET referral_url = ${referralUrl}, updated_at = NOW()
        WHERE square_customer_id = ${customer.square_customer_id}
      `
      customer.referral_url = referralUrl
    }

    if (!customer.referral_url || !customer.personal_code) {
      return NextResponse.json(
        { 
          found: true,
          hasReferralLink: false,
          customerName: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown',
          error: 'Unable to generate referral code. Please contact support.'
        },
        { status: 200 }
      )
    }

    const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'

    return NextResponse.json({
      found: true,
      hasReferralLink: true,
      customerName: customerName,
      referralCode: customer.personal_code || null,
      referralUrl: customer.referral_url,
      phoneNumber: customer.phone_number,
      squareCustomerId: customer.square_customer_id,
      emailAddress: customer.email_address,
      adminAccess: true // Indicates this was accessed via admin endpoint
    })

  } catch (error) {
    console.error('Error in admin lookup:', error)
    return NextResponse.json(
      { error: 'Failed to lookup customer information' },
      { status: 500 }
    )
  }
}

