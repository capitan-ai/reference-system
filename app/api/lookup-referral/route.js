import { NextResponse } from 'next/server'
import prisma from '../../../lib/prisma-client'

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
 * Try to match phone number in various formats
 * Since square_existing_clients.phone_number might be stored in different formats
 * Database has formats like: (415) 308-0148, +14156991143, etc.
 */
async function findCustomerByPhone(phoneNumber) {
  if (!phoneNumber) {
    return null
  }

  // Extract just the digits from input
  const inputDigits = phoneNumber.replace(/\D/g, '')
  if (inputDigits.length < 10) {
    return null
  }

  // Get last 10 digits (US phone number)
  const last10Digits = inputDigits.slice(-10)

  // Try multiple matching strategies
  // 1. Try exact match with normalized format (+1XXXXXXXXXX)
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
        AND referral_url IS NOT NULL
        AND referral_url != ''
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
        AND referral_url IS NOT NULL
        AND referral_url != ''
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
    WHERE referral_url IS NOT NULL
      AND referral_url != ''
      AND (
        phone_number LIKE ${'%' + last10Digits}
        OR phone_number LIKE ${'%' + last10Digits.slice(0, 3) + '%' + last10Digits.slice(3, 6) + '%' + last10Digits.slice(6)}
        OR phone_number LIKE ${'%' + last10Digits.slice(0, 3) + ')%' + last10Digits.slice(3, 6) + '-%' + last10Digits.slice(6)}
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
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { phoneNumber } = body

    if (!phoneNumber) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    // Find customer by phone number
    const customer = await findCustomerByPhone(phoneNumber)

    if (!customer) {
      return NextResponse.json(
        { 
          found: false,
          error: 'No customer found with this phone number'
        },
        { status: 200 }
      )
    }

    // Check if customer has a referral URL
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
    return NextResponse.json(
      { 
        error: 'Failed to lookup referral information',
        details: error.message
      },
      { status: 500 }
    )
  }
}

