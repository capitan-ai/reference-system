import { NextResponse } from 'next/server'
import prisma from '../../../../lib/prisma-client'
import { sendVerificationCodeSms } from '../../../../lib/twilio-service'

/**
 * Normalize phone number to match database format
 */
function normalizePhoneNumber(phone) {
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

/**
 * Generate 6-digit verification code
 */
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
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

    const normalized = normalizePhoneNumber(phoneNumber)
    if (!normalized) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    // Check if customer exists (but don't reveal if they don't - security best practice)
    const customer = await prisma.$queryRaw`
      SELECT square_customer_id, phone_number, given_name, family_name
      FROM square_existing_clients
      WHERE phone_number = ${normalized}
         OR phone_number = ${normalized.replace(/^\+/, '')}
      LIMIT 1
    `

    // Always send success message (don't reveal if customer exists)
    // But only actually send SMS if customer exists
    if (!customer || customer.length === 0) {
      return NextResponse.json(
        { 
          success: true, 
          message: 'If this number is registered, a verification code has been sent.' 
        },
        { status: 200 }
      )
    }

    // Generate verification code
    const code = generateVerificationCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Invalidate any existing unverified codes for this phone
    await prisma.$executeRaw`
      UPDATE phone_verifications
      SET verified = true
      WHERE phone_number = ${normalized} AND verified = false
    `

    // Create new verification record
    await prisma.$executeRaw`
      INSERT INTO phone_verifications (id, phone_number, code, expires_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${normalized}, ${code}, ${expiresAt}, NOW(), NOW())
    `

    // Send SMS with code
    const smsResult = await sendVerificationCodeSms({
      to: normalized,
      code: code
    })

    if (!smsResult.success && !smsResult.skipped) {
      console.error('Failed to send SMS:', smsResult.error)
      return NextResponse.json(
        { error: 'Failed to send verification code. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Verification code sent successfully'
    })

  } catch (error) {
    console.error('Error sending verification code:', error)
    return NextResponse.json(
      { error: 'Failed to send verification code' },
      { status: 500 }
    )
  }
}

