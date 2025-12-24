const prisma = require('../../../../../lib/prisma-client')
const crypto = require('crypto')
const QRCode = require('qrcode')
const { sendReferralCodeEmail, sendGiftCardIssuedEmail } = require('../../../../../lib/email-service-simple')
const { sendReferralCodeSms, REFERRAL_PROGRAM_SMS_TEMPLATE } = require('../../../../../lib/twilio-service')
const { normalizeGiftCardNumber } = require('../../../../../lib/wallet/giftcard-number-utils')
const {
  buildCorrelationId,
  buildStageKey,
  buildIdempotencyKey,
  ensureGiftCardRun,
  updateGiftCardRunStage,
  markGiftCardRunError
} = require('../../../../../lib/runs/giftcard-run-tracker')
const { generateReferralUrl } = require('../../../../../lib/utils/referral-url')
const {
  enqueueGiftCardJob
} = require('../../../../../lib/workflows/giftcard-job-queue')
const {
  logInfo,
  logWarn,
  logError
} = require('../../../../../lib/observability/logger')
const { queueWalletPassUpdate } = require('../../../../../lib/wallet/push-service')
const { validateEnvironmentVariables } = require('../../../../../lib/config/env-validator')
const {
  getFriendlyLocationIdFromPayment,
  getFriendlyLocationIdFromBooking,
  addLocationMetadata
} = require('../../../../../lib/config/location-map')
const {
  recordReferralEvent,
  recordRevenueEvent,
  recordAnalyticsEvent,
  startProcessRun,
  completeProcessRun,
  ReferralEventType,
  ProcessRunStatus
} = require('../../../../../lib/analytics-service')
const { getSquareEnvironmentName } = require('../../../../../lib/utils/square-env')

let squareApisCache = null
function getSquareApis() {
  if (squareApisCache) return squareApisCache
  // Use dynamic require so bundlers don't evaluate Square SDK at build-time
  // eslint-disable-next-line global-require
  const squareModule = require('square')
  const candidates = [squareModule, squareModule?.default].filter(Boolean)
  const pick = (selector) => {
    for (const candidate of candidates) {
      const value = selector(candidate)
      if (value) return value
    }
    return null
  }

  const Client =
    pick((mod) => (typeof mod?.Client === 'function' ? mod.Client : null)) ||
    (typeof candidates[0] === 'function' ? candidates[0] : null)
  const Environment = pick((mod) => mod?.Environment)
  const WebhooksHelper = pick((mod) => mod?.WebhooksHelper)

  if (
    typeof Client !== 'function' ||
    !Environment ||
    typeof Environment.Production === 'undefined'
  ) {
    throw new Error('Square SDK exports missing (Client/Environment)')
  }

  const squareEnvName = getSquareEnvironmentName()
  const resolvedEnvironment = squareEnvName === 'sandbox' ? Environment.Sandbox : Environment.Production
  const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
    environment: resolvedEnvironment,
  })
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[square] Webhook handler using ${squareEnvName} environment`)
  }
  squareApisCache = {
    Client,
    Environment,
    WebhooksHelper,
    customersApi: squareClient.customersApi,
    giftCardsApi: squareClient.giftCardsApi,
    giftCardActivitiesApi: squareClient.giftCardActivitiesApi,
    customerCustomAttributesApi: squareClient.customerCustomAttributesApi,
    ordersApi: squareClient.ordersApi,
    paymentsApi: squareClient.paymentsApi,
  }
  return squareApisCache
}

const getCustomersApi = () => getSquareApis().customersApi
const getGiftCardsApi = () => getSquareApis().giftCardsApi
const getGiftCardActivitiesApi = () => getSquareApis().giftCardActivitiesApi
const getCustomerCustomAttributesApi = () => getSquareApis().customerCustomAttributesApi
const getOrdersApi = () => getSquareApis().ordersApi
const getPaymentsApi = () => getSquareApis().paymentsApi
const getWebhooksHelper = () => getSquareApis().WebhooksHelper

const DELIVERY_CHANNELS = {
  SQUARE_EGIFT_ORDER: 'square_egift_order',
  OWNER_FUNDED_ACTIVATE: 'owner_funded_activate',
  OWNER_FUNDED_ADJUST: 'owner_funded_adjust'
}

const REFERRAL_SMS_TEMPLATE =
  process.env.REFERRAL_SMS_TEMPLATE ||
  REFERRAL_PROGRAM_SMS_TEMPLATE

/**
 * Generate QR code data URI for gift card
 * Retries with exponential backoff and different configurations to ensure QR code is always generated
 * @param {string} giftCardGan - Gift card GAN (Gift Account Number)
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @returns {Promise<string|null>} - QR code data URI or null if all attempts fail
 */
async function generateGiftCardQrDataUri(giftCardGan, maxRetries = 3) {
  if (!giftCardGan) {
    console.warn('⚠️ Cannot generate QR code - gift card GAN is missing')
    return null
  }

  const qrData = `sqgc://${giftCardGan}`
  const configs = [
    // Try with optimal settings first
    { margin: 1, scale: 4, errorCorrectionLevel: 'M' },
    // Fallback to simpler settings
    { margin: 1, scale: 3, errorCorrectionLevel: 'L' },
    // Try with minimal settings as last resort
    { margin: 0, scale: 2, errorCorrectionLevel: 'L' }
  ]

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const config = configs[Math.min(attempt, configs.length - 1)]
    
    try {
      const qrDataUri = await QRCode.toDataURL(qrData, config)
      
      if (qrDataUri && qrDataUri.startsWith('data:image')) {
        if (attempt > 0) {
          console.log(`✅ QR code generated successfully on attempt ${attempt + 1} for gift card ${giftCardGan}`)
        }
        return qrDataUri
      }
      
      throw new Error('QR code generation returned invalid data URI')
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1
      
      if (isLastAttempt) {
        console.error(`❌ Failed to generate QR code for gift card ${giftCardGan} after ${maxRetries} attempts:`, error.message)
        console.error(`   QR data: ${qrData}`)
        console.error(`   This is critical - customer email will be sent without QR code`)
        
        // Even on failure, try one more time with the simplest possible configuration
        try {
          const fallbackUri = await QRCode.toDataURL(qrData, {
            margin: 0,
            scale: 1,
            errorCorrectionLevel: 'L',
            width: 200
          })
          
          if (fallbackUri && fallbackUri.startsWith('data:image')) {
            console.log(`✅ QR code generated with fallback configuration for gift card ${giftCardGan}`)
            return fallbackUri
          }
        } catch (fallbackError) {
          console.error(`❌ Fallback QR generation also failed:`, fallbackError.message)
        }
        
        // Log critical error but don't block email sending
        return null
      }
      
      // Wait before retry with exponential backoff (50ms, 100ms, 200ms)
      const backoffMs = Math.min(50 * Math.pow(2, attempt), 200)
      console.warn(`⚠️ QR generation attempt ${attempt + 1} failed for gift card ${giftCardGan}, retrying in ${backoffMs}ms...`)
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }
  }

  // Should never reach here, but just in case
  console.error(`❌ QR code generation failed completely for gift card ${giftCardGan}`)
  return null
}

function extractPaymentAmountCents(paymentData = {}) {
  if (!paymentData) return null
  const candidates = [
    paymentData.amountMoney?.amount,
    paymentData.amount_money?.amount,
    paymentData.totalMoney?.amount,
    paymentData.total_money?.amount,
    paymentData.approvedMoney?.amount,
    paymentData.approved_money?.amount
  ]

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value)
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed)
      }
    }
  }

  return null
}

/**
 * Wait for PassKit URL to become available for a gift card
 * Retries every 10 seconds for up to 5 minutes (30 attempts)
 * Returns passKitUrl when available, or null after timeout
 */
async function waitForPassKitUrl(giftCardId, maxWaitMinutes = 5, retryIntervalSeconds = 10) {
  if (!giftCardId) {
    return null
  }

  const giftCardsApi = getGiftCardsApi()
  const maxAttempts = Math.floor((maxWaitMinutes * 60) / retryIntervalSeconds)
  let attempts = 0

  console.log(`⏳ Waiting for PassKit URL for gift card ${giftCardId} (max ${maxWaitMinutes} minutes)...`)

  while (attempts < maxAttempts) {
    try {
      const verify = await giftCardsApi.retrieveGiftCard(giftCardId)
      const verifyCard = verify.result?.giftCard
      
      if (verifyCard?.digitalDetails?.passKitUrl) {
        const passKitUrl = verifyCard.digitalDetails.passKitUrl
        console.log(`✅ PassKit URL available after ${attempts * retryIntervalSeconds} seconds: ${passKitUrl}`)
        return passKitUrl
      }

      attempts++
      if (attempts < maxAttempts) {
        console.log(`   Attempt ${attempts}/${maxAttempts}: PassKit URL not ready, waiting ${retryIntervalSeconds}s...`)
        await new Promise(resolve => setTimeout(resolve, retryIntervalSeconds * 1000))
      }
    } catch (error) {
      console.warn(`⚠️ Error checking for PassKit URL (attempt ${attempts + 1}):`, error.message)
      attempts++
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, retryIntervalSeconds * 1000))
      }
    }
  }

  console.log(`⏰ Timeout: PassKit URL not available after ${maxWaitMinutes} minutes, proceeding without it`)
  return null
}

async function extractGiftCardGansFromPayment(paymentData) {
  const gans = new Set()
  if (!paymentData) {
    return []
  }

  const giftCardsApi = getGiftCardsApi()
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

async function sendGiftCardEmailNotification({
  customerName,
  email,
  giftCardGan,
  amountCents,
  balanceCents,
  activationUrl,
  passKitUrl,
  giftCardId, // Add giftCardId parameter for retry logic
  isReminder = false,
  waitForPassKit = true, // Enable waiting for PassKit URL by default
  locationId = null,
  notificationMetadata = {}
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

  const giftCardsApi = getGiftCardsApi()
  const normalizedGan = await normalizeGiftCardNumber({
    rawValue: giftCardGan,
    prisma,
    giftCardsApi
  })
  const ganForEmail = normalizedGan || giftCardGan
  if (ganForEmail !== giftCardGan) {
    console.log(`   🔄 Normalized gift card number ${giftCardGan} → ${ganForEmail}`)
  }

  // Generate QR code (always included - most important)
  const qrDataUri = await generateGiftCardQrDataUri(ganForEmail)

  // Wait for PassKit URL if requested and giftCardId is provided
  let finalPassKitUrl = passKitUrl
  if (waitForPassKit && giftCardId && !passKitUrl) {
    console.log(`🔄 PassKit URL not provided, waiting for it...`)
    finalPassKitUrl = await waitForPassKitUrl(giftCardId)
  }

  // Send email with QR code, GAN, and PassKit URL (if available)
  const analyticsMetadata = addLocationMetadata(notificationMetadata, locationId)
  const emailResult = await sendGiftCardIssuedEmail(
    customerName,
    email,
    {
      giftCardGan: ganForEmail,
      amountCents: meaningfulAmount,
      balanceCents: balanceCents ?? null,
      activationUrl: activationUrl ?? null,
      passKitUrl: finalPassKitUrl ?? null, // Use waited-for URL or original
      qrDataUri,
      isReminder
    },
    {
      metadata: analyticsMetadata
    }
  )

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

const REFERRAL_CODE_ATTRIBUTE_KEY =
  process.env.SQUARE_REFERRAL_CODE_ATTRIBUTE_KEY?.trim() ||
  'square:a3dde506-f69e-48e4-a98a-004c1822d3ad'

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

// Manual signature verification as fallback
function verifySquareSignatureManually(body, signature, secret, url) {
  try {
    // Square's signature is: HMAC-SHA256(body + url, secret)
    const payload = body + url
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(payload, 'utf8')
    const expectedSignature = hmac.digest('base64')
    
    // Use timing-safe comparison
    const providedSig = Buffer.from(signature, 'base64')
    const expectedSig = Buffer.from(expectedSignature, 'base64')
    
    if (providedSig.length !== expectedSig.length) {
      return false
    }
    
    return crypto.timingSafeEqual(providedSig, expectedSig)
  } catch (error) {
    console.error('Manual signature verification error:', error.message)
    return false
  }
}

// Generate unique referral code (random - kept for backward compatibility)
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Generate personal code in name+ID format (e.g., ABY2144, LEORA1234)
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

// Find referrer by referral code
async function findReferrerByCode(referralCode) {
  try {
    if (!referralCode || typeof referralCode !== 'string') {
      console.error(`Invalid referral code provided: ${referralCode}`)
      return null
    }
    
    // Trim and normalize the code
    const normalizedCode = referralCode.trim().toUpperCase()
    console.log(`   🔍 Looking up referral code in database: "${normalizedCode}" (original: "${referralCode}")`)
    
    // Try exact match first (case-insensitive)
    let referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code, gift_card_id
      FROM square_existing_clients 
      WHERE UPPER(TRIM(personal_code)) = ${normalizedCode}
      LIMIT 1
    `
    
    if (referrer && referrer.length > 0) {
      console.log(`   ✅ Found referrer with code "${normalizedCode}": ${referrer[0].given_name} ${referrer[0].family_name}`)
      return referrer[0]
    }
    
    // If not found, try case-sensitive match
    referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code, gift_card_id
      FROM square_existing_clients 
      WHERE personal_code = ${referralCode}
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
    const customerCustomAttributesApi = getCustomerCustomAttributesApi()
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


// Get customer custom attributes from Square
async function getCustomerCustomAttributes(customerId) {
  try {
    console.log(`   Fetching custom attributes for customer ${customerId}...`)
    
    // Use the custom attributes API to get all attributes
    const customerCustomAttributesApi = getCustomerCustomAttributesApi()
    const response = await customerCustomAttributesApi.listCustomerCustomAttributes(customerId)
    
    console.log(`   Full custom attributes response:`, safeStringify(response.result))
    
    if (response.result && response.result.customAttributes) {
      const attributes = {}
      response.result.customAttributes.forEach(attr => {
        attributes[attr.key] = attr.value
        console.log(`   📋 Custom attribute: key="${attr.key}", value="${attr.value}"`)
      })
      
      // Check if there's a specific 'referral_code' key first
      const referralCodeAttr = response.result.customAttributes.find(attr => 
        attr.key === 'referral_code' || 
        attr.key.toLowerCase().includes('referral') ||
        attr.key.toLowerCase().includes('ref')
      )
      
      if (referralCodeAttr) {
        console.log(`   ✅ Found referral_code attribute: key="${referralCodeAttr.key}", value="${referralCodeAttr.value}"`)
      }
      
      return attributes
    }
    
    return {}
  } catch (error) {
    console.error(`Error getting custom attributes for customer ${customerId}:`, error.message)
    if (error?.errors) {
      console.error('   Square API errors:', safeStringify(error.errors))
    }
    return {}
  }
}

function cleanValue(value) {
  if (value === undefined || value === null) return null
  const trimmed = value.toString().trim()
  return trimmed.length > 0 ? trimmed : null
}

async function fetchSquareCustomerProfile(customerId) {
  try {
    const response = await getCustomersApi().retrieveCustomer(customerId)
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
    const response = await getCustomersApi().retrieveCustomer(customerId)
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

    await getCustomersApi().updateCustomer(customerId, {
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
    const response = await getCustomersApi().retrieveCustomer(customerId)
    const existingNote = response.result?.customer?.note?.trim() || ''
    const issuedOn = new Date().toISOString().split('T')[0]
    const noteEntry = `[${issuedOn}] Personal referral code: ${referralCode} – ${referralUrl}`

    if (existingNote.includes(referralCode) || existingNote.includes(referralUrl)) {
      console.log(`📝 Customer note already lists referral code ${referralCode}, skipping update`)
      return
    }

    const updatedNote = existingNote ? `${existingNote}\n${noteEntry}` : noteEntry

    await getCustomersApi().updateCustomer(customerId, {
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
    const ordersApi = getOrdersApi()
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
    const paymentsApi = getPaymentsApi()
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

// Create gift card with unique name and activate it
async function createGiftCard(customerId, customerName, amountCents = 1000, isReferrer = false, options = {}) {
  try {
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    const noteContext = isReferrer ? 'Referrer reward gift card' : 'Signup bonus gift card'
    const amountMoney = {
      amount: Number.isFinite(amountCents) ? Math.trunc(amountCents) : 0,
      currency: 'USD'
    }
    const giftCardsApi = getGiftCardsApi()
    const giftCardActivitiesApi = getGiftCardActivitiesApi()
    const { orderInfo = null, idempotencyKeySeed = null } = options || {}
    const idempotencySeed =
      idempotencyKeySeed ||
      buildIdempotencyKey([
        'gift-card',
        isReferrer ? 'referrer' : 'friend',
        customerId || customerName || amountMoney.amount?.toString()
      ])
    
    // Step 1: Create the gift card
    const giftCardRequest = {
      idempotencyKey: buildIdempotencyKey([idempotencySeed, 'create']),
      locationId: locationId,
      giftCard: {
        type: 'DIGITAL',
        state: 'PENDING', // Create as PENDING, will activate with activity
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
    let giftCardGan = giftCard.gan
    console.log(`✅ Created gift card for ${customerName}: ${giftCardId}`)
    
    let giftCardActivity = null
    let activityBalanceNumber = 0
    let activationChannel = null
    let successfulOrderInfo = null

    // Try order-based activation first (Square eGift flow)
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
    
    // Owner-funded activation fallback (ACTIVATE with OWNER_FUNDED)
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

    // Final fallback: ADJUST_INCREMENT (ensures balance load even if activate fails)
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

    // Step 3: Link gift card to customer in Square
    // This ensures the card appears in the customer's profile
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

      if (verifyCard?.gan && verifyCard.gan !== giftCardGan) {
        console.log(`   Normalized gift card number ${giftCardGan || '[none]'} → ${verifyCard.gan}`)
        giftCardGan = verifyCard.gan
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

// Load money onto existing gift card using ADJUST_INCREMENT activity
// For owner-funded referral rewards, use ADJUST_INCREMENT instead of loadGiftCard API
async function loadGiftCard(
  giftCardId,
  amountCents = 1000,
  customerId = null,
  contextLabel = 'Referrer reward gift card load',
  options = {}
) {
  try {
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    const giftCardsApi = getGiftCardsApi()
    const giftCardActivitiesApi = getGiftCardActivitiesApi()
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
    let activity = null
    let resultingBalance = 0
    let deliveryChannel = null

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
    }

    if (activity) {
      const balanceAmount = activity.giftCardBalanceMoney?.amount
      resultingBalance = typeof balanceAmount === 'bigint' ? Number(balanceAmount) : (balanceAmount || 0)

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

// Track IP address for anti-abuse
async function trackIpAddress(customerId, ipAddress) {
  try {
    if (!ipAddress) return

    // Get current IP addresses
    const currentData = await prisma.$queryRaw`
      SELECT ip_addresses, first_ip_address, last_ip_address
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `

    if (currentData && currentData.length > 0) {
      const data = currentData[0]
      let ipAddresses = data.ip_addresses || []
      
      // Add new IP if not already tracked
      if (!ipAddresses.includes(ipAddress)) {
        ipAddresses.push(ipAddress)
        
        await prisma.$executeRaw`
          UPDATE square_existing_clients 
          SET 
            ip_addresses = ${ipAddresses},
            last_ip_address = ${ipAddress}
          WHERE square_customer_id = ${customerId}
        `
        
        console.log(`📍 IP address tracked for customer ${customerId}: ${ipAddress}`)
      }
    } else {
      // First time tracking IP for this customer
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET 
          ip_addresses = ARRAY[${ipAddress}],
          first_ip_address = ${ipAddress},
          last_ip_address = ${ipAddress}
        WHERE square_customer_id = ${customerId}
      `
      
      console.log(`📍 First IP address tracked for customer ${customerId}: ${ipAddress}`)
    }
  } catch (error) {
    console.error(`Error tracking IP address for customer ${customerId}:`, error.message)
  }
}

// Check for suspicious IP activity
async function checkSuspiciousActivity(customerId, ipAddress) {
  try {
    if (!ipAddress) return false

    // Check if this IP has been used by multiple customers
    const ipUsage = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT square_customer_id) as customer_count
      FROM square_existing_clients 
      WHERE ${ipAddress} = ANY(ip_addresses)
    `

    if (ipUsage && ipUsage.length > 0 && ipUsage[0].customer_count > 3) {
      console.log(`⚠️ Suspicious IP activity detected: ${ipAddress} used by ${ipUsage[0].customer_count} customers`)
      return true
    }

    return false
  } catch (error) {
    console.error(`Error checking suspicious activity for IP ${ipAddress}:`, error.message)
    return false
  }
}

// Send referral code email to new client (now becoming a referrer)
async function sendReferralCodeToNewClient(
  customerId,
  customerName,
  email,
  phoneNumber,
  options = {}
) {
  try {
    const locationId = options?.locationId || null
    // Check if email already sent
    const customerData = await prisma.$queryRaw`
      SELECT gift_card_id, got_signup_bonus, referral_email_sent, personal_code, activated_as_referrer,
             gift_card_order_id, gift_card_line_item_uid, gift_card_delivery_channel,
             gift_card_activation_url, gift_card_pass_kit_url, gift_card_digital_email,
             phone_number, referral_sms_sent, referral_sms_sent_at, referral_sms_sid
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    // If email already sent, skip
    if (customerData && customerData.length > 0 && customerData[0].referral_email_sent) {
      console.log(`⚠️ Referral email already sent to ${customerName}, skipping...`)
      return { success: true, alreadySent: true }
    }
    
    // Use existing personal_code from database, or generate new one in name+ID format
    let referralCode = null
    if (customerData && customerData.length > 0 && customerData[0].personal_code) {
      referralCode = customerData[0].personal_code
      console.log(`✅ Using existing personal_code: ${referralCode}`)
    } else {
      // Generate new code in name+ID format
      referralCode = generatePersonalCode(customerName, customerId)
      console.log(`✅ Generated new personal_code in name+ID format: ${referralCode}`)
    }
    
    const referralUrl = generateReferralUrl(referralCode)
    
    let referrerGiftCardId = null
    let referrerGiftCardMeta = null
    const existingRecord = customerData?.[0]
    const fallbackPhone = existingRecord ? cleanValue(existingRecord.phone_number) : null
    const smsDestination = phoneNumber || fallbackPhone
    const smsAlreadySent = Boolean(existingRecord?.referral_sms_sent)
    
    if (customerData && customerData.length > 0) {
      const customer = customerData[0]
      
      // If customer already has a gift card (from using referral code), keep it
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
        // If customer didn't use referral code, create new referrer gift card
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
          0, // Start with $0 balance
          true, // This is a referrer gift card
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
    
    // Update customer custom attributes in Square
    await upsertCustomerCustomAttribute(customerId, REFERRAL_CODE_ATTRIBUTE_KEY, referralCode)
    
    await appendReferralNote(customerId, referralCode, referralUrl)

    // Update database - customer is now a referrer
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
    
    const smsAnalytics = {
      attempted: false,
      success: false,
      skipped: false,
      reason: null
    }

    // Send email using email service
    if (email) {
      const emailResult = await sendReferralCodeEmail(
        customerName,
        email,
        referralCode,
        referralUrl,
        {
          metadata: addLocationMetadata({}, locationId)
        }
      )
      
      if (emailResult.success) {
        if (emailResult.skipped) {
          console.log(`⏸️ Email sending is disabled (skipped sending to ${email})`)
        } else {
          console.log(`✅ Referral email sent successfully to ${email}`)
        }
      } else {
        console.error(`❌ Failed to send email: ${emailResult.error}`)
        // Don't return error, just log it - update still happened
      }
    }
    
    if (!smsDestination) {
      console.log('ℹ️ Referral SMS not sent — missing phone number')
      smsAnalytics.reason = 'missing-phone'
    } else if (smsAlreadySent) {
      console.log('ℹ️ Referral SMS already sent previously, skipping duplicate send.')
      smsAnalytics.skipped = true
      smsAnalytics.reason = 'already-sent'
    } else {
      smsAnalytics.attempted = true
      const smsResult = await sendReferralCodeSms({
        to: smsDestination,
        name: customerName,
        referralUrl,
        body: REFERRAL_SMS_TEMPLATE,
        metadata: addLocationMetadata({}, locationId)
      })

      if (smsResult.success) {
        if (smsResult.skipped) {
          console.log(`⏸️ SMS sending disabled (skipped sending to ${smsDestination})`)
          smsAnalytics.skipped = true
          smsAnalytics.reason = smsResult.reason || 'sms-disabled'
        } else {
          console.log(`📲 Referral SMS sent to ${smsDestination}`)
          smsAnalytics.success = true
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
        smsAnalytics.reason = smsResult.error || smsResult.reason || 'sms-error'
      }
    }
    
    await recordReferralEvent({
      eventType: ReferralEventType.NEW_CUSTOMER,
      referrerCustomerId: customerId,
      metadata: addLocationMetadata(
        {
          referralCode,
          referralUrl,
          emailSent: Boolean(email),
          sms: smsAnalytics,
          giftCardId: referrerGiftCardId
        },
        locationId
      )
    })

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

// Check if customer is new (first time booking)
async function isNewCustomer(customerId) {
  try {
    // Check if customer exists in our database
    const existingCustomer = await prisma.$queryRaw`
      SELECT square_customer_id FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    
    // If customer doesn't exist in our database, they are new
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

// Process customer creation (new customer detected)
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

    // Get IP address from request
    const ipAddress = request.headers.get('x-forwarded-for') || 
                     request.headers.get('x-real-ip') || 
                     request.connection?.remoteAddress ||
                     'unknown'

    console.log(`👤 Processing customer creation: ${customerId}`)
    console.log(`📍 IP Address: ${ipAddress}`)
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

    // Check for suspicious IP activity
    const isSuspicious = await checkSuspiciousActivity(customerId, ipAddress)
    if (isSuspicious) {
      console.log(`⚠️ Suspicious activity detected for customer ${customerId}, flagging for review`)
      // Could add a flag to database for manual review
    }

    // 1. Check if customer is new
    const isNew = await isNewCustomer(customerId)
    if (!isNew) {
      console.log(`ℹ️ Customer ${customerId} is not new, skipping...`)
      return
    }

    console.log(`🎉 New customer detected: ${customerId}`)

    // 2. Add customer to database (mark as new, no gift card yet)
    await prisma.$executeRaw`
      INSERT INTO square_existing_clients (
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
        first_ip_address,
        ip_addresses,
        referral_email_sent,
        created_at,
        updated_at
      ) VALUES (
        ${customerId},
        ${givenName},
        ${familyName},
        ${emailAddress},
        ${phoneNumber},
        FALSE, -- No signup bonus yet (will check on booking)
        FALSE, -- Not a referrer yet
        NULL, -- No referral code yet
        NULL, -- No gift card yet (will create on booking)
        NULL, -- No referral code stored yet (will check on booking)
        ${ipAddress},
        ARRAY[${ipAddress}],
        FALSE, -- No email sent yet
        NOW(),
        NOW()
      )
      ON CONFLICT (square_customer_id) DO UPDATE SET
        given_name = COALESCE(square_existing_clients.given_name, EXCLUDED.given_name),
        family_name = COALESCE(square_existing_clients.family_name, EXCLUDED.family_name),
        email_address = COALESCE(square_existing_clients.email_address, EXCLUDED.email_address),
        phone_number = COALESCE(square_existing_clients.phone_number, EXCLUDED.phone_number),
        updated_at = NOW()
    `

    console.log(`✅ Customer added to database as NEW (temporary mark)`)
    console.log(`   - Will check for referral code when they book`)
    console.log(`   - Will give gift card on first booking if code found`)
    
    // Verify customer was added
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

// Process payment completion (client completes first payment)
async function processPaymentCompletion(paymentData, runContext = {}) {
  let paymentHadError = false
  let analyticsRun = null
  try {
    // Fix 1: Check if payment was already processed (idempotency)
    const paymentId = paymentData.id || paymentData.paymentId
    if (paymentId) {
      const idempotencyKey = `payment:${paymentId}`
      try {
        const existing = await prisma.processedEvent.findUnique({
          where: { idempotencyKey }
        })
        if (existing) {
          console.log(`⚠️ Payment ${paymentId} already processed, skipping...`)
          return
        }
      } catch (error) {
        // If ProcessedEvent table doesn't exist or query fails, log and continue
        console.warn(`⚠️ Could not check payment idempotency: ${error.message}`)
      }
    }

    // Get customer ID from payment data (could be snake_case or camelCase)
    const customerId = paymentData.customerId || paymentData.customer_id
    if (!customerId) {
      console.log('No customer ID in payment data, skipping...')
      console.log('Payment data received:', safeStringify(paymentData))
      return
    }

    analyticsRun = await startProcessRun({
      processType: 'payment_completed',
      metadata: {
        paymentId: paymentId || null,
        customerId
      }
    })

    if (runContext?.correlationId) {
      await updateGiftCardRunStage(prisma, runContext.correlationId, {
        stage: 'payment:received',
        status: 'running',
        payload: paymentData,
        context: { customerId }
      })
    }

    console.log(`💰 Processing payment completion for customer: ${customerId}`)
    
    // Log payment details including tender type for debugging
    console.log(`   Payment source_type: ${paymentData.source_type || 'unknown'}`)
    console.log(`   Payment tender_types: ${safeStringify(paymentData.tender || [])}`)
    const paymentLocationId = getFriendlyLocationIdFromPayment(paymentData)
    if (paymentLocationId) {
      console.log(`📍 Payment attributed to location: ${paymentLocationId}`)
    }

    // 1. Check if this is a new customer's first payment
    const customerData = await prisma.$queryRaw`
      SELECT square_customer_id, used_referral_code, got_signup_bonus, gift_card_id, 
             given_name, family_name, email_address, first_payment_completed
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `

    if (!customerData || customerData.length === 0) {
      console.log(`Customer ${customerId} not found in database`)
      return
    }

    const customer = customerData[0]
    let referrerCustomerId = null
    
    // Fix 3: Check if payment is for our gift card order (skip processing)
    const orderId = paymentData.order_id || paymentData.orderId
    if (orderId) {
      try {
        const isOurOrder = await prisma.$queryRaw`
          SELECT COUNT(*) as count 
          FROM square_existing_clients 
          WHERE gift_card_order_id = ${orderId}
        `
        if (isOurOrder && isOurOrder[0]?.count > 0) {
          console.log(`⚠️ Payment ${paymentId || 'unknown'} is for our gift card order ${orderId}, skipping...`)
          return
        }
      } catch (error) {
        // If query fails, log and continue (don't block processing)
        console.warn(`⚠️ Could not check order ID: ${error.message}`)
      }
    }
    
    // Check if this is their first payment
    if (customer.first_payment_completed) {
      console.log(`Customer ${customerId} already completed first payment`)
      return
    }

    console.log(`🎉 First payment completed for customer: ${customer.given_name} ${customer.family_name}`)
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    // 2. Handle referrer reward (if customer used a referral code)
    if (customer.used_referral_code) {
      console.log(`🎯 Customer used referral code: ${customer.used_referral_code}`)
      // Find the referrer
      const referrer = await findReferrerByCode(customer.used_referral_code)
      if (referrer) {
        console.log(`👤 Found referrer: ${referrer.given_name} ${referrer.family_name}`)
        referrerCustomerId = referrer.square_customer_id

        // Check if referrer already has a gift card
        const referrerData = await prisma.$queryRaw`
          SELECT square_customer_id, total_rewards, gift_card_id,
                 gift_card_order_id, gift_card_line_item_uid, gift_card_delivery_channel,
                 gift_card_activation_url, gift_card_pass_kit_url, gift_card_digital_email
          FROM square_existing_clients 
          WHERE square_customer_id = ${referrer.square_customer_id}
        `

        if (referrerData && referrerData.length > 0) {
          const referrerInfo = referrerData[0]
          
          if (!referrerInfo.gift_card_id) {
            // Create NEW gift card for referrer (first time)
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
              true, // This is a referrer gift card
              referrerGiftCardOptions
            )

            if (referrerGiftCard?.giftCardId) {
              // Update referrer's stats
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
                  passKitUrl: referrerGiftCard.passKitUrl,
                  giftCardId: referrerGiftCard.giftCardId,
                  waitForPassKit: true,
                  locationId: paymentLocationId,
                  notificationMetadata: {
                    customerId: referrer.square_customer_id,
                    friendCustomerId: customerId
                  }
                })
              } else {
                console.log('⚠️ Referrer gift card email skipped – missing email address')
              }

              await recordReferralEvent({
                eventType: ReferralEventType.REWARD_GRANTED_REFERRER,
                referrerCustomerId: referrer.square_customer_id,
                friendCustomerId: customerId,
                amountCents: rewardAmountCents,
        metadata: addLocationMetadata(
          {
            referralCode: customer.used_referral_code,
            giftCardId: referrerGiftCard.giftCardId
          },
          paymentLocationId
        )
              })
            } else {
              paymentHadError = true
              if (runContext?.correlationId) {
                await markGiftCardRunError(prisma, runContext.correlationId, 'Failed to create referrer gift card', {
                  stage: 'referrer_reward:error'
                })
              }
            }
          } else {
            // Load $10 onto EXISTING gift card
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
              // Update referrer's stats
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
                  passKitUrl: loadResult.passKitUrl,
                  giftCardId: referrerInfo.gift_card_id,
                  waitForPassKit: true,
                  locationId: paymentLocationId,
                  notificationMetadata: {
                    customerId: referrer.square_customer_id,
                    friendCustomerId: customerId
                  }
                })
              } else {
                console.log('⚠️ Referrer load email skipped – missing email address or card number')
              }

              await recordReferralEvent({
                eventType: ReferralEventType.REWARD_GRANTED_REFERRER,
                referrerCustomerId: referrer.square_customer_id,
                friendCustomerId: customerId,
                amountCents: rewardAmountCents,
        metadata: addLocationMetadata(
          {
            referralCode: customer.used_referral_code,
            giftCardId: referrerInfo.gift_card_id
          },
          paymentLocationId
        )
              })
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

    // 3. Send referral code to NEW client (regardless of referral code usage)
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
        customer.phone_number,
        { locationId: paymentLocationId }
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

    // 4. Mark first payment as completed
    await prisma.$executeRaw`
      UPDATE square_existing_clients 
      SET first_payment_completed = TRUE
      WHERE square_customer_id = ${customerId}
    `

    const paymentAmountCents = extractPaymentAmountCents(paymentData)
    if (paymentAmountCents) {
      const paymentCurrency =
        paymentData.amountMoney?.currency ||
        paymentData.amount_money?.currency ||
        paymentData.totalMoney?.currency ||
        paymentData.total_money?.currency ||
        paymentData.approvedMoney?.currency ||
        paymentData.approved_money?.currency ||
        'USD'

      await recordRevenueEvent({
        paymentId: paymentId || null,
        bookingId: orderId || null,
        customerId,
        referrerCustomerId,
        amountCents: paymentAmountCents,
        currency: paymentCurrency,
        metadata: addLocationMetadata(
          {
            sourceType: paymentData.source_type || paymentData.sourceType || null,
            status: paymentData.status || null
          },
          paymentLocationId
        )
      })
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

    // Fix 1: Record payment as processed (idempotency)
    if (paymentId) {
      try {
        await prisma.processedEvent.create({
          data: { idempotencyKey: `payment:${paymentId}` }
        })
      } catch (error) {
        // Race condition - another process already recorded it, that's OK
        // Or table doesn't exist - log but don't fail
        if (error.code === 'P2002') {
          console.log(`Payment ${paymentId} already recorded (race condition)`)
        } else {
          console.warn(`⚠️ Could not record payment idempotency: ${error.message}`)
        }
      }
    }

  } catch (error) {
    console.error('Error processing payment completion:', error)
    paymentHadError = true
    if (runContext?.correlationId) {
      await markGiftCardRunError(prisma, runContext.correlationId, error, {
        stage: 'payment:error'
      })
    }
    throw error
  } finally {
    if (analyticsRun?.id) {
      await completeProcessRun({
        runId: analyticsRun.id,
        status: paymentHadError ? ProcessRunStatus.failed : ProcessRunStatus.completed,
        totals: {
          totalCount: 1,
          successCount: paymentHadError ? 0 : 1,
          failureCount: paymentHadError ? 1 : 0
        },
        metadata: {
          paymentId: paymentData.id || paymentData.paymentId || null,
          customerId: paymentData.customerId || paymentData.customer_id || null
        }
      })
    }
  }

  if (paymentHadError) {
    throw new Error('Payment completion encountered errors')
  }
}

// Process booking creation (when customer actually books)
async function processBookingCreated(bookingData, runContext = {}) {
  let bookingHadError = false
  try {
    // Get customer ID from booking - can be in customerId or creator_details.customer_id
    const customerId =
      bookingData.customerId ||
      bookingData.customer_id ||
      bookingData.creator_details?.customer_id
    if (!customerId) {
      console.log('No customer ID in booking data, skipping...')
      console.log('Booking data received:', safeStringify(bookingData))
      return
    }

    // Fix 2: Check if booking was already processed (idempotency)
    const bookingId = bookingData.id || bookingData.bookingId
    if (bookingId) {
      try {
        // Check RefMatch table (primary check)
        const existingMatch = await prisma.refMatch.findUnique({
          where: { bookingId }
        })
        if (existingMatch) {
          console.log(`⚠️ Booking ${bookingId} already processed (RefMatch exists), skipping...`)
          return
        }
        
        // Check ProcessedEvent table (backup check)
        const idempotencyKey = `booking:${bookingId}`
        const existing = await prisma.processedEvent.findUnique({
          where: { idempotencyKey }
        })
        if (existing) {
          console.log(`⚠️ Booking ${bookingId} already processed (ProcessedEvent exists), skipping...`)
          return
        }
      } catch (error) {
        // If tables don't exist or query fails, log and continue
        console.warn(`⚠️ Could not check booking idempotency: ${error.message}`)
      }
    }

    console.log(`📅 Processing booking created for customer: ${customerId}`)
    console.log('Full booking data:', safeStringify(bookingData))
    const bookingLocationId = getFriendlyLocationIdFromBooking(bookingData)
    if (bookingLocationId) {
      console.log(`📍 Booking attributed to location: ${bookingLocationId}`)
    }

    await recordAnalyticsEvent({
      eventType: 'booking_created',
      squareCustomerId: customerId,
      bookingId,
      source: bookingData.sourceType || bookingData.locationType || null,
      metadata: addLocationMetadata(
        {
          status: bookingData.status || null,
          serviceCount: Array.isArray(bookingData.appointments) ? bookingData.appointments.length : null
        },
        bookingLocationId
      )
    })

    if (runContext?.correlationId) {
      await updateGiftCardRunStage(prisma, runContext.correlationId, {
        stage: 'booking:received',
        status: 'running',
        payload: bookingData,
        context: { customerId }
      })
    }

    // Check if customer exists in our database
    console.log('🔍 Step 1: Checking if customer exists in database...')
    let customerExists = await prisma.$queryRaw`
      SELECT square_customer_id, got_signup_bonus, used_referral_code, email_address,
             given_name, family_name, phone_number, gift_card_id,
             gift_card_order_id, gift_card_line_item_uid, gift_card_delivery_channel,
             gift_card_activation_url, gift_card_pass_kit_url, gift_card_digital_email
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    console.log(`   Found ${customerExists?.length || 0} customer(s) in database`)

    // If customer doesn't exist, they are truly new - need to add them
    if (!customerExists || customerExists.length === 0) {
      console.log(`ℹ️ Customer ${customerId} not in database yet - need to add them first`)
      
      // Fetch customer details from Square API
      try {
        const response = await getCustomersApi().retrieveCustomer(customerId)
        const squareCustomer = response.result.customer
        
        console.log(`📥 Fetching customer from Square:`, safeStringify(squareCustomer))
        
        // Add customer to database
        const ipAddress = 'unknown' // No IP from Square API
        
        const squareGivenName = cleanValue(squareCustomer.givenName)
        const squareFamilyName = cleanValue(squareCustomer.familyName)
        const squareEmail = cleanValue(squareCustomer.emailAddress)
        const squarePhone = cleanValue(squareCustomer.phoneNumber)

        await prisma.$executeRaw`
          INSERT INTO square_existing_clients (
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
            first_ip_address,
            ip_addresses,
            referral_email_sent,
            created_at,
            updated_at
          ) VALUES (
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
            ${ipAddress},
            ARRAY[${ipAddress}],
            FALSE,
            NOW(),
            NOW()
          )
          ON CONFLICT (square_customer_id) DO UPDATE SET
            given_name = COALESCE(square_existing_clients.given_name, EXCLUDED.given_name),
            family_name = COALESCE(square_existing_clients.family_name, EXCLUDED.family_name),
            email_address = COALESCE(square_existing_clients.email_address, EXCLUDED.email_address),
            phone_number = COALESCE(square_existing_clients.phone_number, EXCLUDED.phone_number),
            updated_at = NOW()
        `
        
        console.log(`✅ Added new customer from booking webhook`)
        
        // Re-fetch customer from database
        const newCustomerData = await prisma.$queryRaw`
          SELECT square_customer_id, got_signup_bonus, used_referral_code, email_address,
                 given_name, family_name, gift_card_id,
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
    console.log(`   Customer: ${customer.given_name} ${customer.family_name}`)

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

    // Fix 4: Check if customer already received gift card (prevent duplicate friend rewards)
    if (customer.got_signup_bonus || customer.gift_card_id) {
      console.log(`⚠️ Customer ${customerId} already received gift card (got_signup_bonus=${customer.got_signup_bonus}, gift_card_id=${customer.gift_card_id}), skipping friend reward...`)
      return
    }

    console.log(`🎉 First booking detected for customer: ${customerId}`)
    console.log(`   Name: ${customer.given_name} ${customer.family_name}`)
    console.log('🔍 Step 3: Checking for referral code...')

    // Get referral code from booking data or custom attributes
    let referralCode = null
    
    // First check if booking has referral code data
    if (bookingData.serviceVariationCapabilityDetails) {
      // Try to get from booking extension data
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

    // Next check booking-level custom fields (Square Booking custom field feature)
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
            const testReferrer = await findReferrerByCode(value)
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

    // Check appointment segment custom fields (some Square configs store custom fields per segment)
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
              const testReferrer = await findReferrerByCode(value)
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
    
    // If not found in booking, check custom attributes
    if (!referralCode) {
      console.log(`   No referral code in booking, checking custom attributes...`)
      const attributes = await getCustomerCustomAttributes(customerId)
      console.log(`   Custom attributes from Square:`, safeStringify(attributes))
      
      // First, check for a specific 'referral_code' key
      if (attributes['referral_code']) {
        const codeValue = attributes['referral_code']
        console.log(`   🎯 Found 'referral_code' attribute with value: "${codeValue}"`)
        const testReferrer = await findReferrerByCode(codeValue)
        if (testReferrer) {
          referralCode = codeValue
          console.log(`   ✅ Valid referral code found: ${codeValue}`)
          console.log(`   ✅ Referrer: ${testReferrer.given_name} ${testReferrer.family_name} (${testReferrer.square_customer_id})`)
        } else {
          console.log(`   ⚠️ 'referral_code' value "${codeValue}" not found in database`)
        }
      }
      
      // If still not found, check all custom attribute values for a referral code
      // IMPORTANT: Check ALL values, including Square-generated keys, because referral codes
      // can be stored under any key (like square:xxx-xxx-xxx)
      if (!referralCode) {
        console.log(`   🔍 Checking all custom attribute values for valid referral codes...`)
        for (const [key, value] of Object.entries(attributes)) {
          if (typeof value === 'string' && value.length > 0) {
            console.log(`   🔍 Checking custom attribute value: "${value}" (key: ${key})`)
            
            // Check if value looks like a referral code (alphanumeric, 4-15 chars)
            // Skip obvious non-codes (very long text, reviews, etc.)
            if (value.length > 20 || value.split(' ').length > 3) {
              console.log(`   ⏭️ Skipping value "${value}" - looks like text/review, not a code`)
              continue
            }
            
            // Try to match this value as a referral code by checking if it exists in our database
            // If code exists in database, it means referrer completed first payment and has personal_code
            const testReferrer = await findReferrerByCode(value)
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

    // NOW check for referral code and give gift card
    if (referralCode) {
      console.log(`🎁 Customer used referral code: ${referralCode}`)

      // Find the referrer
      const referrer = await findReferrerByCode(referralCode)

      if (referrer) {
        console.log(`👤 Found referrer: ${referrer.given_name} ${referrer.family_name}`)
        
        // Give friend their $10 gift card IMMEDIATELY
        const locationId = process.env.SQUARE_LOCATION_ID?.trim()
        const rewardAmountCents = 1000
        const rewardAmountMoney = { amount: rewardAmountCents, currency: 'USD' }
        let orderInfoForActivation = null

        // Create promotion order for friend reward (same as referrer reward)
        if (locationId) {
          const promotionOrder = await createPromotionOrder(
            customerId,
            rewardAmountMoney,
            'Friend signup bonus $10',
            locationId,
            runContext?.correlationId
              ? { idempotencyKeySeed: buildStageKey(runContext.correlationId, 'friend_reward', 'promo-order') }
              : {}
          )

          if (promotionOrder?.orderId && promotionOrder?.lineItemUid) {
            const paymentResult = await completePromotionOrderPayment(
              promotionOrder.orderId,
              promotionOrder.amountMoney,
              locationId,
              'Friend signup bonus gift card',
              runContext?.correlationId
                ? { idempotencyKeySeed: buildStageKey(runContext.correlationId, 'friend_reward', 'promo-payment') }
                : {}
            )

            if (paymentResult.success) {
              orderInfoForActivation = {
                orderId: promotionOrder.orderId,
                lineItemUid: promotionOrder.lineItemUid
              }
            } else {
              console.warn('⚠️ Owner-funded payment failed for friend reward order, falling back to owner-funded activation')
            }
          } else {
            console.warn('⚠️ Failed to create friend reward order, falling back to owner-funded activation')
          }
        } else {
          console.warn('⚠️ SQUARE_LOCATION_ID missing – cannot create eGift order for friend reward')
        }

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
          orderInfo: orderInfoForActivation || undefined,
          idempotencyKeySeed: runContext?.correlationId
            ? buildStageKey(runContext.correlationId, 'friend_reward', 'issue')
            : undefined
        }
        const friendGiftCard = await createGiftCard(
          customerId,
          `${customer.given_name || ''} ${customer.family_name || ''}`.trim(),
          rewardAmountCents, // $10
          false, // Friend gift card
          friendGiftCardOptions
        )

        if (friendGiftCard?.giftCardId) {
          // Update customer with gift card
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

          await recordReferralEvent({
            eventType: ReferralEventType.CODE_REDEEMED,
            referrerCustomerId: referrer.square_customer_id,
            friendCustomerId: customerId,
            metadata: addLocationMetadata(
              {
                referralCode,
                bookingId,
                friendGiftCardId: friendGiftCard.giftCardId
              },
              bookingLocationId
            )
          })

          await recordReferralEvent({
            eventType: ReferralEventType.REWARD_GRANTED_NEW,
            referrerCustomerId: referrer.square_customer_id,
            friendCustomerId: customerId,
            amountCents: friendGiftCard.amountCents,
            metadata: addLocationMetadata(
              {
                referralCode,
                giftCardId: friendGiftCard.giftCardId
              },
              bookingLocationId
            )
          })

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
              passKitUrl: friendGiftCard.passKitUrl,
              giftCardId: friendGiftCard.giftCardId,
              waitForPassKit: true,
              locationId: bookingLocationId,
              notificationMetadata: {
                customerId,
                referralCode
              }
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

    // Fix 2: Record booking as processed (idempotency)
    if (bookingId && !bookingHadError) {
      try {
        await prisma.processedEvent.create({
          data: { idempotencyKey: `booking:${bookingId}` }
        })
      } catch (error) {
        // Race condition - another process already recorded it, that's OK
        // Or table doesn't exist - log but don't fail
        if (error.code === 'P2002') {
          console.log(`Booking ${bookingId} already recorded (race condition)`)
        } else {
          console.warn(`⚠️ Could not record booking idempotency: ${error.message}`)
        }
      }
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

// Note: These functions are available via lib/webhooks/giftcard-processors.js
// We cannot export them here as Next.js routes only allow HTTP method exports

export async function POST(request) {
  try {
    // Fix 5: Validate environment variables (non-blocking, log warnings)
    const envValidation = validateEnvironmentVariables()
    if (!envValidation.valid) {
      // Only warn about critical (required) variables
      // Email variables are optional (email service not configured yet)
      const criticalErrors = envValidation.errors.filter(error => 
        !error.includes('BUSINESS_EMAIL') && !error.includes('GMAIL_APP_PASSWORD')
      )
      
      if (criticalErrors.length > 0) {
        console.warn('⚠️ Environment variable validation failed:')
        criticalErrors.forEach(error => {
          console.warn(`   - ${error}`)
        })
      }
      
      // Log email service status separately (informational, not warning)
      const emailConfigured = process.env.BUSINESS_EMAIL && process.env.GMAIL_APP_PASSWORD
      if (!emailConfigured) {
        console.log('ℹ️ Email service not configured (BUSINESS_EMAIL/GMAIL_APP_PASSWORD missing) - emails will be skipped')
      }
      
      // Don't block webhook processing, but log the issue
      // Critical vars will fail later in the code anyway
    }

    // Get raw body as text - this is the unmodified body needed for signature verification
    const body = await request.text()
    
    console.log('📡 Received webhook request')
    console.log('📦 Webhook body length:', body.length)
    console.log('📦 Body hex preview:', Buffer.from(body, 'utf8').subarray(0, 32).toString('hex'))
    console.log('📦 Body base64 preview:', Buffer.from(body, 'utf8').toString('base64').slice(0, 48))
    
    const signatureHeader = request.headers.get('x-square-hmacsha256-signature') ||
                           request.headers.get('x-square-signature')
    console.log('🔐 Signature header received:', signatureHeader)
    
    if (!signatureHeader) {
      console.error('Missing Square webhook signature header')
      return Response.json({ error: 'Missing signature' }, { status: 401 })
    }
    
    const webhookSecret = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || request.headers.get('x-square-webhook-secret')
    console.log('🔑 Webhook secret loaded:', webhookSecret ? '[present]' : '[missing]')
    if (!webhookSecret) {
      console.error('Missing SQUARE_WEBHOOK_SIGNATURE_KEY environment variable')
      return Response.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }
    
    // Get notification URL - try multiple sources
    const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host')
    const protocolHeader = request.headers.get('x-forwarded-proto') || 'https'
    const pathname = request.nextUrl.pathname
    const computedNotificationUrl = hostHeader ? `${protocolHeader}://${hostHeader}${pathname}` : request.url
    
    // Remove trailing slash if present (Square doesn't include it)
    const normalizeUrl = (url) => {
      if (!url) return url
      return url.trim().replace(/\/$/, '')
    }
    
    const configuredNotificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL?.trim()
      ? normalizeUrl(process.env.SQUARE_WEBHOOK_NOTIFICATION_URL.trim())
      : null
    
    const normalizedComputedUrl = normalizeUrl(computedNotificationUrl)
    
    console.log('🌐 Notification URL computed:', normalizedComputedUrl)
    if (configuredNotificationUrl) {
      console.log('🌐 Configured notification URL:', configuredNotificationUrl)
    }
    
    // Ensure WebhooksHelper is available before attempting signature verification
    const WebhooksHelper = getWebhooksHelper()
    if (!WebhooksHelper || typeof WebhooksHelper.isValidWebhookEventSignature !== 'function') {
      console.error('❌ Square WebhooksHelper is not available from SDK')
      return Response.json({ error: 'Webhook verifier unavailable' }, { status: 500 })
    }

    const verificationAttempts = []
    let verificationSourceUrl = null
    let isValidSignature = false

    const cleanedSignature = signatureHeader.trim()
    const cleanedSecret = webhookSecret.trim()

    // Try verification with both string and Buffer body formats
    const tryVerification = (candidateUrl, label, useBuffer = false) => {
      if (!candidateUrl) {
        verificationAttempts.push({
          label,
          notificationUrl: candidateUrl,
          valid: false,
          reason: 'missing-url'
        })
        return false
      }

      const normalizedUrl = normalizeUrl(candidateUrl)
      if (!normalizedUrl) {
        verificationAttempts.push({
          label,
          notificationUrl: candidateUrl,
          valid: false,
          reason: 'empty-url'
        })
        return false
      }

      try {
        // Try with string body first, then Buffer if that fails
        const bodyForVerification = useBuffer ? Buffer.from(body, 'utf8') : body
        
        // Try SDK method first
        let valid = false
        try {
          valid = WebhooksHelper.isValidWebhookEventSignature(
            bodyForVerification,
            cleanedSignature,
            cleanedSecret,
            normalizedUrl
          )
        } catch (sdkError) {
          // If SDK method fails, try manual verification
          console.log(`   SDK verification failed, trying manual method: ${sdkError.message}`)
          valid = verifySquareSignatureManually(body, cleanedSignature, cleanedSecret, normalizedUrl)
        }
        
        verificationAttempts.push({
          label: useBuffer ? `${label} (Buffer)` : label,
          notificationUrl: normalizedUrl,
          valid,
          bodyFormat: useBuffer ? 'Buffer' : 'string',
          method: 'sdk'
        })
        
        // If SDK method failed, try manual verification
        if (!valid) {
          const manualValid = verifySquareSignatureManually(body, cleanedSignature, cleanedSecret, normalizedUrl)
          if (manualValid) {
            verificationAttempts.push({
              label: useBuffer ? `${label} (Buffer, manual)` : `${label} (manual)`,
              notificationUrl: normalizedUrl,
              valid: true,
              bodyFormat: useBuffer ? 'Buffer' : 'string',
              method: 'manual'
            })
            valid = true
          }
        }
        
        if (valid) {
          verificationSourceUrl = normalizedUrl
        }
        return valid
      } catch (error) {
        verificationAttempts.push({
          label: useBuffer ? `${label} (Buffer)` : label,
          notificationUrl: normalizedUrl,
          valid: false,
          reason: 'helper-error',
          error: error.message,
          bodyFormat: useBuffer ? 'Buffer' : 'string'
        })
        return false
      }
    }

    // Try configured URL first (if set)
    if (configuredNotificationUrl) {
      console.log('🌐 Attempting verification with configured URL...')
      isValidSignature = tryVerification(configuredNotificationUrl, 'configured')
      
      // If string format failed, try Buffer format
      if (!isValidSignature) {
        isValidSignature = tryVerification(configuredNotificationUrl, 'configured', true)
      }
      
      // Try with trailing slash if no trailing slash version failed
      if (!isValidSignature && !configuredNotificationUrl.endsWith('/')) {
        isValidSignature = tryVerification(configuredNotificationUrl + '/', 'configured-with-slash')
        if (!isValidSignature) {
          isValidSignature = tryVerification(configuredNotificationUrl + '/', 'configured-with-slash', true)
        }
      }
    }

    // Fallback to computed URL if configured URL failed or not set
    if (!isValidSignature) {
      console.log('🌐 Attempting verification with computed URL...')
      isValidSignature = tryVerification(normalizedComputedUrl, configuredNotificationUrl ? 'computed-fallback' : 'computed')
      
      // If string format failed, try Buffer format
      if (!isValidSignature) {
        isValidSignature = tryVerification(normalizedComputedUrl, configuredNotificationUrl ? 'computed-fallback' : 'computed', true)
      }
      
      // Try with trailing slash if no trailing slash version failed
      if (!isValidSignature && !normalizedComputedUrl.endsWith('/')) {
        isValidSignature = tryVerification(normalizedComputedUrl + '/', 'computed-with-slash')
        if (!isValidSignature) {
          isValidSignature = tryVerification(normalizedComputedUrl + '/', 'computed-with-slash', true)
        }
      }
    }

    if (!isValidSignature) {
      console.error('❌ Invalid Square webhook signature')
      console.error('🔍 Debug signature context:', safeStringify({
        configuredNotificationUrl: configuredNotificationUrl || null,
        computedNotificationUrl: normalizedComputedUrl,
        bodyLength: body.length,
        bodyEncoding: 'utf8',
        signatureHeaderPreview: signatureHeader?.slice(0, 24) || null,
        secretLength: cleanedSecret.length,
        verificationAttempts
      }))
      console.error('💡 Troubleshooting tips:')
      console.error('   1. Verify SQUARE_WEBHOOK_SIGNATURE_KEY matches Square Dashboard')
      console.error('   2. Verify SQUARE_WEBHOOK_NOTIFICATION_URL matches EXACTLY (including protocol, no trailing slash)')
      console.error('   3. Check that the URL in Square Dashboard matches:', configuredNotificationUrl || normalizedComputedUrl)
      console.error('   4. Ensure body is not modified before verification')
      const debugEnabled = process.env.ENABLE_SIGNATURE_DEBUG === 'true'
      const responsePayload = debugEnabled
        ? {
            error: 'Invalid signature',
            computedNotificationUrl: normalizedComputedUrl,
            configuredNotificationUrl: configuredNotificationUrl || null,
            attempts: verificationAttempts,
            troubleshooting: {
              tip1: 'Verify SQUARE_WEBHOOK_SIGNATURE_KEY matches Square Dashboard',
              tip2: 'Verify SQUARE_WEBHOOK_NOTIFICATION_URL matches EXACTLY (including protocol, no trailing slash)',
              tip3: `Check that the URL in Square Dashboard matches: ${configuredNotificationUrl || normalizedComputedUrl}`,
              tip4: 'Ensure body is not modified before verification'
            }
          }
        : { error: 'Invalid signature' }
      return Response.json(responsePayload, { status: 401 })
    }
    
    console.log('✅ Webhook signature verified using URL:', verificationSourceUrl || normalizedComputedUrl)
    
    const webhookData = JSON.parse(body)
    console.log('📡 Received Square webhook:', webhookData.type)
    console.log('📦 Full webhook data:', safeStringify(webhookData))

    // Process customer.created events (new customer detected)
    if (webhookData.type === 'customer.created') {
      const customerData = webhookData.data.object.customer
      
      if (customerData && (customerData.id || customerData.customerId || customerData.customer_id)) {
        const customerResourceId = customerData.id || customerData.customerId || customerData.customer_id
        const correlationId = buildCorrelationId({
          triggerType: webhookData.type,
          eventId: webhookData.event_id,
          resourceId: customerResourceId
        })

        const runContext = { correlationId }
        const requestStub = { headers: { get: () => null }, connection: null }

        // Try to queue the job (async processing)
        const jobQueued = await enqueueGiftCardJob(prisma, {
          correlationId,
          triggerType: webhookData.type,
          stage: 'customer_ingest',
          payload: customerData,
          context: {
            customerId: customerResourceId,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type
          }
        })

        if (jobQueued) {
          // Job queue is available - process asynchronously
          await ensureGiftCardRun(prisma, {
            correlationId,
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type,
            resourceId: customerResourceId,
            stage: 'customer_ingest:queued',
            status: 'queued',
            payload: customerData,
            context: {
              customerId: customerResourceId
            }
          })

          await updateGiftCardRunStage(prisma, correlationId, {
            stage: 'customer_ingest:queued',
            status: 'queued',
            context: {
              customerId: customerResourceId
            }
          })

          logInfo('giftcard.job.enqueued', {
            correlationId,
            stage: 'customer_ingest',
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            resourceId: customerResourceId
          })

          return Response.json({
            success: true,
            queued: true,
            correlationId,
            customerId: customerResourceId
          }, { status: 202 })
        } else {
          // Job queue not available - process synchronously
          console.log('⚡ Job queue not available - processing customer synchronously')
          
          await ensureGiftCardRun(prisma, {
            correlationId,
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type,
            resourceId: customerResourceId,
            stage: 'customer_ingest:start',
            status: 'running',
            payload: customerData,
            context: {
              customerId: customerResourceId
            }
          })

          // Process immediately
          await processCustomerCreated(customerData, requestStub, runContext)

          await updateGiftCardRunStage(prisma, correlationId, {
            stage: 'customer_ingest:completed',
            status: 'completed',
            clearError: true
          })

          logInfo('giftcard.customer.processed', {
            correlationId,
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            resourceId: customerResourceId
          })

          return Response.json({
            success: true,
            processed: true,
            correlationId,
            customerId: customerResourceId
          }, { status: 200 })
        }
      }
      
      logWarn('giftcard.webhook.customer.missing_id', {
        squareEventId: webhookData.event_id
      })
    }

    // Process booking.created events (when customer actually books)
    if (webhookData.type === 'booking.created') {
      const bookingData = webhookData.data.object.booking
      
      console.log('🚀 About to process booking.created')
      console.log('   bookingData.customer_id:', bookingData?.customer_id)
      console.log('   bookingData.customerId:', bookingData?.customerId)
      
      if (bookingData && (bookingData.customerId || bookingData.customer_id)) {
        console.log('✅ Booking data valid, processing...')
        const bookingResourceId = bookingData.id || bookingData.bookingId || bookingData.appointment_id || bookingData.reservationId
        const correlationId = buildCorrelationId({
          triggerType: webhookData.type,
          eventId: webhookData.event_id,
          resourceId: bookingResourceId || (bookingData.customerId || bookingData.customer_id)
        })

        const runContext = { correlationId }

        // Try to queue the job (async processing)
        const jobQueued = await enqueueGiftCardJob(prisma, {
          correlationId,
          triggerType: webhookData.type,
          stage: 'booking',
          payload: bookingData,
          context: {
            customerId: bookingData.customerId || bookingData.customer_id || null,
            bookingId: bookingResourceId || null,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type
          }
        })

        if (jobQueued) {
          // Job queue is available - process asynchronously
          console.log('📦 Job queued for async processing')
          
          await ensureGiftCardRun(prisma, {
            correlationId,
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type,
            resourceId: bookingResourceId,
            stage: 'booking:queued',
            status: 'queued',
            payload: bookingData,
            context: {
              customerId: bookingData.customerId || bookingData.customer_id || null,
              bookingId: bookingResourceId || null
            }
          })

          await updateGiftCardRunStage(prisma, correlationId, {
            stage: 'booking:queued',
            status: 'queued',
            context: {
              customerId: bookingData.customerId || bookingData.customer_id || null,
              bookingId: bookingResourceId || null
            }
          })

          logInfo('giftcard.job.enqueued', {
            correlationId,
            stage: 'booking',
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            resourceId: bookingResourceId,
            customerId: bookingData.customerId || bookingData.customer_id || null
          })

          return Response.json({
            success: true,
            queued: true,
            correlationId,
            bookingId: bookingResourceId
          }, { status: 202 })
        } else {
          // Job queue not available - process synchronously
          console.log('⚡ Job queue not available - processing synchronously')
          
          await ensureGiftCardRun(prisma, {
            correlationId,
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type,
            resourceId: bookingResourceId,
            stage: 'booking:start',
            status: 'running',
            payload: bookingData,
            context: {
              customerId: bookingData.customerId || bookingData.customer_id || null,
              bookingId: bookingResourceId || null
            }
          })

          // Process immediately
          await processBookingCreated(bookingData, runContext)

          await updateGiftCardRunStage(prisma, correlationId, {
            stage: 'booking:completed',
            status: 'completed',
            clearError: true
          })

          logInfo('giftcard.booking.processed', {
            correlationId,
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            resourceId: bookingResourceId,
            customerId: bookingData.customerId || bookingData.customer_id || null
          })

          return Response.json({
            success: true,
            processed: true,
            correlationId,
            bookingId: bookingResourceId
          }, { status: 200 })
        }
      } else {
        console.log('❌ Invalid booking data - no customerId or customer_id')
        logWarn('giftcard.webhook.booking.invalid', {
          squareEventId: webhookData.event_id,
          bookingId: bookingData?.id ?? null
        })
      }
    }

    // Process payment.created events (any payment type including cash)
    if (webhookData.type === 'payment.created') {
      const paymentData = webhookData.data.object.payment
      
      console.log('💰 Received payment.created event')
      console.log('   Payment data:', safeStringify(paymentData))
      
      if (paymentData && paymentData.status === 'COMPLETED') {
        console.log('✅ Payment completed, processing...')
        const paymentResourceId = paymentData.id || paymentData.paymentId
        const customerIdFromPayment = paymentData.customerId || paymentData.customer_id || null
        const correlationId = buildCorrelationId({
          triggerType: webhookData.type,
          eventId: webhookData.event_id,
          resourceId: paymentResourceId || customerIdFromPayment
        })

        const runContext = { correlationId }

        // Try to queue the job (async processing)
        const jobQueued = await enqueueGiftCardJob(prisma, {
          correlationId,
          triggerType: webhookData.type,
          stage: 'payment',
          payload: paymentData,
          context: {
            customerId: customerIdFromPayment,
            paymentId: paymentResourceId,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type
          }
        })

        if (jobQueued) {
          // Job queue is available - process asynchronously
          await ensureGiftCardRun(prisma, {
            correlationId,
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type,
            resourceId: paymentResourceId,
            stage: 'payment:queued',
            status: 'queued',
            payload: paymentData,
            context: {
              customerId: customerIdFromPayment,
              paymentId: paymentResourceId
            }
          })

          await updateGiftCardRunStage(prisma, correlationId, {
            stage: 'payment:queued',
            status: 'queued',
            context: {
              customerId: customerIdFromPayment,
              paymentId: paymentResourceId
            }
          })
          
          logInfo('giftcard.job.enqueued', {
            correlationId,
            stage: 'payment',
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            resourceId: paymentResourceId,
            customerId: customerIdFromPayment
          })
          
          return Response.json({
            success: true,
            queued: true,
            correlationId,
            paymentId: paymentResourceId
          }, { status: 202 })
        } else {
          // Job queue not available - process synchronously
          console.log('⚡ Job queue not available - processing payment synchronously')
          
          await ensureGiftCardRun(prisma, {
            correlationId,
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type,
            resourceId: paymentResourceId,
            stage: 'payment:start',
            status: 'running',
            payload: paymentData,
            context: {
              customerId: customerIdFromPayment,
              paymentId: paymentResourceId
            }
          })

          // Process immediately
          await processPaymentCompletion(paymentData, runContext)

          await updateGiftCardRunStage(prisma, correlationId, {
            stage: 'payment:completed',
            status: 'completed',
            clearError: true
          })

          logInfo('giftcard.payment.processed', {
            correlationId,
            triggerType: webhookData.type,
            squareEventId: webhookData.event_id,
            resourceId: paymentResourceId,
            customerId: customerIdFromPayment
          })

          return Response.json({
            success: true,
            processed: true,
            correlationId,
            paymentId: paymentResourceId
          }, { status: 200 })
        }
      }
    }

    // Process payment.updated events (status changes like refunds, voids, etc.)
    if (webhookData.type === 'payment.updated') {
      const paymentData = webhookData.data.object.payment
      
      console.log('💰 Received payment.updated event')
      
      if (paymentData && paymentData.status === 'COMPLETED') {
        console.log('✅ Payment completed, processing...')
        const paymentResourceId = paymentData.id || paymentData.paymentId
        const customerIdFromPayment = paymentData.customerId || paymentData.customer_id || null
        const correlationId = buildCorrelationId({
          triggerType: webhookData.type,
          eventId: webhookData.event_id,
          resourceId: paymentResourceId || customerIdFromPayment
        })

        await ensureGiftCardRun(prisma, {
          correlationId,
          triggerType: webhookData.type,
          squareEventId: webhookData.event_id,
          squareEventType: webhookData.type,
          resourceId: paymentResourceId,
          stage: 'payment:queued',
          status: 'queued',
          payload: paymentData,
          context: {
            customerId: customerIdFromPayment,
            paymentId: paymentResourceId
          }
        })

        await enqueueGiftCardJob(prisma, {
          correlationId,
          triggerType: webhookData.type,
          stage: 'payment',
          payload: paymentData,
          context: {
            customerId: customerIdFromPayment,
            paymentId: paymentResourceId,
            squareEventId: webhookData.event_id,
            squareEventType: webhookData.type
          }
        })

        await updateGiftCardRunStage(prisma, correlationId, {
          stage: 'payment:queued',
          status: 'queued',
          context: {
            customerId: customerIdFromPayment,
            paymentId: paymentResourceId
          }
        })
        
        logInfo('giftcard.job.enqueued', {
          correlationId,
          stage: 'payment',
          triggerType: webhookData.type,
          squareEventId: webhookData.event_id,
          resourceId: paymentResourceId,
          customerId: customerIdFromPayment
        })
        
        return Response.json({
          success: true,
          queued: true,
          correlationId,
          paymentId: paymentResourceId
        }, { status: 202 })
      }
    }

    // For other event types, just acknowledge receipt
    return Response.json({
      success: true,
      message: 'Webhook received',
      eventType: webhookData.type
    })

  } catch (error) {
    console.error('Webhook processing error:', error)
    console.error('Stack:', error.stack)
    logError('giftcard.webhook.unhandled_error', {
      message: error.message,
      stack: error.stack
    })
    
    // Return 200 OK to prevent Square from retrying
    // This prevents duplicate notifications
    // The error is logged but we acknowledge receipt
    return Response.json(
      { 
        error: 'Internal server error',
        acknowledged: true,
        message: 'Webhook received but processing encountered an error. Check logs for details.'
      },
      { status: 200 }
    )
  }
}

// Handle GET requests for webhook verification
export async function GET(request) {
  return Response.json({
    message: 'Square Referral Webhook Handler',
    status: 'active',
    timestamp: new Date().toISOString()
  })
}

