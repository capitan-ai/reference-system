import { NextResponse } from 'next/server'
import { getSessionToken, verifySession } from '../../../../lib/utils/phone-verification-session'
import prisma from '../../../../lib/prisma-client'
import { generateReferralUrl } from '../../../../lib/utils/referral-url'

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

export async function POST(request) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'check-session/route.js:33',message:'POST check-session entry',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  try {
    const body = await request.json()
    const { phoneNumber } = body
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'check-session/route.js:36',message:'request parsed',data:{hasPhone:!!phoneNumber,phoneNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    if (!phoneNumber) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    const normalized = normalizePhoneNumber(phoneNumber)
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'check-session/route.js:45',message:'phone normalized',data:{original:phoneNumber,normalized},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (!normalized) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    // Check if there's a valid session
    const sessionToken = await getSessionToken()
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'check-session/route.js:54',message:'session token retrieved',data:{hasToken:!!sessionToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    if (sessionToken) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'check-session/route.js:56',message:'verifying session',data:{hasToken:!!sessionToken,normalized},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      const { valid, session } = await verifySession(sessionToken, normalized)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'check-session/route.js:59',message:'session verification result',data:{valid,hasSession:!!session},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      if (valid && session) {
        // Session is valid! Skip SMS and return referral data directly
        const customer = await prisma.$queryRaw`
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
          const cust = customer[0]
          
          // Generate personal_code if missing
          if (!cust.personal_code) {
            const customerName = `${cust.given_name || ''} ${cust.family_name || ''}`.trim() || 'Customer'
            
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
              
              personalCode = generatePersonalCode(customerName, `${cust.square_customer_id}_${Date.now()}`)
              attempts++
            }

            await prisma.$executeRaw`
              UPDATE square_existing_clients
              SET personal_code = ${personalCode}, updated_at = NOW()
              WHERE square_customer_id = ${cust.square_customer_id}
            `
            
            cust.personal_code = personalCode
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
            return NextResponse.json({
              found: true,
              hasReferralLink: false,
              customerName: `${cust.given_name || ''} ${cust.family_name || ''}`.trim() || 'Unknown',
              error: 'Unable to generate referral code. Please contact support.',
              sessionValid: true
            })
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
            sessionValid: true,
            skipVerification: true
          })
        }
      }
    }

    // No valid session found - need to send SMS
    return NextResponse.json({
      sessionValid: false,
      needsVerification: true
    })

  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'check-session/route.js:123',message:'check-session error caught',data:{error:error.message,errorStack:error.stack?.substring(0,200),errorName:error.constructor.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.error('Error checking session:', error)
    return NextResponse.json(
      { error: 'Failed to check session', needsVerification: true },
      { status: 500 }
    )
  }
}

