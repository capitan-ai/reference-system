import { NextResponse } from 'next/server'
import prisma from '../../../../lib/prisma-client'
import { sendVerificationCodeSms } from '../../../../lib/twilio-service'
import { findCustomerByPhone, normalizePhoneNumber } from '../../../../lib/utils/phone-matching'

/**
 * Generate 6-digit verification code
 */
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(request) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-code/route.js:39',message:'POST send-code entry',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
  // #endregion
  try {
    const body = await request.json()
    const { phoneNumber } = body
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-code/route.js:43',message:'request parsed',data:{hasPhone:!!phoneNumber,phoneNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
    // #endregion

    if (!phoneNumber) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    const normalized = normalizePhoneNumber(phoneNumber)
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-code/route.js:52',message:'phone normalized',data:{original:phoneNumber,normalized},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
    // #endregion
    if (!normalized) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    // Check if customer exists - handle various phone number formats in database
    const customer = await findCustomerByPhone(phoneNumber)

    // Always send success message (don't reveal if customer exists - security best practice)
    // But only actually send SMS if customer exists
    if (!customer) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-code/route.js:62',message:'customer not found - no SMS sent',data:{normalized,original:phoneNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
      // #endregion
      return NextResponse.json(
        { 
          success: true, 
          message: 'If this number is registered, a verification code has been sent.' 
        },
        { status: 200 }
      )
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-code/route.js:72',message:'customer found - proceeding to send SMS',data:{customerId:customer.square_customer_id,dbPhone:customer.phone_number},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
    // #endregion

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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-code/route.js:130',message:'before sending SMS',data:{to:normalized,codeLength:code.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
    // #endregion
    const smsResult = await sendVerificationCodeSms({
      to: normalized,
      code: code
    })
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-code/route.js:137',message:'SMS send result',data:{success:smsResult.success,skipped:smsResult.skipped,reason:smsResult.reason,error:smsResult.error,sid:smsResult.sid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
    // #endregion

    if (!smsResult.success && !smsResult.skipped) {
      console.error('Failed to send SMS:', smsResult.error)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-code/route.js:141',message:'SMS send failed',data:{error:smsResult.error,code:smsResult.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'send-code/route.js:150',message:'send-code error caught',data:{error:error.message,errorStack:error.stack?.substring(0,200),errorName:error.constructor.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
    // #endregion
    console.error('Error sending verification code:', error)
    return NextResponse.json(
      { error: 'Failed to send verification code' },
      { status: 500 }
    )
  }
}

