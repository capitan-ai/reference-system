import prisma from '../prisma-client'

/**
 * Find customer by phone number with flexible matching
 * Handles various formats: (415) 609-5156, +14156095156, 14156095156, etc.
 */
export async function findCustomerByPhone(phoneNumber) {
  if (!phoneNumber) return null

  const normalized = normalizePhoneNumber(phoneNumber)
  if (!normalized) return null

  // Extract last 10 digits for matching
  const inputDigits = normalized.replace(/\D/g, '')
  const last10Digits = inputDigits.slice(-10)

  // 1. Try exact normalized match
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
       OR phone_number = ${normalized.replace(/^\+/, '')}
    LIMIT 1
  `

  if (customer && customer.length > 0) {
    return customer[0]
  }

  // 2. Try matching by last 10 digits (handles formatted numbers like (415) 609-5156)
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
    ORDER BY updated_at DESC
    LIMIT 10
  `

  // Filter to exact last 10 digit matches
  if (potentialMatches && potentialMatches.length > 0) {
    for (const match of potentialMatches) {
      if (!match.phone_number) continue
      const dbDigits = match.phone_number.replace(/\D/g, '')
      const dbLast10 = dbDigits.slice(-10)
      if (dbLast10 === last10Digits && dbLast10.length === 10) {
        return match
      }
    }
  }

  return null
}

/**
 * Normalize phone number to E.164 format
 */
export function normalizePhoneNumber(phone) {
  if (!phone) return null

  let cleaned = phone.replace(/[^\d+]/g, '')

  if (cleaned.startsWith('+')) {
    return cleaned
  }

  if (cleaned.length === 10) {
    return `+1${cleaned}`
  }

  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`
  }

  if (cleaned.length >= 10) {
    return `+1${cleaned.slice(-10)}`
  }

  return cleaned
}



