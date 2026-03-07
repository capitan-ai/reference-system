import { NextResponse } from 'next/server'
import prisma from '../../../lib/prisma-client'
import { generateReferralUrl } from '../../../lib/utils/referral-url'

/**
 * Normalize phone number to match database format
 * Handles various formats: (415) 555-1234, 415-555-1234, +14155551234, etc.
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null
  
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '')
  
  // If it starts with +, keep it
  if (cleaned.startsWith('+')) {
    return cleaned
  }
  
  // If it's 10 digits, assume US number and add +1
  if (cleaned.length === 10) {
    return `+1${cleaned}`
  }
  
  // If it's 11 digits and starts with 1, add +
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`
  }
  
  // Otherwise, try to add +1 if it looks like a US number
  if (cleaned.length >= 10) {
    return `+1${cleaned.slice(-10)}`
  }
  
  return cleaned
}

/**
 * Try to find customer by first name and last name
 * Uses case-insensitive matching and partial matches
 */
async function findCustomerByName(givenName, familyName) {
  if (!givenName && !familyName) {
    return null
  }

  const trimmedGiven = givenName ? givenName.trim() : ''
  const trimmedFamily = familyName ? familyName.trim() : ''

  let customers = []

  try {
    // Build search query based on what's provided
    // Use Prisma parameterized queries for safety
    if (trimmedGiven && trimmedFamily) {
      // Both first and last name provided
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
      // Only first name
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
      // Only last name
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

  // Prioritize exact matches and real customers over test accounts
  const prioritizeCustomer = (customers) => {
    return customers.sort((a, b) => {
      // Filter out test accounts
      const aIsTest = (a.given_name && a.given_name.toLowerCase().includes('test')) ||
                     (a.family_name && a.family_name.toLowerCase().includes('test')) ||
                     (a.personal_code && a.personal_code.toUpperCase().startsWith('TEST'))
      const bIsTest = (b.given_name && b.given_name.toLowerCase().includes('test')) ||
                     (b.family_name && b.family_name.toLowerCase().includes('test')) ||
                     (b.personal_code && b.personal_code.toUpperCase().startsWith('TEST'))
      
      // Real customers come first
      if (aIsTest && !bIsTest) return 1
      if (!aIsTest && bIsTest) return -1
      
      // Check for exact name matches
      const aGivenExact = trimmedGiven && a.given_name && 
                         a.given_name.toLowerCase() === trimmedGiven.toLowerCase()
      const aFamilyExact = trimmedFamily && a.family_name && 
                          a.family_name.toLowerCase() === trimmedFamily.toLowerCase()
      const bGivenExact = trimmedGiven && b.given_name && 
                         b.given_name.toLowerCase() === trimmedGiven.toLowerCase()
      const bFamilyExact = trimmedFamily && b.family_name && 
                          b.family_name.toLowerCase() === trimmedFamily.toLowerCase()

      // Exact matches on both names come first
      const aExactBoth = trimmedGiven && trimmedFamily && aGivenExact && aFamilyExact
      const bExactBoth = trimmedGiven && trimmedFamily && bGivenExact && bFamilyExact
      
      if (aExactBoth && !bExactBoth) return -1
      if (!aExactBoth && bExactBoth) return 1

      // Then exact match on one name
      const aExactOne = aGivenExact || aFamilyExact
      const bExactOne = bGivenExact || bFamilyExact
      
      if (aExactOne && !bExactOne) return -1
      if (!aExactOne && bExactOne) return 1
      
      // If both are same type, sort by updated_at DESC
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0
      return bTime - aTime
    })
  }

  const sorted = prioritizeCustomer(customers)
  return sorted[0]
}

/**
 * Try to match phone number in various formats
 * Since square_existing_clients.phone_number might be stored in different formats
 * Database has formats like: (415) 308-0148, +14156991143, etc.
 */
async function findCustomerByPhone(phoneNumber) {
  if (!phoneNumber) {
    return null
  }

  try {
    // Extract just the digits from input
    const inputDigits = phoneNumber.replace(/\D/g, '')
    if (inputDigits.length < 10) {
      return null
    }

    // Get last 10 digits (US phone number)
    const last10Digits = inputDigits.slice(-10)

    // Try multiple matching strategies
    // First, find the customer by phone number (without filtering by referral_url)
    // Then we'll check if they have a referral_url in the POST handler
    const normalized = normalizePhoneNumber(phoneNumber)
    if (normalized) {
      let customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        phone_number,
        personal_code,
        referral_url,
        given_name,
        family_name,
        email_address
      FROM square_existing_clients
      WHERE phone_number = ${normalized}
      LIMIT 1
    `

    if (customer && customer.length > 0) {
      return customer[0]
    }

    // Try without + prefix
    const withoutPlus = normalized.replace(/^\+/, '')
    customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        phone_number,
        personal_code,
        referral_url,
        given_name,
        family_name,
        email_address
      FROM square_existing_clients
      WHERE phone_number = ${withoutPlus}
      LIMIT 1
    `

    if (customer && customer.length > 0) {
      return customer[0]
    }
  }

    // 2. Try matching by extracting digits from database phone numbers
    // This handles formats like (415) 308-0148, +14156991143, etc.
    // We'll match if the last 10 digits match
    // Use LIKE to find potential matches first (more efficient than fetching all)
    const pattern1 = `%${last10Digits}`
    const pattern2 = `%${last10Digits.slice(0, 3)}%${last10Digits.slice(3, 6)}%${last10Digits.slice(6)}`
    const pattern3 = `%${last10Digits.slice(0, 3)})%${last10Digits.slice(3, 6)}-%${last10Digits.slice(6)}`
    
    const potentialMatches = await prisma.$queryRaw`
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
      WHERE (
        phone_number LIKE ${pattern1}
        OR phone_number LIKE ${pattern2}
        OR phone_number LIKE ${pattern3}
      )
      ORDER BY updated_at DESC, square_customer_id DESC
    `

  // Filter customers where the last 10 digits match exactly
  // If multiple matches, prioritize by:
  // 1. Exact format match (no formatting differences)
  // 2. Most recently updated
  const exactMatches = []
  const digitMatches = []
  
  for (const customer of potentialMatches) {
    if (!customer.phone_number) continue
    
    // Extract digits from database phone number
    const dbDigits = customer.phone_number.replace(/\D/g, '')
    const dbLast10 = dbDigits.slice(-10)
    
    // Compare last 10 digits
    if (dbLast10 === last10Digits && dbLast10.length === 10) {
      // Check if it's an exact format match (input format matches DB format)
      const inputFormatted = phoneNumber.replace(/\D/g, '')
      const dbFormatted = customer.phone_number.replace(/\D/g, '')
      
      if (inputFormatted === dbFormatted || 
          (inputFormatted.slice(-10) === dbFormatted.slice(-10) && 
           Math.abs(inputFormatted.length - dbFormatted.length) <= 1)) {
        exactMatches.push(customer)
      } else {
        digitMatches.push(customer)
      }
    }
  }

  // Return exact match first, or most recent digit match
  // Prioritize real customers over test accounts
  const prioritizeCustomer = (customers) => {
    return customers.sort((a, b) => {
      // Filter out test accounts (names containing "Test", "test", etc.)
      const aIsTest = (a.given_name && a.given_name.toLowerCase().includes('test')) ||
                     (a.family_name && a.family_name.toLowerCase().includes('test')) ||
                     (a.personal_code && a.personal_code.toUpperCase().startsWith('TEST'))
      const bIsTest = (b.given_name && b.given_name.toLowerCase().includes('test')) ||
                     (b.family_name && b.family_name.toLowerCase().includes('test')) ||
                     (b.personal_code && b.personal_code.toUpperCase().startsWith('TEST'))
      
      // Real customers come first
      if (aIsTest && !bIsTest) return 1
      if (!aIsTest && bIsTest) return -1
      
      // If both are same type, sort by updated_at DESC
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0
      return bTime - aTime
    })
  }

  if (exactMatches.length > 0) {
    const sorted = prioritizeCustomer(exactMatches)
    return sorted[0]
  }
  
    if (digitMatches.length > 0) {
      const sorted = prioritizeCustomer(digitMatches)
      return sorted[0]
    }

    return null
  } catch (error) {
    console.error('Error in findCustomerByPhone:', error)
    throw error
  }
}

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const body = await request.json()
    const { phoneNumber, givenName, familyName } = body

    // Validate that at least one search criterion is provided
    if (!phoneNumber && !givenName && !familyName) {
      return NextResponse.json(
        { error: 'Please provide at least one search criterion: phone number, first name, or last name' },
        { status: 400 }
      )
    }

    let customer = null

    // Priority: phone number > name (if phone number is provided, use it first)
    if (phoneNumber) {
      customer = await findCustomerByPhone(phoneNumber)
    }

    // If no customer found by phone, or no phone provided, try name search
    if (!customer && (givenName || familyName)) {
      customer = await findCustomerByName(givenName, familyName)
    }

    // If we have both phone and name, and found by phone, optionally verify name matches
    if (customer && phoneNumber && (givenName || familyName)) {
      // Verify name matches if provided (but don't fail if it doesn't)
      const nameMatch = (!givenName || !customer.given_name || 
                        customer.given_name.toLowerCase().includes(givenName.trim().toLowerCase())) &&
                       (!familyName || !customer.family_name || 
                        customer.family_name.toLowerCase().includes(familyName.trim().toLowerCase()))
      
      // If name doesn't match, try finding by name instead
      if (!nameMatch) {
        const nameCustomer = await findCustomerByName(givenName, familyName)
        if (nameCustomer) {
          // Prefer the one that matches more criteria
          const phoneMatch = customer && customer.phone_number
          if (nameCustomer.phone_number && phoneNumber) {
            // Both have phone numbers - prefer exact phone match
            const namePhoneDigits = nameCustomer.phone_number.replace(/\D/g, '').slice(-10)
            const inputPhoneDigits = phoneNumber.replace(/\D/g, '').slice(-10)
            if (namePhoneDigits === inputPhoneDigits) {
              customer = nameCustomer
            }
          }
        }
      }
    }

    if (!customer) {
      let errorMessage = 'No customer found'
      if (phoneNumber && (givenName || familyName)) {
        errorMessage = 'No customer found matching the provided search criteria'
      } else if (phoneNumber) {
        errorMessage = 'No customer found with this phone number'
      } else if (givenName || familyName) {
        errorMessage = 'No customer found with this name'
      }
      
      return NextResponse.json(
        { 
          found: false,
          error: errorMessage
        },
        { status: 200 }
      )
    }

    // Check if customer has a referral URL
    // If they have a personal_code but no referral_url, generate it
    if (!customer.referral_url) {
      if (customer.personal_code) {
        // Generate referral URL from personal code
        const referralUrl = generateReferralUrl(customer.personal_code)
        
        // Update the database with the generated URL
        try {
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET 
              referral_url = ${referralUrl},
              updated_at = NOW()
            WHERE square_customer_id = ${customer.square_customer_id}
          `
          
          // Update customer object to include the new URL
          customer.referral_url = referralUrl
        } catch (error) {
          console.error('Error updating referral URL:', error)
          // Continue even if update fails
        }
      } else {
        // No personal_code and no referral_url
        return NextResponse.json(
          { 
            found: true,
            hasReferralLink: false,
            customerName: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown',
            error: 'Customer found but no referral code or URL available'
          },
          { status: 200 }
        )
      }
    }
    
    // Double check after potential generation
    if (!customer.referral_url) {
      return NextResponse.json(
        { 
          found: true,
          hasReferralLink: false,
          customerName: `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown',
          error: 'Customer found but no referral URL available'
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
      squareCustomerId: customer.square_customer_id
    })

  } catch (error) {
    console.error('Error looking up referral:', error)
    console.error('Error stack:', error.stack)
    return NextResponse.json(
      { 
        found: false,
        error: error.message || 'Failed to lookup referral information',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

