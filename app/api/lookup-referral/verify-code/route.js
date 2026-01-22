import { NextResponse } from 'next/server'
import prisma from '../../../../lib/prisma-client'
import { generateReferralUrl } from '../../../../lib/utils/referral-url'
import { 
  generateSessionToken, 
  createVerifiedSession, 
  setSessionCookie 
} from '../../../../lib/utils/phone-verification-session'
import { findCustomerByPhone, normalizePhoneNumber } from '../../../../lib/utils/phone-matching'

export async function POST(request) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'verify-code/route.js:37',message:'POST verify-code entry',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
  // #endregion
  try {
    const body = await request.json()
    const { phoneNumber, code } = body
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'verify-code/route.js:41',message:'request body parsed',data:{hasPhone:!!phoneNumber,hasCode:!!code,codeLength:code?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    if (!phoneNumber || !code) {
      return NextResponse.json(
        { error: 'Phone number and verification code are required' },
        { status: 400 }
      )
    }

    const normalized = normalizePhoneNumber(phoneNumber)
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'verify-code/route.js:50',message:'phone normalized',data:{original:phoneNumber,normalized},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (!normalized) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    // Find valid verification code
    const verification = await prisma.$queryRaw`
      SELECT id, phone_number, code, verified, expires_at, attempts
      FROM phone_verifications
      WHERE phone_number = ${normalized}
        AND code = ${code}
        AND verified = false
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `

    if (!verification || verification.length === 0) {
      // Increment attempts for rate limiting
      await prisma.$executeRaw`
        UPDATE phone_verifications
        SET attempts = attempts + 1
        WHERE phone_number = ${normalized}
          AND code = ${code}
          AND verified = false
      `

      return NextResponse.json(
        { error: 'Invalid or expired verification code' },
        { status: 400 }
      )
    }

    const verif = verification[0]

    // Check attempts (max 5)
    if (verif.attempts >= 5) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please request a new code.' },
        { status: 400 }
      )
    }

    // Mark as verified
    await prisma.$executeRaw`
      UPDATE phone_verifications
      SET verified = true, verified_at = NOW()
      WHERE id = ${verif.id}
    `

    // Create verified session
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'verify-code/route.js:102',message:'before creating session',data:{normalized},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const sessionToken = generateSessionToken()
    const { expiresAt } = await createVerifiedSession(normalized, sessionToken)
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'verify-code/route.js:106',message:'session created, setting cookie',data:{hasExpiresAt:!!expiresAt},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    await setSessionCookie(sessionToken, expiresAt)
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'verify-code/route.js:109',message:'cookie set complete',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    // Find customer and return referral data
    const customer = await findCustomerByPhone(phoneNumber)

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    const cust = customer

    // Generate personal_code if missing
    if (!cust.personal_code) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'verify-code/route.js:149',message:'generating missing personal_code',data:{customerId:cust.square_customer_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      const customerName = `${cust.given_name || ''} ${cust.family_name || ''}`.trim() || 'Customer'
      
      // Generate personal code (name + last 4 digits of customer ID)
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

      let personalCode = generatePersonalCode(customerName, cust.square_customer_id)
      let attempts = 0
      const maxAttempts = 10

      // Ensure code is unique
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
        
        // Try with timestamp to make it unique
        personalCode = generatePersonalCode(customerName, `${cust.square_customer_id}_${Date.now()}`)
        attempts++
      }

      // Update database with generated code
      await prisma.$executeRaw`
        UPDATE square_existing_clients
        SET personal_code = ${personalCode}, updated_at = NOW()
        WHERE square_customer_id = ${cust.square_customer_id}
      `
      
      cust.personal_code = personalCode
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'verify-code/route.js:190',message:'personal_code generated',data:{personalCode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
    }

    // Generate referral URL if missing
    if (!cust.referral_url && cust.personal_code) {
      const referralUrl = generateReferralUrl(cust.personal_code)
      await prisma.$executeRaw`
        UPDATE square_existing_clients
        SET referral_url = ${referralUrl}, updated_at = NOW()
        WHERE square_customer_id = ${cust.square_customer_id}
      `
      cust.referral_url = referralUrl
    }

    if (!cust.referral_url || !cust.personal_code) {
      return NextResponse.json(
        { 
          found: true,
          hasReferralLink: false,
          customerName: `${cust.given_name || ''} ${cust.family_name || ''}`.trim() || 'Unknown',
          error: 'Unable to generate referral code. Please contact support.'
        },
        { status: 200 }
      )
    }

    const customerName = `${cust.given_name || ''} ${cust.family_name || ''}`.trim() || 'Unknown'

    return NextResponse.json({
      found: true,
      hasReferralLink: true,
      customerName: customerName,
      referralCode: cust.personal_code || null,
      referralUrl: cust.referral_url,
      phoneNumber: cust.phone_number,
      squareCustomerId: cust.square_customer_id,
      sessionCreated: true
    })

  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'verify-code/route.js:169',message:'verify-code error caught',data:{error:error.message,errorStack:error.stack?.substring(0,200),errorName:error.constructor.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    console.error('Error verifying code:', error)
    return NextResponse.json(
      { error: 'Failed to verify code' },
      { status: 500 }
    )
  }
}

