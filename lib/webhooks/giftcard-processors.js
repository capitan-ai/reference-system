// Gift card processor functions
// Extracted from route.js to avoid Next.js route export restrictions
// This module can be safely imported by worker.js and other scripts

const prisma = require('../prisma-client')
const { Client, Environment } = require('square')
const QRCode = require('qrcode')
const { sendReferralCodeEmail, sendGiftCardIssuedEmail } = require('../email-service-simple')
const { sendReferralCodeSms, REFERRAL_PROGRAM_SMS_TEMPLATE } = require('../twilio-service')
const { normalizeGiftCardNumber } = require('../wallet/giftcard-number-utils')
const {
  buildStageKey,
  buildIdempotencyKey,
  updateGiftCardRunStage,
  markGiftCardRunError
} = require('../runs/giftcard-run-tracker')
const { generateReferralUrl } = require('../utils/referral-url')
const { queueWalletPassUpdate } = require('../wallet/push-service')
const { getSquareEnvironmentName } = require('../utils/square-env')

const squareEnvironmentName = getSquareEnvironmentName()
const environment = squareEnvironmentName === 'sandbox' ? Environment.Sandbox : Environment.Production
if (process.env.NODE_ENV !== 'production') {
  console.log(`[square] Gift card processors using ${squareEnvironmentName} environment`)
}

// Get Square access token with validation
function getSquareAccessToken() {
  const token = process.env.SQUARE_ACCESS_TOKEN?.trim()
  if (!token) {
    console.error('[square] ⚠️ SQUARE_ACCESS_TOKEN is not set or empty')
    console.error('[square] Environment check:')
    console.error(`   - NODE_ENV: ${process.env.NODE_ENV || 'not set'}`)
    console.error(`   - SQUARE_ACCESS_TOKEN exists: ${!!process.env.SQUARE_ACCESS_TOKEN}`)
    console.error(`   - SQUARE_ACCESS_TOKEN length: ${process.env.SQUARE_ACCESS_TOKEN?.length || 0}`)
    throw new Error('SQUARE_ACCESS_TOKEN is required but not set')
  }
  // Remove 'Bearer ' prefix if present
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token
  console.log(`[square] Token loaded: ${cleanToken.substring(0, 10)}... (length: ${cleanToken.length})`)
  return cleanToken
}

// Initialize Square client
// In Vercel, environment variables should be available at module load time
const token = getSquareAccessToken()
console.log(`[square] Initializing Square client for ${squareEnvironmentName} environment`)
console.log(`[square] Token loaded: length=${token.length}, preview=${token.substring(0, 10)}...`)

const squareClient = new Client({
  accessToken: token,
  environment,
})

const customersApi = squareClient.customersApi
const giftCardsApi = squareClient.giftCardsApi
const giftCardActivitiesApi = squareClient.giftCardActivitiesApi
const customerCustomAttributesApi = squareClient.customerCustomAttributesApi
const bookingCustomAttributesApi = squareClient.bookingCustomAttributesApi
const ordersApi = squareClient.ordersApi
const paymentsApi = squareClient.paymentsApi

console.log(`[square] Square client and APIs initialized successfully`)

const DELIVERY_CHANNELS = {
  SQUARE_EGIFT_ORDER: 'square_egift_order',
  OWNER_FUNDED_ACTIVATE: 'owner_funded_activate',
  OWNER_FUNDED_ADJUST: 'owner_funded_adjust'
}

const REFERRAL_CODE_ATTRIBUTE_KEY =
  process.env.SQUARE_REFERRAL_CODE_ATTRIBUTE_KEY?.trim() ||
  'square:a3dde506-f69e-48e4-a98a-004c1822d3ad'

const REFERRAL_SMS_TEMPLATE =
  process.env.REFERRAL_SMS_TEMPLATE ||
  REFERRAL_PROGRAM_SMS_TEMPLATE

// Helper: Resolve organization_id from square_merchant_id
async function resolveOrganizationId(squareMerchantId) {
  if (!squareMerchantId) {
    return null
  }
  
  try {
    const org = await prisma.$queryRaw`
      SELECT id FROM organizations 
      WHERE square_merchant_id = ${squareMerchantId}
      LIMIT 1
    `
    
    if (org && org.length > 0) {
      return org[0].id
    }
    
    console.warn(`⚠️ Organization not found for square_merchant_id: ${squareMerchantId}`)
    return null
  } catch (error) {
    console.error(`❌ Error resolving organization_id: ${error.message}`)
    return null
  }
}

// Helper: Get organization_id from context, merchant_id, or environment
async function getOrganizationId(context = {}) {
  // Try from context first
  if (context.organizationId && typeof context.organizationId === 'string' && context.organizationId.length > 0) {
    console.log(`✅ Using organization_id from context: ${context.organizationId}`)
    return context.organizationId
  }
  
  // Try to get merchant_id from context or environment
  const merchantId = context.merchantId || 
                     context.squareMerchantId || 
                     process.env.SQUARE_MERCHANT_ID?.trim()
  
  if (merchantId) {
    console.log(`🔍 Resolving organization_id from merchant_id: ${merchantId}`)
    const orgId = await resolveOrganizationId(merchantId)
    if (orgId && typeof orgId === 'string' && orgId.length > 0) {
      console.log(`✅ Resolved organization_id from merchant_id: ${orgId}`)
      return orgId
    } else {
      console.warn(`⚠️ Could not resolve organization_id from merchant_id: ${merchantId}`)
    }
  } else {
    console.warn(`⚠️ No merchant_id found in context or environment`)
  }
  
  // Fallback: try to get default organization (if only one exists)
  try {
    console.log(`🔍 Attempting to get default organization from database...`)
    const orgs = await prisma.$queryRaw`
      SELECT id FROM organizations 
      ORDER BY created_at ASC
      LIMIT 1
    `
    if (orgs && orgs.length > 0 && orgs[0].id) {
      const defaultOrgId = orgs[0].id
      if (typeof defaultOrgId === 'string' && defaultOrgId.length > 0) {
        console.warn(`⚠️ Using default organization_id: ${defaultOrgId} (merchant_id not found)`)
        return defaultOrgId
      }
    }
    console.error(`❌ No organizations found in database`)
  } catch (error) {
    console.error(`❌ Error getting default organization: ${error.message}`)
  }
  
  throw new Error('Could not determine organization_id. Set SQUARE_MERCHANT_ID environment variable or provide organizationId in context.')
}

// Helper function: Generate QR code for gift card
async function generateGiftCardQrDataUri(giftCardGan) {
  if (!giftCardGan) return null
  
  // Ensure GAN is clean (only digits, no spaces or special chars)
  const cleanGan = giftCardGan.toString().trim().replace(/\D/g, '')
  if (!cleanGan || cleanGan.length < 10) {
    console.warn(`⚠️ Invalid GAN format for QR code: ${giftCardGan}`)
    return null
  }

  try {
    // Use high quality settings for Square scanner compatibility
    return await QRCode.toDataURL(`sqgc://${cleanGan}`, {
      margin: 4,
      scale: 8,
      errorCorrectionLevel: 'H',
      width: 400
    })
  } catch (error) {
    console.warn(`⚠️ Failed to generate QR for gift card ${giftCardGan}:`, error.message)
    // Fallback to lower quality
    try {
      return await QRCode.toDataURL(`sqgc://${cleanGan}`, {
        margin: 2,
        scale: 5,
        errorCorrectionLevel: 'M',
        width: 250
      })
    } catch (fallbackError) {
      console.error(`❌ Fallback QR generation also failed:`, fallbackError.message)
      return null
    }
  }
}

async function extractGiftCardGansFromPayment(paymentData) {
  const gans = new Set()
  if (!paymentData) {
    return []
  }

  const tenders = Array.isArray(paymentData.tenders)
    ? paymentData.tenders
    : paymentData.tender
    ? Array.isArray(paymentData.tender)
      ? paymentData.tender
      : [paymentData.tender]
    : []

  for (const tender of tenders) {
    if (!tender) continue
    const hasGiftCardDetails = tender.giftCardDetails || tender.type === 'SQUARE_GIFT_CARD'
    if (!hasGiftCardDetails) continue

    let gan = tender.giftCardDetails?.gan

    if (!gan && tender.giftCardDetails?.giftCardId) {
      try {
        const response = await giftCardsApi.retrieveGiftCard(tender.giftCardDetails.giftCardId)
        const giftCard = response.result?.giftCard
        if (giftCard?.gan) {
          gan = giftCard.gan
        }
      } catch (error) {
        console.warn(`⚠️ Unable to resolve GAN for gift card ${tender.giftCardDetails.giftCardId}:`, error.message)
      }
    }

    if (gan) {
      gans.add(gan.trim())
    }
  }

  return Array.from(gans)
}

// Helper function: Send gift card email notification
async function sendGiftCardEmailNotification({
  customerName,
  email,
  giftCardGan,
  amountCents,
  balanceCents,
  activationUrl,
  passKitUrl,
  isReminder = false
}) {
  if (!email) {
    console.log('⚠️ Skipping gift card email – email address missing')
    return { success: false, skipped: true, reason: 'missing-email' }
  }

  if (!giftCardGan) {
    console.log('⚠️ Skipping gift card email – card number missing')
    return { success: false, skipped: true, reason: 'missing-gan' }
  }

  const meaningfulAmount = Number.isFinite(amountCents) ? amountCents : 0
  if (!isReminder && meaningfulAmount <= 0) {
    console.log('ℹ️ Gift card amount is zero, skipping issuance email')
    return { success: false, skipped: true, reason: 'zero-amount' }
  }

  const normalizedGan = await normalizeGiftCardNumber({
    rawValue: giftCardGan,
    prisma,
    giftCardsApi
  })
  const ganForEmail = normalizedGan || giftCardGan
  if (ganForEmail !== giftCardGan) {
    console.log(`   🔄 Normalized gift card number ${giftCardGan} → ${ganForEmail}`)
  }

  const qrDataUri = await generateGiftCardQrDataUri(ganForEmail)

  const emailResult = await sendGiftCardIssuedEmail(customerName, email, {
    giftCardGan: ganForEmail,
    amountCents: meaningfulAmount,
    balanceCents: balanceCents ?? null,
    activationUrl: activationUrl ?? null,
    passKitUrl: passKitUrl ?? null,
    qrDataUri,
    isReminder
  })

  if (!isReminder && ganForEmail) {
    queueWalletPassUpdate(ganForEmail, {
      prisma,
      reason: 'gift-card-email',
      metadata: {
        amountCents: meaningfulAmount
      }
    })
  }

  return emailResult
}

function safeStringify(value, space = 2) {
  try {
    return JSON.stringify(
      value,
      (_key, val) => (typeof val === 'bigint' ? val.toString() : val),
      space
    )
  } catch (error) {
    console.error('⚠️ Failed to stringify object safely:', error.message)
    return '[Unserializable value]'
  }
}

function cleanValue(value) {
  if (value === undefined || value === null) return null
  const trimmed = value.toString().trim()
  return trimmed.length > 0 ? trimmed : null
}

function generatePersonalCode(customerName, customerId) {
  let namePart = 'CUST'
  if (customerName) {
    namePart = customerName.toString().trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10)
  }
  let idPart = ''
  if (customerId) {
    const idStr = customerId.toString()
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

// Generate unique personal code, checking for duplicates
async function generateUniquePersonalCode(customerName, customerId, maxAttempts = 10) {
  let attempt = 0
  while (attempt < maxAttempts) {
    const code = generatePersonalCode(customerName, customerId)
    
    // If this is not the first attempt, add a suffix to make it unique
    if (attempt > 0) {
      const suffix = attempt.toString().padStart(2, '0')
      // Try to append suffix, but keep total length reasonable
      const baseCode = code.slice(0, -2) // Remove last 2 chars to make room
      const uniqueCode = `${baseCode}${suffix}`
      
      // Check if this code exists
      const existing = await prisma.$queryRaw`
        SELECT square_customer_id FROM square_existing_clients 
        WHERE personal_code = ${uniqueCode}
        LIMIT 1
      `
      
      if (!existing || existing.length === 0) {
        return uniqueCode
      }
    } else {
      // First attempt - check if base code exists
      const existing = await prisma.$queryRaw`
        SELECT square_customer_id FROM square_existing_clients 
        WHERE personal_code = ${code}
        LIMIT 1
      `
      
      if (!existing || existing.length === 0) {
        return code
      }
    }
    
    attempt++
  }
  
  // If all attempts failed, generate a completely random code
  const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  const namePart = customerName 
    ? customerName.toString().trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 6)
    : 'CUST'
  return `${namePart}${randomSuffix}`
}

async function findReferrerByCode(referralCode, organizationId) {
  try {
    if (!referralCode || typeof referralCode !== 'string') {
      console.error(`Invalid referral code provided: ${referralCode}`)
      return null
    }
    
    if (!organizationId) {
      console.error('❌ findReferrerByCode requires organizationId for multi-tenant isolation')
      return null
    }
    
    const normalizedCode = referralCode.trim().toUpperCase()
    console.log(`   🔍 Looking up referral code in database: "${normalizedCode}" (original: "${referralCode}")`)
    console.log(`   🏢 Organization ID: ${organizationId}`)
    
    let referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code, gift_card_id
      FROM square_existing_clients 
      WHERE organization_id = ${organizationId}::uuid
        AND (UPPER(TRIM(personal_code)) = ${normalizedCode} OR UPPER(TRIM(referral_code)) = ${normalizedCode})
      LIMIT 1
    `
    
    if (referrer && referrer.length > 0) {
      console.log(`   ✅ Found referrer with code "${normalizedCode}": ${referrer[0].given_name} ${referrer[0].family_name}`)
      return referrer[0]
    }
    
    referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code, gift_card_id
      FROM square_existing_clients 
      WHERE organization_id = ${organizationId}::uuid
        AND (personal_code = ${referralCode} OR referral_code = ${referralCode})
      LIMIT 1
    `
    
    if (referrer && referrer.length > 0) {
      console.log(`   ✅ Found referrer with exact match "${referralCode}": ${referrer[0].given_name} ${referrer[0].family_name}`)
      return referrer[0]
    }
    
    console.log(`   ❌ No referrer found with code "${referralCode}" or "${normalizedCode}"`)
    return null
  } catch (error) {
    console.error(`Error finding referrer by code ${referralCode}:`, error.message)
    console.error(`Stack trace:`, error.stack)
    return null
  }
}

async function upsertCustomerCustomAttribute(customerId, key, value, visibility = 'VISIBILITY_READ_ONLY') {
  if (!customerId || !key || value === undefined || value === null) {
    return
  }

  try {
    await customerCustomAttributesApi.upsertCustomerCustomAttribute(customerId, key, {
      customAttribute: {
        value,
        visibility
      }
    })
    console.log(`✅ Upserted custom attribute "${key}" for customer ${customerId}`)
  } catch (error) {
    console.error(`Error upserting custom attribute "${key}" for customer ${customerId}:`, error.message)
    if (error.errors) {
      console.error('Square API errors:', safeStringify(error.errors))
    }
  }
}

// Get booking custom attributes from Square (using Booking Custom Attributes API)
async function getBookingCustomAttributes(bookingId) {
  try {
    if (!bookingId) {
      return {}
    }
    
    console.log(`   Fetching booking custom attributes for booking ${bookingId}...`)
    
    // Verify the API instance is available
    if (!bookingCustomAttributesApi) {
      console.error(`   ❌ bookingCustomAttributesApi is not initialized`)
      return {}
    }
    
    const response = await bookingCustomAttributesApi.listBookingCustomAttributes(bookingId)
    
    console.log(`   Full booking custom attributes response:`, safeStringify(response.result))
    
    if (response.result && response.result.customAttributes) {
      const attributes = {}
      response.result.customAttributes.forEach(attr => {
        const value = attr.value?.stringValue || attr.value || ''
        attributes[attr.key] = value
        console.log(`   📋 Booking custom attribute: key="${attr.key}", value="${value}"`)
      })
      
      const referralCodeAttr = response.result.customAttributes.find(attr => 
        attr.key === 'referral_code' || 
        attr.key.toLowerCase().includes('referral') ||
        attr.key.toLowerCase().includes('ref')
      )
      
      if (referralCodeAttr) {
        const value = referralCodeAttr.value?.stringValue || referralCodeAttr.value || ''
        console.log(`   ✅ Found referral_code in booking custom attributes: key="${referralCodeAttr.key}", value="${value}"`)
      }
      
      return attributes
    }
    
    return {}
  } catch (error) {
    console.error(`Error getting booking custom attributes for booking ${bookingId}:`, error.message)
    if (error?.errors) {
      console.error('   Square API errors:', safeStringify(error.errors))
    }
    return {}
  }
}

async function getCustomerCustomAttributes(customerId) {
  try {
    const token = process.env.SQUARE_ACCESS_TOKEN?.trim() || ''
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token
    console.log(`   Fetching custom attributes for customer ${customerId}...`)
    console.log(`   [DEBUG] Token length: ${cleanToken.length}, Preview: ${cleanToken.substring(0, 10)}...`)
    
    // Verify the API instance is available
    if (!customerCustomAttributesApi) {
      console.error(`   ❌ customerCustomAttributesApi is not initialized`)
      return {}
    }
    
    // Log token status (first 10 chars only for security)
    const tokenPreview = process.env.SQUARE_ACCESS_TOKEN?.trim()?.substring(0, 10) || 'NOT_SET'
    console.log(`   🔑 Using Square token: ${tokenPreview}... (env: ${squareEnvironmentName})`)
    
    const response = await customerCustomAttributesApi.listCustomerCustomAttributes(customerId)
    
    console.log(`   Full custom attributes response:`, safeStringify(response.result))
    
    if (response.result && response.result.customAttributes) {
      const attributes = {}
      response.result.customAttributes.forEach(attr => {
        const value = attr.value?.stringValue || attr.value || ''
        attributes[attr.key] = value
        console.log(`   📋 Custom attribute: key="${attr.key}", value="${value}"`)
      })
      
      const referralCodeAttr = response.result.customAttributes.find(attr => 
        attr.key === 'referral_code' || 
        attr.key.toLowerCase().includes('referral') ||
        attr.key.toLowerCase().includes('ref')
      )
      
      if (referralCodeAttr) {
        const value = referralCodeAttr.value?.stringValue || referralCodeAttr.value || ''
        console.log(`   ✅ Found referral_code attribute: key="${referralCodeAttr.key}", value="${value}"`)
      }
      
      return attributes
    }
    
    return {}
  } catch (error) {
    console.error(`Error getting custom attributes for customer ${customerId}:`, error.message)
    
    // Enhanced error logging
    if (error?.response) {
      console.error(`   HTTP Status: ${error.response.statusCode || 'N/A'}`)
      console.error(`   Response Headers:`, safeStringify(error.response.headers))
    }
    
    if (error?.errors) {
      console.error('   Square API errors:', safeStringify(error.errors))
      
      // Check if it's a scope/permission issue
      const authError = error.errors.find(e => e.category === 'AUTHENTICATION_ERROR')
      if (authError) {
        console.error(`   ⚠️  Authentication error detected. This may indicate:`)
        console.error(`      - Token is missing required scopes (CUSTOMERS_READ or CUSTOMERS_WRITE)`)
        console.error(`      - Token has expired or been revoked`)
        console.error(`      - Token format is incorrect`)
        console.error(`      - Custom Attributes API requires additional permissions`)
        console.error(`   💡 Note: Try using Booking Custom Attributes API instead (see: https://developer.squareup.com/reference/square/booking-custom-attributes-api)`)
      }
    }
    
    // Log full error details for debugging
    console.error(`   Full error details:`, safeStringify({
      message: error.message,
      name: error.name,
      code: error.code,
      statusCode: error.response?.statusCode,
      errors: error.errors
    }))
    
    return {}
  }
}

async function fetchSquareCustomerProfile(customerId) {
  try {
    const response = await customersApi.retrieveCustomer(customerId)
    return response.result?.customer || null
  } catch (error) {
    console.error(`Error retrieving Square customer ${customerId}:`, error.message)
    if (error.errors) {
      console.error(`Square API errors:`, safeStringify(error.errors))
    }
    return null
  }
}

async function appendGiftCardNote(customerId, giftCardGan, amountCents, contextLabel) {
  if (!customerId || !giftCardGan) {
    return
  }

  try {
    const response = await customersApi.retrieveCustomer(customerId)
    const existingNote = response.result?.customer?.note?.trim() || ''
    const dollars = Number(amountCents || 0) / 100
    const amountDisplay = dollars.toFixed(2)
    const issuedOn = new Date().toISOString().split('T')[0]
    const noteLabel = contextLabel || 'Referral gift card'
    const noteEntry = `[${issuedOn}] ${noteLabel}: ${giftCardGan} ($${amountDisplay})`

    if (existingNote.includes(giftCardGan)) {
      console.log(`📝 Customer note already lists gift card ${giftCardGan}, skipping update`)
      return
    }

    const updatedNote = existingNote ? `${existingNote}\n${noteEntry}` : noteEntry

    await customersApi.updateCustomer(customerId, {
      note: updatedNote
    })

    console.log(`📝 Added gift card ${giftCardGan} to customer ${customerId} notes`)
  } catch (error) {
    console.error(`Error appending gift card note for customer ${customerId}:`, error.message)
    if (error.errors) {
      console.error(`Square API errors:`, safeStringify(error.errors))
    }
  }
}

async function appendReferralNote(customerId, referralCode, referralUrl) {
  if (!customerId || !referralCode || !referralUrl) {
    return
  }

  try {
    const response = await customersApi.retrieveCustomer(customerId)
    const existingNote = response.result?.customer?.note?.trim() || ''
    const issuedOn = new Date().toISOString().split('T')[0]
    const noteEntry = `[${issuedOn}] Personal referral code: ${referralCode} – ${referralUrl}`

    if (existingNote.includes(referralCode) || existingNote.includes(referralUrl)) {
      console.log(`📝 Customer note already lists referral code ${referralCode}, skipping update`)
      return
    }

    const updatedNote = existingNote ? `${existingNote}\n${noteEntry}` : noteEntry

    await customersApi.updateCustomer(customerId, {
      note: updatedNote
    })

    console.log(`📝 Added referral code ${referralCode} to customer ${customerId} notes`)
  } catch (error) {
    console.error(`Error appending referral note for customer ${customerId}:`, error.message)
    if (error.errors) {
      console.error(`Square API errors:`, safeStringify(error.errors))
    }
  }
}

async function createPromotionOrder(customerId, amountMoney, referenceLabel, locationId, options = {}) {
  if (!locationId || !amountMoney || !Number.isFinite(amountMoney.amount)) {
    return null
  }

  try {
    const { idempotencyKeySeed = null } = options || {}
    const idempotencySeed =
      idempotencyKeySeed ||
      buildIdempotencyKey(['promo-order', customerId || 'anon', amountMoney.amount || 0])
    const lineUid = `line-${Math.random().toString(36).slice(2, 10)}`
    const normalizedAmount = {
      amount: amountMoney.amount,
      currency: amountMoney.currency || 'USD'
    }
    const orderRequest = {
      idempotencyKey: buildIdempotencyKey([idempotencySeed, 'create']),
      order: {
        locationId,
        referenceId: referenceLabel?.slice(0, 60) || undefined,
        customerId: customerId || undefined,
        lineItems: [
          {
            uid: lineUid,
            name: referenceLabel?.slice(0, 60) || 'Referral promotion',
            quantity: '1',
            basePriceMoney: normalizedAmount,
            itemType: 'GIFT_CARD'
          }
        ]
      }
    }

    const orderResponse = await ordersApi.createOrder(orderRequest)
    const createdOrder = orderResponse.result?.order

    if (!createdOrder?.id) {
      console.warn('⚠️ Failed to create promotion order – proceeding without order reference')
      return null
    }

    return {
      orderId: createdOrder.id,
      lineItemUid: lineUid,
      amountMoney: normalizedAmount
    }
  } catch (error) {
    console.error('⚠️ Failed to create promotion order:', error.message)
    if (error.errors) {
      console.error('Square API errors:', safeStringify(error.errors))
    }
    return null
  }
}

async function completePromotionOrderPayment(orderId, amountMoney, locationId, referenceLabel, options = {}) {
  if (!orderId || !amountMoney || !Number.isFinite(amountMoney.amount) || !locationId) {
    return { success: false, reason: 'missing-data' }
  }

  try {
    const { idempotencyKeySeed = null } = options || {}
    const idempotencySeed =
      idempotencyKeySeed ||
      buildIdempotencyKey(['promo-payment', orderId, amountMoney.amount || 0])
    const paymentRequest = {
      idempotencyKey: buildIdempotencyKey([idempotencySeed, 'create']),
      sourceId: 'CASH',
      locationId,
      orderId,
      amountMoney,
      cashDetails: {
        buyerSuppliedMoney: amountMoney,
        changeBackMoney: { amount: 0, currency: amountMoney.currency || 'USD' }
      },
      note: referenceLabel ? referenceLabel.slice(0, 60) : undefined
    }

    const paymentResponse = await paymentsApi.createPayment(paymentRequest)
    const payment = paymentResponse.result?.payment

    if (payment?.status === 'COMPLETED') {
      console.log(`✅ Owner-funded payment recorded for order ${orderId} (payment ${payment.id})`)
      return { success: true, paymentId: payment.id }
    }

    console.warn(`⚠️ Payment for order ${orderId} did not complete (status: ${payment?.status ?? 'unknown'})`)
    return {
      success: false,
      paymentId: payment?.id ?? null,
      status: payment?.status ?? 'unknown'
    }
  } catch (error) {
    console.error(`⚠️ Failed to complete owner-funded payment for order ${orderId}:`, error.message)
    if (error.errors) {
      console.error('Square API errors:', safeStringify(error.errors))
    }
    return { success: false, error: error.message }
  }
}

// Helper function to save gift card to database
async function saveGiftCardToDatabase(giftCardData) {
  try {
    const {
      organization_id,
      square_customer_id,
      square_gift_card_id,
      gift_card_gan,
      reward_type,
      initial_amount_cents,
      current_balance_cents,
      gift_card_order_id,
      gift_card_line_item_uid,
      delivery_channel,
      activation_url,
      pass_kit_url,
      digital_email,
      state
    } = giftCardData

    // Resolve organization_id if not provided - look up from customer
    let orgId = organization_id
    if (!orgId && square_customer_id) {
      try {
        const customer = await prisma.$queryRaw`
          SELECT organization_id FROM square_existing_clients 
          WHERE square_customer_id = ${square_customer_id}
          LIMIT 1
        `
        if (customer && customer.length > 0) {
          orgId = customer[0].organization_id
        }
      } catch (lookupErr) {
        console.warn(`⚠️ Could not look up organization_id for customer ${square_customer_id}: ${lookupErr.message}`)
      }
    }
    
    // If still no organization_id, try to get from default organization
    if (!orgId) {
      try {
        const defaultOrg = await prisma.$queryRaw`
          SELECT id FROM organizations WHERE is_active = true ORDER BY created_at LIMIT 1
        `
        if (defaultOrg && defaultOrg.length > 0) {
          orgId = defaultOrg[0].id
          console.log(`ℹ️ Using default organization for gift card: ${orgId}`)
        }
      } catch (defaultOrgErr) {
        console.warn(`⚠️ Could not get default organization: ${defaultOrgErr.message}`)
      }
    }
    
    if (!orgId) {
      console.error(`❌ Cannot save gift card: organization_id is required but could not be resolved`)
      return null
    }

    // Upsert gift card record
    const giftCard = await prisma.giftCard.upsert({
      where: {
        organization_id_square_gift_card_id: {
          organization_id: orgId,
          square_gift_card_id: square_gift_card_id
        }
      },
      update: {
        current_balance_cents,
        delivery_channel,
        activation_url,
        pass_kit_url,
        digital_email,
        state,
        last_balance_check_at: new Date(),
        updated_at: new Date()
      },
      create: {
        organization_id: orgId,
        square_customer_id,
        square_gift_card_id,
        gift_card_gan,
        reward_type,
        initial_amount_cents: initial_amount_cents || 0,
        current_balance_cents: current_balance_cents || 0,
        gift_card_order_id,
        gift_card_line_item_uid,
        delivery_channel,
        activation_url,
        pass_kit_url,
        digital_email,
        state: state || 'PENDING',
        is_active: true
      }
    })

    return giftCard
  } catch (error) {
    console.error('Error saving gift card to database:', error.message)
    // Don't throw - this is a non-critical operation
    return null
  }
}

// Helper function to save gift card transaction to database
async function saveGiftCardTransaction(transactionData) {
  try {
    const {
      gift_card_id,
      organization_id,
      transaction_type,
      amount_cents,
      balance_before_cents,
      balance_after_cents,
      square_activity_id,
      square_order_id,
      square_payment_id,
      reason,
      context_label,
      metadata
    } = transactionData

    // Resolve organization_id from gift_card if not provided
    let resolvedOrganizationId = organization_id
    if (!resolvedOrganizationId && gift_card_id) {
      const giftCard = await prisma.giftCard.findUnique({
        where: { id: gift_card_id },
        select: { organization_id: true }
      })
      if (giftCard) {
        resolvedOrganizationId = giftCard.organization_id
      }
    }

    if (!resolvedOrganizationId) {
      console.error('❌ Cannot save gift card transaction: organization_id is required')
      return null
    }

    // Check if transaction already exists (idempotency)
    if (square_activity_id) {
      const existing = await prisma.giftCardTransaction.findFirst({
        where: { 
          square_activity_id,
          organization_id: resolvedOrganizationId
        }
      })
      if (existing) {
        console.log(`ℹ️ Transaction already exists for activity ${square_activity_id}, skipping`)
        return existing
      }
    }

    const transaction = await prisma.giftCardTransaction.create({
      data: {
        organization_id: resolvedOrganizationId,
        gift_card_id,
        transaction_type,
        amount_cents,
        balance_before_cents,
        balance_after_cents,
        square_activity_id,
        square_order_id,
        square_payment_id,
        reason,
        context_label,
        metadata: metadata ? JSON.parse(safeStringify(metadata)) : null
      }
    })

    return transaction
  } catch (error) {
    // Safe error logging - only log message, not full error object (might contain BigInt)
    console.error('Error saving gift card transaction to database:', error?.message || String(error))
    // Don't throw - this is a non-critical operation
    return null
  }
}

async function createGiftCard(customerId, customerName, amountCents = 1000, isReferrer = false, options = {}, organizationId = null) {
  try {
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    const noteContext = isReferrer ? 'Referrer reward gift card' : 'Signup bonus gift card'
    const amountMoney = {
      amount: Number.isFinite(amountCents) ? Math.trunc(amountCents) : 0,
      currency: 'USD'
    }
    const { orderInfo = null, idempotencyKeySeed = null } = options || {}
    const idempotencySeed =
      idempotencyKeySeed ||
      buildIdempotencyKey([
        'gift-card',
        isReferrer ? 'referrer' : 'friend',
        customerId || customerName || amountMoney.amount?.toString()
      ])
    
    const giftCardRequest = {
      idempotencyKey: buildIdempotencyKey([idempotencySeed, 'create']),
      locationId,
      giftCard: {
        type: 'DIGITAL',
        state: 'PENDING',
      }
    }

    let createResponse
    try {
      createResponse = await giftCardsApi.createGiftCard(giftCardRequest)
    } catch (createError) {
      console.error(`❌ Failed to create gift card via Square API:`, createError.message)
      if (createError.errors) {
        console.error('   Square API errors:', safeStringify(createError.errors))
      }
      throw createError
    }
    
    if (!createResponse.result.giftCard) {
      console.error(`❌ Failed to create gift card for ${customerName}`)
      return null
    }
    
    const giftCard = createResponse.result.giftCard
    const giftCardId = giftCard.id
    let giftCardGan = giftCard.gan || null // Ensure it's never undefined
    const giftCardState = giftCard.state || 'PENDING'
    console.log(`✅ Created gift card for ${customerName}: ${giftCardId}`)
    if (!giftCardGan) {
      console.log(`   ⚠️ GAN not yet assigned (card is ${giftCardState}), will be updated after activation`)
    }
    
    // Save CREATE transaction to database
    try {
      const createGiftCardRecord = await saveGiftCardToDatabase({
        organization_id: organizationId,
        square_customer_id: customerId,
        square_gift_card_id: giftCardId,
        gift_card_gan: giftCardGan, // Can be null if not yet assigned
        reward_type: isReferrer ? 'REFERRER_REWARD' : 'FRIEND_SIGNUP_BONUS',
        initial_amount_cents: amountCents,
        current_balance_cents: 0,
        state: giftCardState,
        is_active: true
      })

      if (createGiftCardRecord) {
        // Create CREATE transaction record
        await saveGiftCardTransaction({
          gift_card_id: createGiftCardRecord.id,
          transaction_type: 'CREATE',
          amount_cents: 0,
          balance_before_cents: 0,
          balance_after_cents: 0,
          context_label: noteContext,
          metadata: { square_response: giftCard }
        })
      }
    } catch (dbError) {
      console.error('Error saving gift card creation to database:', dbError.message)
      // Continue even if database save fails
    }
    
    let giftCardActivity = null
    let activityBalanceNumber = 0
    let activationChannel = null
    let successfulOrderInfo = null

    if (locationId && orderInfo?.orderId && orderInfo?.lineItemUid) {
      const egiftActivateRequest = {
        idempotencyKey: buildIdempotencyKey([idempotencySeed, 'activate-order', giftCardId]),
        giftCardActivity: {
          giftCardId: giftCardId,
          type: 'ACTIVATE',
          locationId: locationId,
          activateActivityDetails: {
            orderId: orderInfo.orderId,
            lineItemUid: orderInfo.lineItemUid,
            referenceId: noteContext
          }
        }
      }

      try {
        const activateResponse = await giftCardActivitiesApi.createGiftCardActivity(egiftActivateRequest)
        giftCardActivity = activateResponse.result?.giftCardActivity || null

        if (giftCardActivity) {
          const balanceAmount = giftCardActivity.giftCardBalanceMoney?.amount
          activityBalanceNumber = typeof balanceAmount === 'bigint' ? Number(balanceAmount) : (balanceAmount || 0)
          activationChannel = DELIVERY_CHANNELS.SQUARE_EGIFT_ORDER
          successfulOrderInfo = {
            orderId: orderInfo.orderId,
            lineItemUid: orderInfo.lineItemUid
          }

          console.log(`✅ Activated gift card via Square eGift order ${orderInfo.orderId}`)
        }
      } catch (activateError) {
        console.error(`❌ Order-based activation failed for gift card ${giftCardId}:`, activateError.message)
        if (activateError.errors) {
          console.error(`Square API errors:`, safeStringify(activateError.errors))
        }
      }
    }
    
    if (!giftCardActivity && locationId && amountMoney.amount > 0) {
      const activateRequest = {
        idempotencyKey: buildIdempotencyKey([idempotencySeed, 'activate-owner', giftCardId]),
        giftCardActivity: {
          giftCardId: giftCardId,
          type: 'ACTIVATE',
          locationId: locationId,
          activateActivityDetails: {
            amountMoney,
            referenceId: noteContext,
            buyerPaymentInstrumentIds: ['OWNER_FUNDED']
          }
        }
      }

      try {
        const activateResponse = await giftCardActivitiesApi.createGiftCardActivity(activateRequest)
        const activity = activateResponse.result?.giftCardActivity || null

        if (activity) {
          giftCardActivity = activity
          const balanceAmount = activity.giftCardBalanceMoney?.amount
          activityBalanceNumber =
            typeof balanceAmount === 'bigint'
              ? Number(balanceAmount)
              : (balanceAmount || 0)
          activationChannel = DELIVERY_CHANNELS.OWNER_FUNDED_ACTIVATE

          console.log(`✅ Activated gift card for ${customerName}`)
          console.log(`   Activity ID: ${activity.id}`)
          console.log(`   Balance after activation: $${activityBalanceNumber / 100}`)
        } else {
          console.error(`❌ Gift card activation response missing activity for ${giftCardId}`)
        }
      } catch (activateError) {
        console.error(`❌ Error activating gift card ${giftCardId}:`, activateError.message)
        if (activateError.errors) {
          console.error(`Square API errors:`, safeStringify(activateError.errors))
        }
      }
    }

    if (!giftCardActivity && locationId && amountMoney.amount > 0) {
      const adjustRequest = {
        idempotencyKey: buildIdempotencyKey([idempotencySeed, 'adjust-increment', giftCardId]),
        giftCardActivity: {
          giftCardId: giftCardId,
          type: 'ADJUST_INCREMENT',
          locationId: locationId,
          adjustIncrementActivityDetails: {
            amountMoney,
            reason: noteContext
          }
        }
      }

      try {
        const adjustResponse = await giftCardActivitiesApi.createGiftCardActivity(adjustRequest)
        const activity = adjustResponse.result?.giftCardActivity || null

        if (activity) {
          giftCardActivity = activity
          const balanceAmount = activity.giftCardBalanceMoney?.amount
          activityBalanceNumber =
            typeof balanceAmount === 'bigint'
              ? Number(balanceAmount)
              : (balanceAmount || 0)
          activationChannel = DELIVERY_CHANNELS.OWNER_FUNDED_ADJUST

          console.log(`✅ Adjusted gift card for ${customerName}`)
          console.log(`   Activity ID: ${activity.id}`)
          if (activityBalanceNumber) {
            console.log(`   Balance after adjustment: $${activityBalanceNumber / 100}`)
          }
        }
      } catch (adjustError) {
        console.error(`❌ ADJUST_INCREMENT failed for gift card ${giftCardId}:`, adjustError.message)
        if (adjustError.errors) {
          console.error(`Square API errors:`, safeStringify(adjustError.errors))
        }
      }
    }

    if (customerId && giftCardGan) {
      const linkRequest = {
        customerId: customerId
      }
      
      try {
        await giftCardsApi.linkCustomerToGiftCard(giftCardId, linkRequest)
        console.log(`✅ Linked gift card ${giftCardId} to customer ${customerId}`)
        console.log(`   Gift card will now appear in customer's profile in Square`)
      } catch (linkError) {
        console.warn(`⚠️ Failed to link gift card to customer (non-critical): ${linkError.message}`)
        if (linkError.errors) {
          console.warn(`Square API errors:`, safeStringify(linkError.errors))
        }
      }
    }

    let activationUrl = null
    let passKitUrl = null
    let digitalEmail = null

    try {
      const verify = await giftCardsApi.retrieveGiftCard(giftCardId)
      const verifyCard = verify.result.giftCard
      const verifyBalance = verifyCard.balanceMoney?.amount
      const verifyBalanceNumber =
        typeof verifyBalance === 'bigint' ? Number(verifyBalance) : (verifyBalance || 0)

      if (verifyBalanceNumber) {
        activityBalanceNumber = verifyBalanceNumber
      }

      if (verifyCard?.digitalDetails) {
        activationUrl = verifyCard.digitalDetails.activationUrl || null
        passKitUrl = verifyCard.digitalDetails.passKitUrl || null
        digitalEmail = verifyCard.digitalDetails.email || null
      }

      console.log('📋 Verification:')
      console.log(`   State: ${verifyCard.state}`)
      console.log(`   Balance: $${activityBalanceNumber / 100}`)
      if (activationUrl) {
        console.log(`   Activation URL: ${activationUrl}`)
      }
      if (passKitUrl) {
        console.log(`   PassKit URL: ${passKitUrl}`)
      }

      // Update gift card record with final details
      try {
        const updatedGiftCard = await prisma.giftCard.updateMany({
          where: { square_gift_card_id: giftCardId },
          data: {
            current_balance_cents: activityBalanceNumber,
            activation_url: activationUrl,
            pass_kit_url: passKitUrl,
            digital_email: digitalEmail,
            gift_card_gan: giftCardGan, // Update in case it changed
            state: verifyCard.state || giftCardState,
            last_balance_check_at: new Date(),
            updated_at: new Date()
          }
        })

        // Save ACTIVATE or ADJUST_INCREMENT transaction if activity occurred
        if (giftCardActivity) {
          const activityType = giftCardActivity.type
          const transactionType = activityType === 'ACTIVATE' ? 'ACTIVATE' : 
                                  activityType === 'ADJUST_INCREMENT' ? 'ADJUST_INCREMENT' : 
                                  null

          if (transactionType) {
            // Resolve organization_id from saved gift card record or customer
            let giftCardOrgId = createGiftCardRecord?.organization_id || null
            if (!giftCardOrgId && customerId) {
              const customerOrg = await prisma.$queryRaw`
                SELECT organization_id FROM square_existing_clients 
                WHERE square_customer_id = ${customerId} 
                LIMIT 1
              `
              giftCardOrgId = customerOrg?.[0]?.organization_id || null
            }
            
            const giftCardRecord = giftCardOrgId
              ? await prisma.giftCard.findFirst({
                  where: {
                    organization_id: giftCardOrgId,
                    square_gift_card_id: giftCardId
                  }
                })
              : await prisma.giftCard.findFirst({
                  where: { square_gift_card_id: giftCardId }
                })

            if (giftCardRecord) {
              await saveGiftCardTransaction({
                gift_card_id: giftCardRecord.id,
                organization_id: giftCardRecord.organization_id,
                transaction_type: transactionType,
                amount_cents: amountCents,
                balance_before_cents: 0,
                balance_after_cents: activityBalanceNumber,
                square_activity_id: giftCardActivity.id,
                square_order_id: successfulOrderInfo?.orderId || null,
                reason: noteContext.includes('Referrer') ? 'COMPLIMENTARY' : 'FRIEND_BONUS',
                context_label: noteContext,
                metadata: { 
                  square_activity: giftCardActivity,
                  activation_channel: activationChannel
                }
              })
            }
          }
        }
      } catch (dbError) {
        console.error('Error updating gift card in database:', dbError.message)
        // Continue even if database update fails
      }
    } catch (verifyError) {
      console.error(`⚠️ Unable to verify gift card ${giftCardId}:`, verifyError.message)
    }

    if (giftCardActivity && amountMoney.amount > 0 && customerId && giftCardGan) {
      await appendGiftCardNote(customerId, giftCardGan, amountMoney.amount, noteContext)
    }

    if (giftCardGan) {
      queueWalletPassUpdate(giftCardGan, {
        prisma,
        reason: 'gift-card-created'
      })
    }

    return {
      giftCardId,
      giftCardGan,
      activationChannel,
      orderId: successfulOrderInfo?.orderId || null,
      lineItemUid: successfulOrderInfo?.lineItemUid || null,
      activationUrl,
      passKitUrl,
      digitalEmail,
      balanceCents: activityBalanceNumber,
      amountCents: amountMoney.amount
    }
  } catch (error) {
    console.error(`❌ Error creating/loading gift card for ${customerName}:`, error.message)
    if (error.errors) {
      console.error(`Square API errors:`, safeStringify(error.errors))
    }
    return null
  }
}

async function loadGiftCard(
  giftCardId,
  amountCents = 1000,
  customerId = null,
  contextLabel = 'Referrer reward gift card load',
  options = {}
) {
  try {
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    const amountMoney = {
      amount: Number.isFinite(amountCents) ? Math.trunc(amountCents) : 0,
      currency: 'USD'
    }
    const { idempotencyKeySeed = null } = options || {}
    const idempotencySeed =
      idempotencyKeySeed ||
      buildIdempotencyKey(['load-gift-card', giftCardId, amountCents || 0])
    
    if (!locationId) {
      console.error('❌ Cannot load gift card – SQUARE_LOCATION_ID is missing')
      return { success: false, error: 'Missing location ID' }
    }

    const cardResponse = await giftCardsApi.retrieveGiftCard(giftCardId)
    const giftCard = cardResponse.result?.giftCard

    if (!giftCard) {
      console.error(`❌ Gift card ${giftCardId} not found in Square`)
      return { success: false, error: 'Gift card not found' }
    }

    const giftCardGan = giftCard.gan
    const cardState = giftCard.state
    const balanceBefore = giftCard.balanceMoney?.amount
    const balanceBeforeCents = typeof balanceBefore === 'bigint' ? Number(balanceBefore) : (balanceBefore || 0)
    
    let activity = null
    let resultingBalance = 0
    let deliveryChannel = null
    let transactionType = null

    if (cardState === 'PENDING') {
      if (!locationId) {
        console.error('❌ Cannot activate gift card – SQUARE_LOCATION_ID is missing')
        return { success: false, error: 'Missing location ID' }
      }

      const activateRequest = {
        idempotencyKey: buildIdempotencyKey([idempotencySeed, 'activate', giftCardId]),
        giftCardActivity: {
          giftCardId,
          type: 'ACTIVATE',
          locationId,
          activateActivityDetails: {
            amountMoney,
            referenceId: contextLabel,
            buyerPaymentInstrumentIds: ['OWNER_FUNDED']
          }
        }
      }

      const activateResponse = await giftCardActivitiesApi.createGiftCardActivity(activateRequest)
      activity = activateResponse.result?.giftCardActivity || null
      deliveryChannel = DELIVERY_CHANNELS.OWNER_FUNDED_ACTIVATE
      transactionType = 'ACTIVATE'
    } else {
      const adjustRequest = {
        idempotencyKey: buildIdempotencyKey([idempotencySeed, 'adjust', giftCardId]),
        giftCardActivity: {
          giftCardId,
          type: 'ADJUST_INCREMENT',
          locationId: locationId,
          adjustIncrementActivityDetails: {
            amountMoney,
            reason: 'COMPLIMENTARY'
          }
        }
      }

      const adjustResponse = await giftCardActivitiesApi.createGiftCardActivity(adjustRequest)
      activity = adjustResponse.result?.giftCardActivity || null
      deliveryChannel = DELIVERY_CHANNELS.OWNER_FUNDED_ADJUST
      transactionType = 'ADJUST_INCREMENT'
    }

    if (activity) {
      const balanceAmount = activity.giftCardBalanceMoney?.amount
      resultingBalance = typeof balanceAmount === 'bigint' ? Number(balanceAmount) : (balanceAmount || 0)

      // Save transaction to database
      try {
        // Resolve organization_id from customer if available
        let giftCardOrgId = null
        if (customerId) {
          const customerOrg = await prisma.$queryRaw`
            SELECT organization_id FROM square_existing_clients 
            WHERE square_customer_id = ${customerId} 
            LIMIT 1
          `
          giftCardOrgId = customerOrg?.[0]?.organization_id || null
        }
        
        // Find the gift card record in our database
        const giftCardRecord = giftCardOrgId
          ? await prisma.giftCard.findFirst({
              where: {
                organization_id: giftCardOrgId,
                square_gift_card_id: giftCardId
              }
            })
          : await prisma.giftCard.findFirst({
              where: { square_gift_card_id: giftCardId }
            })

        if (giftCardRecord) {
          // Save the transaction
          await saveGiftCardTransaction({
            gift_card_id: giftCardRecord.id,
            organization_id: giftCardRecord.organization_id,
            transaction_type: transactionType,
            amount_cents: amountCents,
            balance_before_cents: balanceBeforeCents,
            balance_after_cents: resultingBalance,
            square_activity_id: activity.id,
            reason: 'COMPLIMENTARY',
            context_label: contextLabel,
            metadata: {
              square_activity: activity,
              delivery_channel: deliveryChannel
            }
          })

          // Update gift card record with new balance
          await prisma.giftCard.update({
            where: { id: giftCardRecord.id },
            data: {
              current_balance_cents: resultingBalance,
              state: cardState === 'PENDING' ? 'ACTIVE' : cardState,
              last_balance_check_at: new Date(),
              updated_at: new Date()
            }
          })
        } else {
          console.warn(`⚠️ Gift card ${giftCardId} not found in database, skipping transaction save`)
        }
      } catch (dbError) {
        console.error('Error saving gift card load transaction to database:', dbError.message)
        // Continue even if database save fails
      }

      let activationUrl = null
      let passKitUrl = null
      let digitalEmail = null

      try {
        const verify = await giftCardsApi.retrieveGiftCard(giftCardId)
        const verifyCard = verify.result?.giftCard
        const digitalDetails = verifyCard?.digitalDetails
        if (digitalDetails) {
          activationUrl = digitalDetails.activationUrl || null
          passKitUrl = digitalDetails.passKitUrl || null
          digitalEmail = digitalDetails.email || null
        }
      } catch (verifyError) {
        console.warn(`⚠️ Unable to refresh digital details for gift card ${giftCardId}:`, verifyError.message)
      }

      console.log(`✅ Loaded $${amountCents / 100} onto gift card ${giftCardId}`)
      console.log(`   Balance after operation: $${resultingBalance / 100}`)

      if (customerId && giftCardGan) {
        await appendGiftCardNote(
          customerId,
          giftCardGan,
          amountCents,
          contextLabel || 'Referrer reward gift card load'
        )
      }

      queueWalletPassUpdate(giftCardGan, {
        prisma,
        reason: 'gift-card-balance-update'
      })

      return {
        success: true,
        giftCardId,
        deliveryChannel,
        balanceCents: resultingBalance,
        giftCardGan,
        activationUrl,
        passKitUrl,
        digitalEmail
      }
    }

    return { success: false, error: 'No gift card activity returned' }
  } catch (error) {
    console.error(`❌ Error loading gift card ${giftCardId}:`, error.message)
    if (error.errors) {
      console.error(`Square API errors:`, safeStringify(error.errors))
    }
    return { success: false, error: error.message }
  }
}


async function sendReferralCodeToNewClient(customerId, customerName, email, phoneNumber) {
  try {
    const customerData = await prisma.$queryRaw`
      SELECT gift_card_id, got_signup_bonus, referral_email_sent, personal_code, activated_as_referrer,
             gift_card_order_id, gift_card_line_item_uid, gift_card_delivery_channel,
             gift_card_activation_url, gift_card_pass_kit_url, gift_card_digital_email,
             phone_number, referral_sms_sent, referral_sms_sent_at, referral_sms_sid
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    if (customerData && customerData.length > 0 && customerData[0].referral_email_sent) {
      console.log(`⚠️ Referral email already sent to ${customerName}, skipping...`)
      return { success: true, alreadySent: true }
    }
    
    let referralCode = null
    if (customerData && customerData.length > 0 && customerData[0].personal_code) {
      referralCode = customerData[0].personal_code
      console.log(`✅ Using existing personal_code: ${referralCode}`)
    } else {
      referralCode = await generateUniquePersonalCode(customerName, customerId)
      console.log(`✅ Generated new personal_code in name+ID format: ${referralCode}`)
    }
    
    let referralUrl = generateReferralUrl(referralCode)
    
    let referrerGiftCardId = null
    let referrerGiftCardMeta = null
    const existingRecord = customerData?.[0]
    const fallbackPhone = existingRecord ? cleanValue(existingRecord.phone_number) : null
    const smsDestination = phoneNumber || fallbackPhone
    const smsAlreadySent = Boolean(existingRecord?.referral_sms_sent)
    
    if (customerData && customerData.length > 0) {
      const customer = customerData[0]
      
      if (customer.gift_card_id) {
        referrerGiftCardId = customer.gift_card_id
        referrerGiftCardMeta = {
          orderId: customer.gift_card_order_id,
          lineItemUid: customer.gift_card_line_item_uid,
          activationChannel: customer.gift_card_delivery_channel,
          activationUrl: customer.gift_card_activation_url,
          passKitUrl: customer.gift_card_pass_kit_url,
          digitalEmail: customer.gift_card_digital_email
        }
        console.log(`✅ Customer already has gift card: ${referrerGiftCardId}`)
      } else {
        const pendingOrderInfo =
          customer.gift_card_order_id && customer.gift_card_line_item_uid
            ? {
                orderId: customer.gift_card_order_id,
                lineItemUid: customer.gift_card_line_item_uid
              }
            : null
        const referrerGiftCard = await createGiftCard(
          customerId, 
          customerName, 
          0,
          true,
          pendingOrderInfo ? { orderInfo: pendingOrderInfo } : {}
        )
        if (referrerGiftCard?.giftCardId) {
          referrerGiftCardId = referrerGiftCard.giftCardId
          referrerGiftCardMeta = referrerGiftCard
          console.log(`✅ Created new referrer gift card: ${referrerGiftCardId}`)
        } else {
          console.error('❌ Failed to create referrer gift card')
        }
      }
    }
    
    await upsertCustomerCustomAttribute(customerId, REFERRAL_CODE_ATTRIBUTE_KEY, referralCode)
    await appendReferralNote(customerId, referralCode, referralUrl)

    try {
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET 
          personal_code = ${referralCode},
          referral_url = ${referralUrl},
          activated_as_referrer = TRUE,
          got_signup_bonus = TRUE,
          referral_email_sent = TRUE,
          updated_at = NOW()
        WHERE square_customer_id = ${customerId}
      `
    } catch (updateError) {
      // Handle duplicate key error (race condition - code was taken between check and update)
      if (updateError.code === '23505' && updateError.message?.includes('personal_code')) {
        console.warn(`⚠️ Personal code ${referralCode} was taken by another process, generating new one...`)
        
        // Retry up to 3 times with new codes
        let retrySuccess = false
        for (let retryAttempt = 0; retryAttempt < 3; retryAttempt++) {
          try {
            // Generate a new unique code
            referralCode = await generateUniquePersonalCode(customerName, customerId)
            referralUrl = generateReferralUrl(referralCode)
            
            // Update custom attribute and note with new code
            await upsertCustomerCustomAttribute(customerId, REFERRAL_CODE_ATTRIBUTE_KEY, referralCode)
            await appendReferralNote(customerId, referralCode, referralUrl)
            
            // Retry the update
            await prisma.$executeRaw`
              UPDATE square_existing_clients 
              SET 
                personal_code = ${referralCode},
                referral_url = ${referralUrl},
                activated_as_referrer = TRUE,
                got_signup_bonus = TRUE,
                referral_email_sent = TRUE,
                updated_at = NOW()
              WHERE square_customer_id = ${customerId}
            `
            console.log(`✅ Retried with new unique code: ${referralCode}`)
            retrySuccess = true
            break
          } catch (retryError) {
            if (retryError.code === '23505' && retryError.message?.includes('personal_code')) {
              console.warn(`⚠️ Retry attempt ${retryAttempt + 1} also failed with duplicate code, trying again...`)
              continue
            } else {
              throw retryError
            }
          }
        }
        
        if (!retrySuccess) {
          console.error(`❌ Failed to save personal_code after 3 retry attempts`)
          // Don't throw - log error but continue (code generation is not critical for payment processing)
          console.warn(`⚠️ Continuing without personal_code - customer will need manual code assignment`)
        }
      } else {
        throw updateError
      }
    }
    
    if (referrerGiftCardId) {
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET 
          gift_card_id = ${referrerGiftCardId},
          gift_card_gan = ${referrerGiftCardMeta?.giftCardGan ?? null},
          gift_card_order_id = ${referrerGiftCardMeta?.orderId ?? null},
          gift_card_line_item_uid = ${referrerGiftCardMeta?.lineItemUid ?? null},
          gift_card_delivery_channel = ${referrerGiftCardMeta?.activationChannel ?? null},
          gift_card_activation_url = ${referrerGiftCardMeta?.activationUrl ?? null},
          gift_card_pass_kit_url = ${referrerGiftCardMeta?.passKitUrl ?? null},
          gift_card_digital_email = ${referrerGiftCardMeta?.digitalEmail ?? null},
          updated_at = NOW()
        WHERE square_customer_id = ${customerId}
      `
    }
    
    if (email) {
      const emailResult = await sendReferralCodeEmail(customerName, email, referralCode, referralUrl)
      
      if (emailResult.success) {
        if (emailResult.skipped) {
          console.log(`⏸️ Email sending is disabled (skipped sending to ${email})`)
        } else {
          console.log(`✅ Referral email sent successfully to ${email}`)
        }
      } else {
        console.error(`❌ Failed to send email: ${emailResult.error}`)
      }
    }
    
    // Check if SMS sending is disabled
    const smsDisabled = process.env.DISABLE_SMS_SENDING === 'true' || process.env.SMS_ENABLED === 'false'
    
    if (smsDisabled) {
      console.log('ℹ️ Referral SMS sending is disabled (DISABLE_SMS_SENDING or SMS_ENABLED=false)')
    } else if (!smsDestination) {
      console.log('ℹ️ Referral SMS not sent — missing phone number')
    } else if (smsAlreadySent) {
      console.log('ℹ️ Referral SMS already sent previously, skipping duplicate send.')
    } else {
      const smsResult = await sendReferralCodeSms({
        to: smsDestination,
        name: customerName,
        referralUrl,
        body: REFERRAL_SMS_TEMPLATE
      })

      if (smsResult.success) {
        if (smsResult.skipped) {
          console.log(`⏸️ SMS sending disabled (skipped sending to ${smsDestination})`)
        } else {
          console.log(`📲 Referral SMS sent to ${smsDestination}`)
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET referral_sms_sent = TRUE,
                referral_sms_sent_at = NOW(),
                referral_sms_sid = ${smsResult.sid ?? null},
                updated_at = NOW()
            WHERE square_customer_id = ${customerId}
          `
        }
      } else {
        console.error(`❌ Failed to send SMS to ${smsDestination}: ${smsResult.error || smsResult.reason}`)
      }
    }
    
    console.log(`📧 Referral code generated and sent:`)
    console.log(`   - Customer: ${customerName}`)
    console.log(`   - Email: ${email}`)
    console.log(`   - Referral Code: ${referralCode}`)
    console.log(`   - Referral URL: ${referralUrl}`)
    console.log(`   - Gift Card ID: ${referrerGiftCardId}`)
    console.log(`   - Status: Customer is now a referrer`)
    return { success: true, referralCode, referralUrl, giftCardId: referrerGiftCardId }
  } catch (error) {
    console.error(`Error sending referral code to new client:`, error.message)
    return { success: false, error: error.message }
  }
}

async function isNewCustomer(customerId) {
  try {
    const existingCustomer = await prisma.$queryRaw`
      SELECT square_customer_id FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    if (!existingCustomer || existingCustomer.length === 0) {
      return true
    }
    
    // Check BOTH flags: if they're an activated referrer OR got signup bonus, they're not new
    const customerData = await prisma.$queryRaw`
      SELECT got_signup_bonus, activated_as_referrer FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    const customer = customerData[0]
    // Customer is NOT new if they're an activated referrer OR got signup bonus
    if (customer.activated_as_referrer || customer.got_signup_bonus) {
      return false
    }
    
    // Otherwise, they're still new (created but no bonus/referrer status yet)
    return true
  } catch (error) {
    console.error(`Error checking if customer ${customerId} is new:`, error.message)
    return false
  }
}

// Main processor function: Process customer creation
async function processCustomerCreated(customerData, request, runContext = {}) {
  try {
    console.log('📥 Received customer data:', safeStringify(customerData))
    
    const customerId = customerData.id || customerData.customerId || customerData.customer_id
    if (!customerId) {
      console.log('No customer ID in customer data, skipping...')
      return
    }

    if (runContext?.correlationId) {
      await updateGiftCardRunStage(prisma, runContext.correlationId, {
        stage: 'customer_ingest:start',
        status: 'running',
        payload: customerData,
        context: { customerId }
      })
    }

    console.log(`👤 Processing customer creation: ${customerId}`)
    let givenName = cleanValue(
      customerData.givenName ??
      customerData.given_name ??
      customerData.firstName ??
      customerData.first_name
    )
    let familyName = cleanValue(
      customerData.familyName ??
      customerData.family_name ??
      customerData.lastName ??
      customerData.last_name
    )
    let emailAddress = cleanValue(
      customerData.emailAddress ??
      customerData.email_address ??
      customerData.email
    )
    let phoneNumber = cleanValue(
      customerData.phoneNumber ??
      customerData.phone_number ??
      customerData.phone
    )

    if (!givenName || !familyName || !emailAddress || !phoneNumber) {
      const squareCustomer = await fetchSquareCustomerProfile(customerId)
      if (squareCustomer) {
        givenName = givenName || cleanValue(squareCustomer.givenName)
        familyName = familyName || cleanValue(squareCustomer.familyName)
        emailAddress = emailAddress || cleanValue(squareCustomer.emailAddress)
        phoneNumber = phoneNumber || cleanValue(squareCustomer.phoneNumber)
      }
    }

    console.log(`📧 Email: ${emailAddress || 'None'}`)
    console.log(`📞 Phone: ${phoneNumber || 'None'}`)
    console.log(`👤 Name: ${givenName || ''} ${familyName || ''}`)

    const isNew = await isNewCustomer(customerId)
    if (!isNew) {
      console.log(`ℹ️ Customer ${customerId} is not new, skipping...`)
      return
    }

    console.log(`🎉 New customer detected: ${customerId}`)

    // Get organization_id from context or resolve from merchant_id
    const organizationId = await getOrganizationId(runContext?.context || {})
    
    if (!organizationId || typeof organizationId !== 'string' || organizationId.length === 0) {
      throw new Error(`Invalid organization_id resolved: ${organizationId}`)
    }
    
    console.log(`✅ Using organization_id: ${organizationId}`)

    await prisma.$executeRaw`
      INSERT INTO square_existing_clients (
        organization_id,
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        got_signup_bonus,
        activated_as_referrer,
        personal_code,
        gift_card_id,
        used_referral_code,
        referral_email_sent,
        created_at,
        updated_at
      ) VALUES (
        ${organizationId}::uuid,
        ${customerId},
        ${givenName},
        ${familyName},
        ${emailAddress},
        ${phoneNumber},
        FALSE,
        FALSE,
        NULL,
        NULL,
        NULL,
        FALSE,
        NOW(),
        NOW()
      )
      ON CONFLICT (organization_id, square_customer_id) DO UPDATE SET
        organization_id = COALESCE(square_existing_clients.organization_id, EXCLUDED.organization_id),
        given_name = COALESCE(square_existing_clients.given_name, EXCLUDED.given_name),
        family_name = COALESCE(square_existing_clients.family_name, EXCLUDED.family_name),
        email_address = COALESCE(square_existing_clients.email_address, EXCLUDED.email_address),
        phone_number = COALESCE(square_existing_clients.phone_number, EXCLUDED.phone_number),
        updated_at = NOW()
    `

    console.log(`✅ Customer added to database as NEW (temporary mark)`)
    console.log(`   - Will check for referral code when they book`)
    console.log(`   - Will give gift card on first booking if code found`)
    
    const verifyCustomer = await prisma.$queryRaw`
      SELECT * FROM square_existing_clients WHERE square_customer_id = ${customerId}
    `
    console.log(`✅ Verification: Customer found in DB:`, verifyCustomer.length > 0)

    if (runContext?.correlationId) {
      await updateGiftCardRunStage(prisma, runContext.correlationId, {
        stage: 'customer_ingest:completed',
        status: 'completed',
        clearError: true
      })
    }

  } catch (error) {
    console.error('❌ Error processing customer creation:', error)
    console.error('Stack trace:', error.stack)
    if (runContext?.correlationId) {
      await markGiftCardRunError(prisma, runContext.correlationId, error, {
        stage: 'customer_ingest:error'
      })
    }
    throw error
  }
}

// Main processor function: Process payment completion
async function processPaymentCompletion(paymentData, runContext = {}) {
  let paymentHadError = false
  try {
    const customerId = paymentData.customerId || paymentData.customer_id
    if (!customerId) {
      console.log('No customer ID in payment data, skipping...')
      console.log('Payment data received:', safeStringify(paymentData))
      return
    }

    if (runContext?.correlationId) {
      await updateGiftCardRunStage(prisma, runContext.correlationId, {
        stage: 'payment:received',
        status: 'running',
        payload: paymentData,
        context: { customerId }
      })
    }

    console.log(`💰 Processing payment completion for customer: ${customerId}`)
    console.log(`   Payment source_type: ${paymentData.source_type || 'unknown'}`)
    console.log(`   Payment tender_types: ${safeStringify(paymentData.tender || [])}`)

    const customerData = await prisma.$queryRaw`
      SELECT square_customer_id, used_referral_code, got_signup_bonus, gift_card_id, 
             given_name, family_name, email_address, first_payment_completed, organization_id
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `

    if (!customerData || customerData.length === 0) {
      console.log(`Customer ${customerId} not found in database`)
      return
    }

    const customer = customerData[0]
    const organizationId = customer.organization_id
    
    if (!organizationId) {
      console.warn(`⚠️ Cannot resolve organization_id for customer ${customerId}, skipping payment processing`)
      return
    }
    
    // Check if this is their first payment
    const isFirstPayment = !customer.first_payment_completed
    
    if (isFirstPayment) {
      console.log(`🎉 First payment completed for customer: ${customer.given_name} ${customer.family_name}`)
    } else {
      console.log(`ℹ️ Customer ${customerId} already marked as completed first payment`)
      // Even if already marked, we should check if referrer reward was given
      // This handles cases where the flag was set incorrectly or reward processing failed
    }
    
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    
    if (customer.used_referral_code) {
      console.log(`🎯 Customer used referral code: ${customer.used_referral_code}`)
      const referrer = await findReferrerByCode(customer.used_referral_code, organizationId)
      if (referrer) {
        console.log(`👤 Found referrer: ${referrer.given_name} ${referrer.family_name}`)

        // Check if referrer reward was already given for this specific friend
        // Using ReferralReward table for robust duplicate check (instead of just counting)
        const existingReward = await prisma.$queryRaw`
          SELECT id FROM referral_rewards
          WHERE referrer_customer_id = ${referrer.square_customer_id}
            AND referred_customer_id = ${customerId}
            AND organization_id = ${organizationId}::uuid
          LIMIT 1
        `
        
        const rewardAlreadyGiven = existingReward && existingReward.length > 0
        
        if (!rewardAlreadyGiven) {
          console.log(`   ✅ Referrer reward not yet given for this friend, will process`)
        } else {
          console.log(`   ℹ️ Referrer reward already given for this friend, skipping duplicate reward`)
        }

        const referrerData = await prisma.$queryRaw`
          SELECT square_customer_id, total_rewards, gift_card_id, total_referrals,
                 gift_card_order_id, gift_card_line_item_uid, gift_card_delivery_channel,
                 gift_card_activation_url, gift_card_pass_kit_url, gift_card_digital_email
          FROM square_existing_clients 
          WHERE square_customer_id = ${referrer.square_customer_id}
        `

        if (referrerData && referrerData.length > 0) {
          const referrerInfo = referrerData[0]
          
          // Skip reward processing if it was already given
          if (rewardAlreadyGiven) {
            console.log(`   ℹ️ Skipping referrer reward - already processed`)
            // Continue to send referral code to new client
          } else if (!referrerInfo.gift_card_id) {
            const rewardAmountCents = 1000
            const rewardAmountMoney = { amount: rewardAmountCents, currency: 'USD' }
            let orderInfoForActivation = null

            if (locationId) {
              const promotionOrder = await createPromotionOrder(
                referrer.square_customer_id,
                rewardAmountMoney,
                'Referrer reward $10',
                locationId,
                runContext?.correlationId
                  ? { idempotencyKeySeed: buildStageKey(runContext.correlationId, 'referrer_reward', 'promo-order') }
                  : {}
              )

              if (promotionOrder?.orderId && promotionOrder?.lineItemUid) {
                const paymentResult = await completePromotionOrderPayment(
                  promotionOrder.orderId,
                  promotionOrder.amountMoney,
                  locationId,
                  'Referrer reward gift card',
                  runContext?.correlationId
                    ? { idempotencyKeySeed: buildStageKey(runContext.correlationId, 'referrer_reward', 'promo-payment') }
                    : {}
                )

                if (paymentResult.success) {
                  orderInfoForActivation = {
                    orderId: promotionOrder.orderId,
                    lineItemUid: promotionOrder.lineItemUid
                  }
                } else {
                  console.warn('⚠️ Owner-funded payment failed for referrer reward order, falling back to owner-funded activation')
                }
              } else {
                console.warn('⚠️ Failed to create referrer reward order, falling back to owner-funded activation')
              }
            } else {
              console.warn('⚠️ SQUARE_LOCATION_ID missing – cannot create eGift order for referrer reward')
            }

            if (runContext?.correlationId) {
              await updateGiftCardRunStage(prisma, runContext.correlationId, {
                stage: 'referrer_reward:issuing',
                status: 'running',
                incrementAttempts: true,
                context: {
                  customerId,
                  referrerId: referrer.square_customer_id
                }
              })
            }

            const referrerGiftCardOptions = {
              orderInfo: orderInfoForActivation || undefined,
              idempotencyKeySeed: runContext?.correlationId
                ? buildStageKey(runContext.correlationId, 'referrer_reward', 'issue')
                : undefined
            }

            const referrerGiftCard = await createGiftCard(
              referrer.square_customer_id, 
              `${referrer.given_name} ${referrer.family_name}`, 
              rewardAmountCents,
              true,
              referrerGiftCardOptions
            )

            if (referrerGiftCard?.giftCardId) {
              // Create ReferralReward record first to ensure idempotency
              try {
                await prisma.referralReward.create({
                  data: {
                    id: crypto.randomUUID(),
                    organization_id: organizationId,
                    referrer_customer_id: referrer.square_customer_id,
                    referred_customer_id: customerId,
                    reward_amount_cents: rewardAmountCents,
                    status: 'PAID',
                    gift_card_id: referrerGiftCard.giftCardId,
                    payment_id: paymentData.id || paymentData.paymentId || null,
                    reward_type: 'referrer_reward',
                    paid_at: new Date(),
                    metadata: { square_response: referrerGiftCard }
                  }
                })
              } catch (rewardDbError) {
                console.error('Error saving referral reward to database:', rewardDbError.message)
                // Continue as the gift card was already created in Square
              }

              await prisma.$executeRaw`
                UPDATE square_existing_clients 
                SET 
                  total_referrals = COALESCE(total_referrals, 0) + 1,
                  total_rewards = COALESCE(total_rewards, 0) + 1000,
                  gift_card_id = ${referrerGiftCard.giftCardId},
                  gift_card_gan = ${referrerGiftCard.giftCardGan ?? null},
                  gift_card_order_id = ${referrerGiftCard.orderId ?? null},
                  gift_card_line_item_uid = ${referrerGiftCard.lineItemUid ?? null},
                  gift_card_delivery_channel = ${referrerGiftCard.activationChannel ?? null},
                  gift_card_activation_url = ${referrerGiftCard.activationUrl ?? null},
                  gift_card_pass_kit_url = ${referrerGiftCard.passKitUrl ?? null},
                  gift_card_digital_email = ${referrerGiftCard.digitalEmail ?? null}
                WHERE square_customer_id = ${referrer.square_customer_id}
              `

              console.log(`✅ Referrer gets NEW gift card:`)
              console.log(`   - Gift Card ID: ${referrerGiftCard.giftCardId}`)
              console.log(`   - Amount: $10`)
              console.log(`   - Referrer: ${referrer.given_name} ${referrer.family_name}`)

              if (runContext?.correlationId) {
                await updateGiftCardRunStage(prisma, runContext.correlationId, {
                  stage: 'referrer_reward:completed',
                  status: 'running',
                  clearError: true,
                  context: {
                    customerId,
                    referrerId: referrer.square_customer_id,
                    giftCardId: referrerGiftCard.giftCardId
                  }
                })
              }

              const referrerNameBase = `${referrer.given_name || ''} ${referrer.family_name || ''}`.trim()
              const referrerEmail = referrer.email_address || referrerGiftCard.digitalEmail || null
              if (referrerEmail) {
                await sendGiftCardEmailNotification({
                  customerName: referrerNameBase || referrerEmail || 'there',
                  email: referrerEmail,
                  giftCardGan: referrerGiftCard.giftCardGan,
                  amountCents: referrerGiftCard.amountCents,
                  balanceCents: referrerGiftCard.balanceCents,
                  activationUrl: referrerGiftCard.activationUrl,
                  passKitUrl: referrerGiftCard.passKitUrl
                })
              } else {
                console.log('⚠️ Referrer gift card email skipped – missing email address')
              }
            } else {
              paymentHadError = true
              if (runContext?.correlationId) {
                await markGiftCardRunError(prisma, runContext.correlationId, 'Failed to create referrer gift card', {
                  stage: 'referrer_reward:error'
                })
              }
            }
          } else {
            const rewardAmountCents = 1000
            const loadResult = await loadGiftCard(
              referrerInfo.gift_card_id,
              rewardAmountCents,
              referrer.square_customer_id,
              'Referrer reward gift card load',
              runContext?.correlationId
                ? { idempotencyKeySeed: buildStageKey(runContext.correlationId, 'referrer_reward', 'load') }
                : {}
            )

            if (loadResult.success) {
              // Create ReferralReward record first to ensure idempotency
              try {
                await prisma.referralReward.create({
                  data: {
                    id: crypto.randomUUID(),
                    organization_id: organizationId,
                    referrer_customer_id: referrer.square_customer_id,
                    referred_customer_id: customerId,
                    reward_amount_cents: rewardAmountCents,
                    status: 'PAID',
                    gift_card_id: referrerInfo.gift_card_id,
                    payment_id: paymentData.id || paymentData.paymentId || null,
                    reward_type: 'referrer_reward',
                    paid_at: new Date(),
                    metadata: { square_response: loadResult }
                  }
                })
              } catch (rewardDbError) {
                console.error('Error saving referral reward to database:', rewardDbError.message)
                // Continue as the gift card was already loaded in Square
              }

              await prisma.$executeRaw`
                UPDATE square_existing_clients 
                SET 
                  total_referrals = COALESCE(total_referrals, 0) + 1,
                  total_rewards = COALESCE(total_rewards, 0) + 1000,
                  gift_card_gan = ${loadResult.giftCardGan ?? referrerInfo.gift_card_gan ?? null},
                  gift_card_delivery_channel = ${loadResult.deliveryChannel ?? referrerInfo.gift_card_delivery_channel ?? null},
                  gift_card_activation_url = ${loadResult.activationUrl ?? referrerInfo.gift_card_activation_url ?? null},
                  gift_card_pass_kit_url = ${loadResult.passKitUrl ?? referrerInfo.gift_card_pass_kit_url ?? null},
                  gift_card_digital_email = ${loadResult.digitalEmail ?? referrerInfo.gift_card_digital_email ?? null}
                WHERE square_customer_id = ${referrer.square_customer_id}
              `

              if (runContext?.correlationId) {
                await updateGiftCardRunStage(prisma, runContext.correlationId, {
                  stage: 'referrer_reward:completed',
                  status: 'running',
                  clearError: true,
                  context: {
                    customerId,
                    referrerId: referrer.square_customer_id,
                    giftCardId: referrerInfo.gift_card_id
                  }
                })
              }

              console.log(`✅ Referrer gets $10 loaded onto existing gift card:`)
              console.log(`   - Gift Card ID: ${referrerInfo.gift_card_id}`)
              console.log(`   - Amount loaded: $10`)
              console.log(`   - Referrer: ${referrer.given_name} ${referrer.family_name}`)

              const referrerNameBase = `${referrer.given_name || ''} ${referrer.family_name || ''}`.trim()
              const referrerEmail = referrer.email_address || loadResult.digitalEmail || null
              if (referrerEmail && loadResult.giftCardGan) {
                await sendGiftCardEmailNotification({
                  customerName: referrerNameBase || referrerEmail || 'there',
                  email: referrerEmail,
                  giftCardGan: loadResult.giftCardGan,
                  amountCents: rewardAmountCents,
                  balanceCents: loadResult.balanceCents,
                  activationUrl: loadResult.activationUrl,
                  passKitUrl: loadResult.passKitUrl
                })
              } else {
                console.log('⚠️ Referrer load email skipped – missing email address or card number')
              }
            } else {
              paymentHadError = true
              if (runContext?.correlationId) {
                await markGiftCardRunError(prisma, runContext.correlationId, 'Failed to load referrer gift card', {
                  stage: 'referrer_reward:error'
                })
              }
            }
          }
        }
      }
    } else {
      console.log(`❌ Referrer not found for code: ${customer.used_referral_code}`)
    }

    if (customer.email_address) {
      if (runContext?.correlationId) {
        await updateGiftCardRunStage(prisma, runContext.correlationId, {
          stage: 'referrer_promotion:issuing',
          status: 'running',
          incrementAttempts: true,
          context: {
            customerId,
            email: customer.email_address
          }
        })
      }

      const referralResult = await sendReferralCodeToNewClient(
        customerId,
        `${customer.given_name} ${customer.family_name}`,
        customer.email_address,
        customer.phone_number
      )
      
      if (referralResult.success) {
        console.log(`✅ Referral code sent to new client:`)
        console.log(`   - Customer: ${customer.given_name} ${customer.family_name}`)
        console.log(`   - Email: ${customer.email_address}`)
        console.log(`   - Referral Code: ${referralResult.referralCode}`)
        console.log(`   - Status: Customer is now a referrer`)
        if (runContext?.correlationId) {
          await updateGiftCardRunStage(prisma, runContext.correlationId, {
            stage: 'referrer_promotion:completed',
            status: 'running',
            clearError: true,
            context: {
              customerId,
              referralCode: referralResult.referralCode
            }
          })
        }
      } else if (runContext?.correlationId) {
        paymentHadError = true
        await markGiftCardRunError(prisma, runContext.correlationId, 'Failed to send referral code email', {
          stage: 'referrer_promotion:error'
        })
      }
    }

    // Only mark payment as completed if there were no errors AND this is the first payment
    // This allows the client to retry processing if something failed
    if (!paymentHadError && isFirstPayment) {
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET first_payment_completed = TRUE
        WHERE square_customer_id = ${customerId}
      `
      console.log(`✅ Marked first payment as completed for customer: ${customerId}`)
    } else if (paymentHadError) {
      console.log(`⚠️ Payment processing had errors, not marking as completed to allow retry`)
    } else if (!isFirstPayment) {
      console.log(`ℹ️ Payment already marked as completed, skipping update`)
    }

    if (runContext?.correlationId && !paymentHadError) {
      await updateGiftCardRunStage(prisma, runContext.correlationId, {
        stage: 'payment:completed',
        status: 'completed',
        clearError: true
      })
    }

    const giftCardGansUsed = await extractGiftCardGansFromPayment(paymentData)
    if (giftCardGansUsed.length) {
      giftCardGansUsed.forEach((gan) => {
        queueWalletPassUpdate(gan, {
          prisma,
          reason: 'gift-card-payment',
          metadata: {
            paymentId: paymentData.id || paymentData.paymentId || null
          }
        })
      })
    }

    console.log(`✅ First payment processing completed for customer: ${customerId}`)

  } catch (error) {
    console.error('Error processing payment completion:', error)
    paymentHadError = true
    if (runContext?.correlationId) {
      await markGiftCardRunError(prisma, runContext.correlationId, error, {
        stage: 'payment:error'
      })
    }
    throw error
  }

  if (paymentHadError) {
    throw new Error('Payment completion encountered errors')
  }
}

// Main processor function: Process booking creation
async function processBookingCreated(bookingData, runContext = {}) {
  let bookingHadError = false
  try {
    const customerId =
      bookingData.customerId ||
      bookingData.customer_id ||
      bookingData.creator_details?.customer_id
    if (!customerId) {
      console.log('No customer ID in booking data, skipping...')
      console.log('Booking data received:', safeStringify(bookingData))
      return
    }

    console.log(`📅 Processing booking created for customer: ${customerId}`)
    console.log('Full booking data:', safeStringify(bookingData))

    if (runContext?.correlationId) {
      await updateGiftCardRunStage(prisma, runContext.correlationId, {
        stage: 'booking:received',
        status: 'running',
        payload: bookingData,
        context: { customerId }
      })
    }

    console.log('🔍 Step 1: Checking if customer exists in database...')
    let customerExists = await prisma.$queryRaw`
      SELECT square_customer_id, got_signup_bonus, used_referral_code, email_address,
             given_name, family_name, phone_number, organization_id,
             gift_card_order_id, gift_card_line_item_uid, gift_card_delivery_channel,
             gift_card_activation_url, gift_card_pass_kit_url, gift_card_digital_email
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    console.log(`   Found ${customerExists?.length || 0} customer(s) in database`)

    if (!customerExists || customerExists.length === 0) {
      console.log(`ℹ️ Customer ${customerId} not in database yet - need to add them first`)
      
      try {
        // Resolve organization_id using helper function
        const organizationId = await getOrganizationId(runContext)
        
        const response = await customersApi.retrieveCustomer(customerId)
        const squareCustomer = response.result.customer
        
        console.log(`📥 Fetching customer from Square:`, safeStringify(squareCustomer))
        
        const squareGivenName = cleanValue(squareCustomer.givenName)
        const squareFamilyName = cleanValue(squareCustomer.familyName)
        const squareEmail = cleanValue(squareCustomer.emailAddress)
        const squarePhone = cleanValue(squareCustomer.phoneNumber)

        await prisma.$executeRaw`
          INSERT INTO square_existing_clients (
            organization_id,
            square_customer_id,
            given_name,
            family_name,
            email_address,
            phone_number,
            got_signup_bonus,
            activated_as_referrer,
            personal_code,
            gift_card_id,
            used_referral_code,
            referral_email_sent,
            created_at,
            updated_at
          ) VALUES (
            ${organizationId}::uuid,
            ${customerId},
            ${squareGivenName},
            ${squareFamilyName},
            ${squareEmail},
            ${squarePhone},
            FALSE,
            FALSE,
            NULL,
            NULL,
            NULL,
            FALSE,
            NOW(),
            NOW()
          )
          ON CONFLICT (square_customer_id) DO UPDATE SET
            organization_id = COALESCE(square_existing_clients.organization_id, EXCLUDED.organization_id),
            given_name = COALESCE(square_existing_clients.given_name, EXCLUDED.given_name),
            family_name = COALESCE(square_existing_clients.family_name, EXCLUDED.family_name),
            email_address = COALESCE(square_existing_clients.email_address, EXCLUDED.email_address),
            phone_number = COALESCE(square_existing_clients.phone_number, EXCLUDED.phone_number),
            updated_at = NOW()
        `
        
        console.log(`✅ Added new customer from booking webhook`)
        
        const newCustomerData = await prisma.$queryRaw`
          SELECT square_customer_id, got_signup_bonus, used_referral_code, email_address,
                 given_name, family_name, organization_id,
                 gift_card_order_id, gift_card_line_item_uid, gift_card_delivery_channel,
                 gift_card_activation_url, gift_card_pass_kit_url, gift_card_digital_email
          FROM square_existing_clients 
          WHERE square_customer_id = ${customerId}
        `
        customerExists = newCustomerData
      } catch (error) {
        console.error(`❌ Error fetching/adding customer from Square:`, error.message)
        return
      }
    }

    console.log('🔍 Step 2: Getting customer record...')
    const customer = customerExists[0]
    const organizationId = customer.organization_id
    
    if (!organizationId) {
      console.warn(`⚠️ Cannot resolve organization_id for customer ${customerId}, skipping booking processing`)
      return
    }
    
    console.log(`   Customer: ${customer.given_name} ${customer.family_name}`)
    console.log(`   Organization ID: ${organizationId}`)

    if ((!customer.given_name || !customer.family_name || !customer.email_address || !customer.phone_number)) {
      const squareCustomer = await fetchSquareCustomerProfile(customerId)
      if (squareCustomer) {
        const squareGivenName = cleanValue(squareCustomer.givenName)
        const squareFamilyName = cleanValue(squareCustomer.familyName)
        const squareEmail = cleanValue(squareCustomer.emailAddress)
        const squarePhone = cleanValue(squareCustomer.phoneNumber)

        await prisma.$executeRaw`
          UPDATE square_existing_clients
          SET
            given_name = COALESCE(square_existing_clients.given_name, ${squareGivenName}),
            family_name = COALESCE(square_existing_clients.family_name, ${squareFamilyName}),
            email_address = COALESCE(square_existing_clients.email_address, ${squareEmail}),
            phone_number = COALESCE(square_existing_clients.phone_number, ${squarePhone}),
            updated_at = NOW()
          WHERE square_customer_id = ${customerId}
        `
      }
    }

    if (customer.got_signup_bonus) {
      console.log(`ℹ️ Customer ${customerId} already received signup bonus, not first booking`)
      return
    }

    console.log(`🎉 First booking detected for customer: ${customerId}`)
    console.log(`   Name: ${customer.given_name} ${customer.family_name}`)
    console.log('🔍 Step 3: Checking for referral code...')

    let referralCode = null
    
    if (bookingData.serviceVariationCapabilityDetails) {
      const extensionData = bookingData.serviceVariationCapabilityDetails
      if (extensionData && extensionData.values) {
        console.log(`   🔍 Checking serviceVariationCapabilityDetails for referral code...`)
        for (let key in extensionData.values) {
          if (key.toLowerCase().includes('referral') || key.toLowerCase().includes('ref')) {
            referralCode = extensionData.values[key]
            console.log(`   ✅ Found referral code in serviceVariationCapabilityDetails: ${referralCode}`)
            break
          }
        }
      }
    }

    if (!referralCode) {
      const customFields = bookingData.custom_fields || bookingData.customFields
      if (Array.isArray(customFields) && customFields.length > 0) {
        console.log(`   🔍 Checking booking.custom_fields for referral code...`)
        for (const field of customFields) {
          const fieldName = (field?.name || field?.label || field?.title || '').toLowerCase()
          const fieldKey = (field?.booking_custom_field_id || field?.custom_field_id || field?.key || '').toLowerCase()
          const rawValue = field?.string_value ?? field?.stringValue ?? field?.text_value ?? field?.value ?? ''
          const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue

          console.log(`      • Field "${fieldName || fieldKey || 'unknown'}" -> "${value}"`)

          if (!value || typeof value !== 'string') {
            continue
          }

          const looksLikeReferralField =
            fieldName.includes('referral') ||
            fieldKey.includes('referral') ||
            fieldName.includes('ref') ||
            fieldKey.includes('ref')

          if (looksLikeReferralField || (value && value.length <= 20 && value.split(' ').length <= 3)) {
            const testReferrer = await findReferrerByCode(value, organizationId)
            if (testReferrer) {
              referralCode = value
              console.log(`   ✅ Found referral code in booking.custom_fields: ${value}`)
              console.log(`   ✅ Referrer: ${testReferrer.given_name} ${testReferrer.family_name} (${testReferrer.square_customer_id})`)
              break
            } else {
              console.log(`   ⚠️ Value "${value}" from booking.custom_fields is not a valid referral code`)
            }
          }
        }
      }
    }

    if (!referralCode) {
      const segments = bookingData.appointment_segments || bookingData.appointmentSegments
      if (Array.isArray(segments) && segments.length > 0) {
        console.log(`   🔍 Checking appointment segment custom fields for referral code...`)
        for (const segment of segments) {
          const segmentFields = segment?.custom_fields || segment?.customFields
          if (!Array.isArray(segmentFields) || segmentFields.length === 0) {
            continue
          }

          for (const field of segmentFields) {
            const fieldName = (field?.name || field?.label || field?.title || '').toLowerCase()
            const fieldKey = (field?.booking_custom_field_id || field?.custom_field_id || field?.key || '').toLowerCase()
            const rawValue = field?.string_value ?? field?.stringValue ?? field?.text_value ?? field?.value ?? ''
            const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue

            console.log(`      • Segment field "${fieldName || fieldKey || 'unknown'}" -> "${value}"`)

            if (!value || typeof value !== 'string') {
              continue
            }

            const looksLikeReferralField =
              fieldName.includes('referral') ||
              fieldKey.includes('referral') ||
              fieldName.includes('ref') ||
              fieldKey.includes('ref')

            if (looksLikeReferralField || (value && value.length <= 20 && value.split(' ').length <= 3)) {
              const testReferrer = await findReferrerByCode(value, organizationId)
              if (testReferrer) {
                referralCode = value
                console.log(`   ✅ Found referral code in appointment segment custom fields: ${value}`)
                console.log(`   ✅ Referrer: ${testReferrer.given_name} ${testReferrer.family_name} (${testReferrer.square_customer_id})`)
                break
              } else {
                console.log(`   ⚠️ Value "${value}" from segment custom fields is not a valid referral code`)
              }
            }
          }

          if (referralCode) break
        }
      }
    }
    
    if (!referralCode) {
      console.log(`   No referral code in booking, checking custom attributes...`)
      
      // First, try booking custom attributes (using Booking Custom Attributes API)
      // Reference: https://developer.squareup.com/reference/square/booking-custom-attributes-api
      const bookingId = bookingData.id || bookingData.booking_id
      if (bookingId) {
        console.log(`   🔍 Step 3a: Checking booking custom attributes for booking ${bookingId}...`)
        const bookingAttributes = await getBookingCustomAttributes(bookingId)
        console.log(`   Booking custom attributes from Square:`, safeStringify(bookingAttributes))
        
        // Check for referral code in booking custom attributes
        for (const [key, value] of Object.entries(bookingAttributes)) {
          if (typeof value === 'string' && value.length > 0) {
            const testReferrer = await findReferrerByCode(value, organizationId)
            if (testReferrer) {
              referralCode = value
              console.log(`   ✅ Found referral code in booking custom attributes: ${value}`)
              console.log(`   ✅ Referrer: ${testReferrer.given_name} ${testReferrer.family_name} (${testReferrer.square_customer_id})`)
              break
            }
          }
        }
      }
      
      // Fallback to customer custom attributes if not found in booking
      if (!referralCode) {
        console.log(`   🔍 Step 3b: Checking customer custom attributes...`)
        const attributes = await getCustomerCustomAttributes(customerId)
        console.log(`   Custom attributes from Square:`, safeStringify(attributes))
      
      if (attributes['referral_code']) {
        const codeValue = attributes['referral_code']
        console.log(`   🎯 Found 'referral_code' attribute with value: "${codeValue}"`)
        const testReferrer = await findReferrerByCode(codeValue, organizationId)
        if (testReferrer) {
          referralCode = codeValue
          console.log(`   ✅ Valid referral code found: ${codeValue}`)
          console.log(`   ✅ Referrer: ${testReferrer.given_name} ${testReferrer.family_name} (${testReferrer.square_customer_id})`)
        } else {
          console.log(`   ⚠️ 'referral_code' value "${codeValue}" not found in database`)
        }
      }
      
      if (!referralCode) {
        console.log(`   🔍 Checking all custom attribute values for valid referral codes...`)
        for (const [key, value] of Object.entries(attributes)) {
          if (typeof value === 'string' && value.length > 0) {
            console.log(`   🔍 Checking custom attribute value: "${value}" (key: ${key})`)
            
            if (value.length > 20 || value.split(' ').length > 3) {
              console.log(`   ⏭️ Skipping value "${value}" - looks like text/review, not a code`)
              continue
            }
            
            const testReferrer = await findReferrerByCode(value, organizationId)
            console.log(`   🔍 Database lookup result for "${value}":`, testReferrer ? `FOUND - ${testReferrer.given_name} ${testReferrer.family_name}` : 'NOT FOUND')
            
            if (testReferrer) {
              referralCode = value
              console.log(`   ✅ Found referral code in custom attribute: ${key} = ${value}`)
              console.log(`   ✅ Referrer: ${testReferrer.given_name} ${testReferrer.family_name} (${testReferrer.square_customer_id})`)
              console.log(`   ✅ Referrer has personal_code: ${testReferrer.personal_code}`)
              break
            } else {
              console.log(`   ⚠️ Value "${value}" is not a valid referral code in database`)
              console.log(`   ⚠️ This means either: 1) Code doesn't exist, or 2) Referrer hasn't completed first payment yet`)
            }
          }
        }
      }
    }

    console.log(`   Final referral code result: ${referralCode || 'None'}`)

    if (referralCode) {
      console.log(`🎁 Customer used referral code: ${referralCode}`)

      const referrer = await findReferrerByCode(referralCode, organizationId)

      if (referrer) {
        console.log(`👤 Found referrer: ${referrer.given_name} ${referrer.family_name}`)
        
        const pendingOrderInfo =
          customer.gift_card_order_id && customer.gift_card_line_item_uid
            ? {
                orderId: customer.gift_card_order_id,
                lineItemUid: customer.gift_card_line_item_uid
              }
            : null

        if (runContext?.correlationId) {
          await updateGiftCardRunStage(prisma, runContext.correlationId, {
            stage: 'friend_reward:issuing',
            status: 'running',
            incrementAttempts: true,
            context: {
              customerId,
              referralCode
            }
          })
        }

        const friendGiftCardOptions = {
          orderInfo: pendingOrderInfo || undefined,
          idempotencyKeySeed: runContext?.correlationId
            ? buildStageKey(runContext.correlationId, 'friend_reward', 'issue')
            : undefined
        }
        const friendGiftCard = await createGiftCard(
          customerId,
          `${customer.given_name || ''} ${customer.family_name || ''}`.trim(),
          1000,
          false,
          friendGiftCardOptions
        )

        if (friendGiftCard?.giftCardId) {
          await prisma.$executeRaw`
            UPDATE square_existing_clients 
            SET 
              got_signup_bonus = TRUE,
              gift_card_id = ${friendGiftCard.giftCardId},
              gift_card_gan = ${friendGiftCard.giftCardGan ?? null},
              gift_card_order_id = ${friendGiftCard.orderId ?? null},
              gift_card_line_item_uid = ${friendGiftCard.lineItemUid ?? null},
              gift_card_delivery_channel = ${friendGiftCard.activationChannel ?? null},
              gift_card_activation_url = ${friendGiftCard.activationUrl ?? null},
              gift_card_pass_kit_url = ${friendGiftCard.passKitUrl ?? null},
              gift_card_digital_email = ${friendGiftCard.digitalEmail ?? null},
              used_referral_code = ${referralCode},
              updated_at = NOW()
            WHERE square_customer_id = ${customerId}
          `

          console.log(`✅ Friend received $10 gift card IMMEDIATELY: ${friendGiftCard.giftCardId}`)
          console.log(`   - Customer: ${customer.given_name} ${customer.family_name}`)
          console.log(`   - Referrer: ${referrer.given_name} ${referrer.family_name}`)
          console.log(`   - Next: When customer pays, referrer gets $10`)

          if (runContext?.correlationId) {
            await updateGiftCardRunStage(prisma, runContext.correlationId, {
              stage: 'friend_reward:completed',
              status: 'completed',
              clearError: true,
              context: {
                customerId,
                giftCardId: friendGiftCard.giftCardId
              }
            })
          }

          const friendNameBase = `${customer.given_name || ''} ${customer.family_name || ''}`.trim()
          const friendEmail = customer.email_address || friendGiftCard.digitalEmail || null
          if (friendEmail) {
            await sendGiftCardEmailNotification({
              customerName: friendNameBase || friendEmail || 'there',
              email: friendEmail,
              giftCardGan: friendGiftCard.giftCardGan,
              amountCents: friendGiftCard.amountCents,
              balanceCents: friendGiftCard.balanceCents,
              activationUrl: friendGiftCard.activationUrl,
              passKitUrl: friendGiftCard.passKitUrl
            })
          } else {
            console.log('⚠️ Friend gift card email skipped – missing email address')
          }
        } else {
          bookingHadError = true
          if (runContext?.correlationId) {
            await markGiftCardRunError(prisma, runContext.correlationId, 'Failed to create friend gift card', {
              stage: 'friend_reward:error'
            })
          }
        }
      } else {
        console.log(`❌ Referrer not found for code: ${referralCode}`)
      }
    } else {
      console.log(`ℹ️ Customer booked without referral code`)
      console.log(`   - Will receive referral code after first payment`)
      console.log(`   - No gift card given`)
    }

    console.log(`✅ Booking processing completed for customer: ${customerId}`)
    if (runContext?.correlationId && !bookingHadError) {
      await updateGiftCardRunStage(prisma, runContext.correlationId, {
        stage: 'booking:completed',
        status: 'completed',
        clearError: true
      })
    }

  } catch (error) {
    console.error('❌ Error processing booking creation:', error.message)
    console.error('Stack trace:', error.stack)
    bookingHadError = true
    if (runContext?.correlationId) {
      await markGiftCardRunError(prisma, runContext.correlationId, error, {
        stage: 'friend_reward:error'
      })
    }
    throw error
  }

  if (bookingHadError) {
    throw new Error('Booking processing encountered errors')
  }
}

// Export the three main processor functions and helper functions
module.exports = {
  processCustomerCreated,
  processBookingCreated,
  processPaymentCompletion,
  createGiftCard,
  loadGiftCard,
  sendGiftCardEmailNotification,
  sendReferralCodeToNewClient,
  generateUniquePersonalCode,
  createPromotionOrder,
  completePromotionOrderPayment,
  findReferrerByCode
}
