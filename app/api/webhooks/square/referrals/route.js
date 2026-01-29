const prisma = require('../../../../../lib/prisma-client')
const crypto = require('crypto')
const QRCode = require('qrcode')
const { sendReferralCodeEmail, sendGiftCardIssuedEmail, sendReferralCodeUsageNotification } = require('../../../../../lib/email-service-simple')
const { sendReferralCodeSms, REFERRAL_PROGRAM_SMS_TEMPLATE } = require('../../../../../lib/twilio-service')
const { normalizeGiftCardNumber } = require('../../../../../lib/wallet/giftcard-number-utils')
// Import payment saving function from main webhook handler
// Note: route.js uses ES6 exports, so we need to use dynamic import
// Since this is a CommonJS file, we'll use a simpler approach: directly call the function
// by requiring the module and accessing the export
let savePaymentToDatabase = null
async function getSavePaymentToDatabase() {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:12',message:'getSavePaymentToDatabase called',data:{hasCached:!!savePaymentToDatabase},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  if (!savePaymentToDatabase) {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:15',message:'importing savePaymentToDatabase',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
      // #endregion
      // Use dynamic import which works in both CommonJS and ES modules
      const mainWebhookRoute = await import('../route.js')
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:17',message:'import completed',data:{hasModule:!!mainWebhookRoute,exports:Object.keys(mainWebhookRoute||{}),hasSavePayment:!!mainWebhookRoute?.savePaymentToDatabase},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
      // #endregion
      savePaymentToDatabase = mainWebhookRoute.savePaymentToDatabase
      if (!savePaymentToDatabase) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:19',message:'savePaymentToDatabase not found in exports',data:{exports:Object.keys(mainWebhookRoute||{})},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
        // #endregion
        console.error('❌ savePaymentToDatabase not found in imported module')
        console.error('   Available exports:', Object.keys(mainWebhookRoute || {}))
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:22',message:'savePaymentToDatabase imported successfully',data:{type:typeof savePaymentToDatabase},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'K'})}).catch(()=>{});
        // #endregion
      }
    } catch (importError) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:24',message:'import error',data:{error:importError.message,stack:importError.stack?.substring(0,500)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'L'})}).catch(()=>{});
      // #endregion
      console.error(`❌ Error importing savePaymentToDatabase: ${importError.message}`)
      console.error('   Stack:', importError.stack)
      return null
    }
  }
  return savePaymentToDatabase
}
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
    locationsApi: squareClient.locationsApi,
  }
  return squareApisCache
}

const getCustomersApi = () => getSquareApis().customersApi
const getGiftCardsApi = () => getSquareApis().giftCardsApi
const getGiftCardActivitiesApi = () => getSquareApis().giftCardActivitiesApi
const getCustomerCustomAttributesApi = () => getSquareApis().customerCustomAttributesApi
const getOrdersApi = () => getSquareApis().ordersApi
const getPaymentsApi = () => getSquareApis().paymentsApi
const getLocationsApi = () => getSquareApis().locationsApi
const getWebhooksHelper = () => getSquareApis().WebhooksHelper

const DELIVERY_CHANNELS = {
  SQUARE_EGIFT_ORDER: 'square_egift_order',
  OWNER_FUNDED_ACTIVATE: 'owner_funded_activate',
  OWNER_FUNDED_ADJUST: 'owner_funded_adjust'
}

// ============================================================================
// Helper: Resolve organization_id from square_merchant_id
// ============================================================================
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

// Helper: Fetch location from Square API and update merchant_id in database
// ============================================================================
async function fetchAndUpdateLocationFromSquare(squareLocationId) {
  if (!squareLocationId) {
    return null
  }
  
  try {
    const locationsApi = getLocationsApi()
    const response = await locationsApi.retrieveLocation(squareLocationId)
    const location = response.result?.location
    
    if (!location) {
      console.warn(`⚠️ Location ${squareLocationId} not found in Square API`)
      return null
    }
    
    // Square API returns merchantId (camelCase), not merchant_id
    const merchantId = location.merchantId || location.merchant_id || null
    
    if (!merchantId) {
      console.warn(`⚠️ Location ${squareLocationId} missing merchant_id in Square API response`)
      return null
    }
    
    // Update location in database with merchant_id
    // First, try to find existing location by square_location_id (without organization_id)
    const existingLocation = await prisma.$queryRaw`
      SELECT id, organization_id, square_location_id, square_merchant_id
      FROM locations
      WHERE square_location_id = ${squareLocationId}
      LIMIT 1
    `
    
    if (existingLocation && existingLocation.length > 0) {
      const loc = existingLocation[0]
      
      // Update merchant_id if it's missing or different
      if (loc.square_merchant_id !== merchantId) {
        await prisma.$executeRaw`
          UPDATE locations
          SET square_merchant_id = ${merchantId},
              updated_at = NOW()
          WHERE id = ${loc.id}::uuid
        `
        console.log(`✅ Updated location ${squareLocationId} with merchant_id: ${merchantId}`)
      }
      
      return {
        locationId: loc.id,
        organizationId: loc.organization_id,
        squareLocationId: squareLocationId,
        merchantId: merchantId,
        name: location.name || `Location ${squareLocationId.substring(0, 8)}...`,
        address: location.address || null
      }
    } else {
      // Location doesn't exist in DB yet - we'll need organization_id to create it
      // But we can return the merchant_id so caller can resolve organization_id
      console.log(`ℹ️ Location ${squareLocationId} not in database yet, but fetched merchant_id: ${merchantId}`)
      return {
        locationId: null,
        organizationId: null,
        squareLocationId: squareLocationId,
        merchantId: merchantId,
        name: location.name || `Location ${squareLocationId.substring(0, 8)}...`,
        address: location.address || null
      }
    }
  } catch (error) {
    console.error(`❌ Error fetching location from Square API: ${error.message}`)
    if (error.errors) {
      console.error(`   Square API errors:`, JSON.stringify(error.errors, null, 2))
    }
    return null
  }
}

// Helper: Resolve organization_id from location_id (FAST - database first, Square API fallback)
// ============================================================================
async function resolveOrganizationIdFromLocationId(squareLocationId) {
  if (!squareLocationId) {
    return null
  }
  
  try {
    // STEP 1: Fast database lookup (most common case)
    const location = await prisma.$queryRaw`
      SELECT organization_id, square_merchant_id
      FROM locations
      WHERE square_location_id = ${squareLocationId}
      LIMIT 1
    `
    
    if (location && location.length > 0) {
      const loc = location[0]
      
      // If we have organization_id, return it immediately (fastest path)
      if (loc.organization_id) {
        return loc.organization_id
      }
      
      // If we have merchant_id but no organization_id, resolve it
      if (loc.square_merchant_id) {
        const orgId = await resolveOrganizationId(loc.square_merchant_id)
        if (orgId) {
          // Update location with organization_id for future use
          await prisma.$executeRaw`
            UPDATE locations
            SET organization_id = ${orgId}::uuid,
                updated_at = NOW()
            WHERE square_location_id = ${squareLocationId}
          `
          return orgId
        }
      }
    }
    
    // STEP 2: Location not in DB or missing merchant_id - fetch from Square API
    console.log(`📍 Location ${squareLocationId} not in database or missing merchant_id, fetching from Square API...`)
    const locationData = await fetchAndUpdateLocationFromSquare(squareLocationId)
    
    if (locationData && locationData.merchantId) {
      // Resolve organization_id from merchant_id
      const orgId = await resolveOrganizationId(locationData.merchantId)
      
      if (orgId && locationData.locationId) {
        // Update location with organization_id
        await prisma.$executeRaw`
          UPDATE locations
          SET organization_id = ${orgId}::uuid,
              updated_at = NOW()
          WHERE id = ${locationData.locationId}::uuid
        `
      }
      
      return orgId
    }
    
    return null
  } catch (error) {
    console.error(`❌ Error resolving organization_id from location_id: ${error.message}`)
    return null
  }
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
async function generateGiftCardQrDataUri(giftCardGan, maxRetries = 3, options = {}) {
  if (!giftCardGan) {
    console.warn('⚠️ Cannot generate QR code - gift card GAN is missing')
    return null
  }

  // Ensure GAN is clean (only digits, no spaces or special chars)
  let cleanGan = giftCardGan.toString().trim().replace(/\D/g, '')
  
  // Square gift card GANs are typically 16 digits
  // But can be 10-16 digits depending on the card type
  if (!cleanGan || cleanGan.length < 10 || cleanGan.length > 16) {
    console.warn(`⚠️ Invalid GAN format for QR code: ${giftCardGan} (cleaned: ${cleanGan}, length: ${cleanGan?.length || 0})`)
    console.warn(`   Square GANs should be 10-16 digits. Current GAN may be invalid.`)
    
    // Try to verify with Square API if giftCardId is available
    if (options.giftCardsApi && options.giftCardId) {
      try {
        console.log(`   🔍 Attempting to verify GAN with Square API using giftCardId: ${options.giftCardId}`)
        const verifyResponse = await options.giftCardsApi.retrieveGiftCard(options.giftCardId)
        const verifiedGan = verifyResponse.result?.giftCard?.gan
        if (verifiedGan) {
          const verifiedCleanGan = verifiedGan.toString().trim().replace(/\D/g, '')
          if (verifiedCleanGan && verifiedCleanGan.length >= 10 && verifiedCleanGan.length <= 16) {
            console.log(`   ✅ Found valid GAN from Square: ${verifiedCleanGan}`)
            cleanGan = verifiedCleanGan
          } else {
            console.error(`   ❌ Square returned invalid GAN format: ${verifiedGan}`)
            return null
          }
        } else {
          console.error(`   ❌ Square API did not return GAN for gift card ${options.giftCardId}`)
          return null
        }
      } catch (verifyError) {
        console.error(`   ❌ Could not verify GAN with Square: ${verifyError.message}`)
        return null
      }
    } else {
      return null
    }
  }

  // Verify GAN exists in Square if giftCardsApi is provided (optional verification)
  if (options.giftCardsApi && options.giftCardId) {
    try {
      const verifyResponse = await options.giftCardsApi.retrieveGiftCard(options.giftCardId)
      const verifiedGan = verifyResponse.result?.giftCard?.gan
      const verifiedState = verifyResponse.result?.giftCard?.state
      
      if (verifiedGan) {
        const verifiedCleanGan = verifiedGan.toString().trim().replace(/\D/g, '')
        if (verifiedCleanGan !== cleanGan) {
          console.warn(`⚠️ GAN mismatch! Using: ${cleanGan}, Square has: ${verifiedCleanGan}`)
          console.warn(`   Updating to use Square's verified GAN: ${verifiedCleanGan}`)
          cleanGan = verifiedCleanGan
        }
        
        // Check if gift card is activated
        if (verifiedState !== 'ACTIVE' && verifiedState !== 'PENDING') {
          console.warn(`⚠️ Gift card state is ${verifiedState}, QR code may not work until card is ACTIVE`)
        } else {
          console.log(`✅ Gift card verified: GAN=${cleanGan}, State=${verifiedState}, Length=${cleanGan.length} digits`)
        }
      }
    } catch (verifyError) {
      console.warn(`⚠️ Could not verify GAN with Square (non-critical): ${verifyError.message}`)
      // Continue anyway - maybe gift card doesn't exist yet or API error
    }
  }

  const qrData = `sqgc://${cleanGan}`
  console.log(`📱 Generating QR code for GAN: ${cleanGan} (format: ${qrData})`)
  const configs = [
    // Optimal settings for Square scanner compatibility
    { margin: 4, scale: 8, errorCorrectionLevel: 'H', width: 400 },
    // High quality fallback
    { margin: 3, scale: 6, errorCorrectionLevel: 'M', width: 300 },
    // Standard quality fallback
    { margin: 2, scale: 5, errorCorrectionLevel: 'M', width: 250 },
    // Minimum acceptable quality
    { margin: 1, scale: 4, errorCorrectionLevel: 'M', width: 200 }
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
            margin: 2,
            scale: 4,
            errorCorrectionLevel: 'M',
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

  // Convert to number if BigInt, handle undefined/null, and use balanceCents as fallback
  let meaningfulAmount = 0
  if (Number.isFinite(amountCents)) {
    meaningfulAmount = typeof amountCents === 'bigint' ? Number(amountCents) : Number(amountCents)
  } else if (Number.isFinite(balanceCents) && balanceCents > 0) {
    // Fallback to balanceCents if amountCents is invalid but balance exists
    meaningfulAmount = typeof balanceCents === 'bigint' ? Number(balanceCents) : Number(balanceCents)
    console.log(`⚠️ amountCents was invalid (${amountCents}), using balanceCents (${meaningfulAmount}) instead`)
  }
  
  if (!isReminder && meaningfulAmount <= 0) {
    console.log('ℹ️ Gift card amount is zero, skipping issuance email')
    console.log(`   Debug: amountCents=${amountCents} (type: ${typeof amountCents}), balanceCents=${balanceCents} (type: ${typeof balanceCents}), meaningfulAmount=${meaningfulAmount}`)
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

  // Validate GAN format before generating QR code
  const cleanGanForValidation = ganForEmail.toString().trim().replace(/\D/g, '')
  if (!cleanGanForValidation || cleanGanForValidation.length < 10 || cleanGanForValidation.length > 16) {
    console.error(`❌ Invalid GAN format for QR code generation: ${ganForEmail}`)
    console.error(`   Cleaned GAN: ${cleanGanForValidation}, length: ${cleanGanForValidation?.length || 0}`)
    console.error(`   Square GANs must be 10-16 digits. QR code will not be generated.`)
  }

  // Generate QR code (always included - most important)
  // Pass giftCardsApi and giftCardId for verification
  const qrDataUri = await generateGiftCardQrDataUri(ganForEmail, 3, {
    giftCardsApi,
    giftCardId
  })
  
  if (!qrDataUri) {
    console.error(`❌ CRITICAL: Failed to generate QR code for gift card ${ganForEmail}`)
    console.error(`   Customer will receive email without QR code - they can still use GAN manually`)
  } else {
    console.log(`✅ QR code generated successfully for GAN: ${cleanGanForValidation}`)
  }

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
      
      // Check if this code exists in referral_profiles OR square_existing_clients (backward compatibility)
      const existingInProfiles = await prisma.referralProfile.findUnique({
        where: { personal_code: uniqueCode },
        select: { square_customer_id: true }
      })
      
      const existingInClients = await prisma.$queryRaw`
        SELECT square_customer_id FROM square_existing_clients 
        WHERE personal_code = ${uniqueCode}
        LIMIT 1
      `
      
      if (!existingInProfiles && (!existingInClients || existingInClients.length === 0)) {
        return uniqueCode
      }
    } else {
      // First attempt - check if base code exists
      const existingInProfiles = await prisma.referralProfile.findUnique({
        where: { personal_code: code },
        select: { square_customer_id: true }
      })
      
      const existingInClients = await prisma.$queryRaw`
        SELECT square_customer_id FROM square_existing_clients 
        WHERE personal_code = ${code}
        LIMIT 1
      `
      
      if (!existingInProfiles && (!existingInClients || existingInClients.length === 0)) {
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
    
    // Try exact match first in referral_profiles (case-insensitive)
    let referralProfile = await prisma.referralProfile.findFirst({
      where: {
        OR: [
          { personal_code: { equals: normalizedCode, mode: 'insensitive' } },
          { referral_code: { equals: normalizedCode, mode: 'insensitive' } }
        ]
      },
      include: {
        customer: {
          select: {
            square_customer_id: true,
            given_name: true,
            family_name: true,
            email_address: true,
            gift_card_id: true
          }
        }
      }
    })
    
    if (referralProfile) {
      return {
        square_customer_id: referralProfile.customer.square_customer_id,
        given_name: referralProfile.customer.given_name,
        family_name: referralProfile.customer.family_name,
        email_address: referralProfile.customer.email_address,
        personal_code: referralProfile.personal_code,
        gift_card_id: referralProfile.customer.gift_card_id
      }
    }
    
    // Fallback to square_existing_clients for backward compatibility
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

    if (existingNote && existingNote.includes(giftCardGan)) {
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

    if (existingNote && (existingNote.includes(referralCode) || existingNote.includes(referralUrl))) {
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

// Helper function to save gift card to database
async function saveGiftCardToDatabase(giftCardData) {
  try {
    const {
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

    // Upsert gift card record
    const giftCard = await prisma.giftCard.upsert({
      where: { square_gift_card_id },
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

    // Check if transaction already exists (idempotency)
    if (square_activity_id) {
      const existing = await prisma.giftCardTransaction.findFirst({
        where: { square_activity_id }
      })
      if (existing) {
        console.log(`ℹ️ Transaction already exists for activity ${square_activity_id}, skipping`)
        return existing
      }
    }

    const transaction = await prisma.giftCardTransaction.create({
      data: {
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
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null
      }
    })

    return transaction
  } catch (error) {
    console.error('Error saving gift card transaction to database:', error.message)
    // Don't throw - this is a non-critical operation
    return null
  }
}

// Process and save REDEEM transactions when gift cards are used in payments
async function processGiftCardRedemptions(paymentData) {
  try {
    const paymentId = paymentData.id || paymentData.paymentId
    if (!paymentId) {
      return
    }

    console.log(`🔍 Checking for gift card redemptions in payment ${paymentId}`)

    // Extract gift card IDs/GANs from payment tenders
    const giftCardGans = await extractGiftCardGansFromPayment(paymentData)
    
    if (giftCardGans.length === 0) {
      console.log(`   No gift cards used in this payment`)
      return
    }

    console.log(`   Found ${giftCardGans.length} gift card(s) used: ${giftCardGans.join(', ')}`)

    const giftCardsApi = getGiftCardsApi()
    const giftCardActivitiesApi = getGiftCardActivitiesApi()

    // Process each gift card
    for (const gan of giftCardGans) {
      try {
        // Find gift card in database by GAN
        const giftCard = await prisma.giftCard.findFirst({
          where: { gift_card_gan: gan },
          include: {
            transactions: {
              where: {
                transaction_type: 'REDEEM',
                square_payment_id: paymentId
              }
            }
          }
        })

        if (!giftCard) {
          console.log(`   ⚠️ Gift card with GAN ${gan} not found in database, skipping`)
          continue
        }

        // Check if REDEEM transaction already exists for this payment
        if (giftCard.transactions && giftCard.transactions.length > 0) {
          console.log(`   ℹ️ REDEEM transaction already exists for gift card ${giftCard.square_gift_card_id} and payment ${paymentId}`)
          continue
        }

        // Query Square for recent REDEEM activities for this gift card
        // Look for activities in the last 5 minutes (to catch the current payment)
        const activitiesResponse = await giftCardActivitiesApi.listGiftCardActivities(giftCard.square_gift_card_id)
        const activities = activitiesResponse.result?.giftCardActivities || []

        // Find REDEEM activities that match this payment
        const redeemActivities = activities.filter(activity => {
          if (activity.type !== 'REDEEM') return false
          
          // Check if activity matches this payment
          const activityPaymentId = activity.redeemActivityDetails?.paymentId
          if (activityPaymentId === paymentId) {
            return true
          }

          // Also check by order ID if payment has an order
          const orderId = paymentData.order_id || paymentData.orderId
          if (orderId && activity.redeemActivityDetails?.orderId === orderId) {
            return true
          }

          // Check by timestamp (within last 5 minutes)
          const activityTime = new Date(activity.createdAt)
          const paymentTime = new Date(paymentData.created_at || paymentData.createdAt || Date.now())
          const timeDiff = Math.abs(paymentTime - activityTime)
          if (timeDiff < 5 * 60 * 1000) { // 5 minutes
            return true
          }

          return false
        })

        if (redeemActivities.length === 0) {
          console.log(`   ⚠️ No REDEEM activity found in Square for gift card ${giftCard.square_gift_card_id} matching payment ${paymentId}`)
          continue
        }

        // Process each REDEEM activity
        for (const redeemActivity of redeemActivities) {
          // Check if we already saved this activity
          const existing = await prisma.giftCardTransaction.findFirst({
            where: { square_activity_id: redeemActivity.id }
          })

          if (existing) {
            console.log(`   ℹ️ REDEEM transaction already exists for activity ${redeemActivity.id}`)
            continue
          }

          // Get amount and balance from activity
          const redeemDetails = redeemActivity.redeemActivityDetails
          const amountMoney = redeemDetails?.amountMoney
          const amountCents = amountMoney 
            ? (typeof amountMoney.amount === 'bigint' ? Number(amountMoney.amount) : (amountMoney.amount || 0))
            : 0

          const balanceAfter = redeemActivity.giftCardBalanceMoney
          const balanceAfterCents = balanceAfter
            ? (typeof balanceAfter.amount === 'bigint' ? Number(balanceAfter.amount) : (balanceAfter.amount || 0))
            : 0

          // Calculate balance before (balance after + amount redeemed)
          const balanceBeforeCents = balanceAfterCents + amountCents

          // Save REDEEM transaction
          await saveGiftCardTransaction({
            gift_card_id: giftCard.id,
            transaction_type: 'REDEEM',
            amount_cents: -Math.abs(amountCents), // Negative for redemption
            balance_before_cents: balanceBeforeCents,
            balance_after_cents: balanceAfterCents,
            square_activity_id: redeemActivity.id,
            square_order_id: redeemDetails?.orderId || null,
            square_payment_id: redeemDetails?.paymentId || paymentId,
            context_label: 'Gift card used for payment',
            metadata: {
              square_activity: redeemActivity,
              payment_id: paymentId,
              payment_data: {
                id: paymentId,
                order_id: paymentData.order_id || paymentData.orderId,
                created_at: paymentData.created_at || paymentData.createdAt
              }
            }
          })

          // Update gift card balance
          await prisma.giftCard.update({
            where: { id: giftCard.id },
            data: {
              current_balance_cents: balanceAfterCents,
              last_balance_check_at: new Date(),
              updated_at: new Date()
            }
          })

          console.log(`   ✅ Saved REDEEM transaction for gift card ${giftCard.square_gift_card_id}`)
          console.log(`      Amount: $${(Math.abs(amountCents) / 100).toFixed(2)}`)
          console.log(`      Balance: $${(balanceBeforeCents / 100).toFixed(2)} → $${(balanceAfterCents / 100).toFixed(2)}`)
        }
      } catch (error) {
        console.error(`   ❌ Error processing gift card ${gan}:`, error.message)
        // Continue with other gift cards
      }
    }
  } catch (error) {
    console.error('Error processing gift card redemptions:', error.message)
    // Don't throw - this is a non-critical operation
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
    let giftCardGan = giftCard.gan || null // Ensure it's never undefined
    const giftCardState = giftCard.state || 'PENDING'
    console.log(`✅ Created gift card for ${customerName}: ${giftCardId}`)
    if (!giftCardGan) {
      console.log(`   ⚠️ GAN not yet assigned (card is ${giftCardState}), will be updated after activation`)
    }
    
    // Save CREATE transaction to database
    try {
      const createGiftCardRecord = await saveGiftCardToDatabase({
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
            const giftCardRecord = await prisma.giftCard.findUnique({
              where: { square_gift_card_id: giftCardId }
            })

            if (giftCardRecord) {
              await saveGiftCardTransaction({
                gift_card_id: giftCardRecord.id,
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

    // Ensure amountCents and balanceCents are always numbers (handle BigInt conversion)
    const finalAmountCents = typeof amountMoney.amount === 'bigint' 
      ? Number(amountMoney.amount) 
      : (Number.isFinite(amountMoney.amount) ? Number(amountMoney.amount) : 0)
    const finalBalanceCents = typeof activityBalanceNumber === 'bigint'
      ? Number(activityBalanceNumber)
      : (Number.isFinite(activityBalanceNumber) ? Number(activityBalanceNumber) : 0)
    
    return {
      giftCardId,
      giftCardGan,
      activationChannel,
      orderId: successfulOrderInfo?.orderId || null,
      lineItemUid: successfulOrderInfo?.lineItemUid || null,
      activationUrl,
      passKitUrl,
      digitalEmail,
      balanceCents: finalBalanceCents,
      amountCents: finalAmountCents
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
        // Find the gift card record in our database
        const giftCardRecord = await prisma.giftCard.findUnique({
          where: { square_gift_card_id: giftCardId }
        })

        if (giftCardRecord) {
          // Save the transaction
          await saveGiftCardTransaction({
            gift_card_id: giftCardRecord.id,
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
      // Generate new unique code in name+ID format (checking for duplicates)
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
    // Create/update ReferralProfile (new normalized table)
    try {
      await prisma.referralProfile.upsert({
        where: { square_customer_id: customerId },
        update: {
          personal_code: referralCode,
          referral_code: referralCode, // Same as personal_code for now
          referral_url: referralUrl,
          activated_as_referrer: true,
          referral_email_sent: true,
          activated_at: new Date(),
          updated_at: new Date()
        },
        create: {
          square_customer_id: customerId,
          personal_code: referralCode,
          referral_code: referralCode,
          referral_url: referralUrl,
          activated_as_referrer: true,
          referral_email_sent: true,
          activated_at: new Date()
        }
      })
      console.log(`✅ Created/updated ReferralProfile for customer ${customerId}`)
    } catch (profileError) {
      // Handle duplicate key error (race condition)
      if (profileError.code === 'P2002' || (profileError.code === '23505' && profileError.message?.includes('personal_code'))) {
        console.warn(`⚠️ Personal code ${referralCode} was taken, generating new one...`)
        
        // Retry with new code
        let retrySuccess = false
        for (let retryAttempt = 0; retryAttempt < 3; retryAttempt++) {
          try {
            referralCode = await generateUniquePersonalCode(customerName, customerId)
            referralUrl = generateReferralUrl(referralCode)
            
            await upsertCustomerCustomAttribute(customerId, REFERRAL_CODE_ATTRIBUTE_KEY, referralCode)
            await appendReferralNote(customerId, referralCode, referralUrl)
            
            await prisma.referralProfile.upsert({
              where: { square_customer_id: customerId },
              update: {
                personal_code: referralCode,
                referral_code: referralCode,
                referral_url: referralUrl,
                activated_as_referrer: true,
                referral_email_sent: true,
                activated_at: new Date(),
                updated_at: new Date()
              },
              create: {
                square_customer_id: customerId,
                personal_code: referralCode,
                referral_code: referralCode,
                referral_url: referralUrl,
                activated_as_referrer: true,
                referral_email_sent: true,
                activated_at: new Date()
              }
            })
            console.log(`✅ Retried with new unique code: ${referralCode}`)
            retrySuccess = true
            break
          } catch (retryError) {
            if ((retryError.code === 'P2002' || retryError.code === '23505') && retryError.message?.includes('personal_code')) {
              console.warn(`⚠️ Retry attempt ${retryAttempt + 1} also failed with duplicate code, trying again...`)
              continue
            } else {
              throw retryError
            }
          }
        }
        
        if (!retrySuccess) {
          console.error(`❌ Failed to save personal_code to ReferralProfile after 3 retry attempts`)
        }
      } else {
        console.error(`❌ Error creating/updating ReferralProfile: ${profileError.message}`)
        // Continue - non-critical error
      }
    }
    
    // Also update square_existing_clients for backward compatibility
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
    
    // Check if SMS sending is disabled
    const smsDisabled = process.env.DISABLE_SMS_SENDING === 'true' || process.env.SMS_ENABLED === 'false'
    
    if (smsDisabled) {
      console.log('ℹ️ Referral SMS sending is disabled (DISABLE_SMS_SENDING or SMS_ENABLED=false)')
      smsAnalytics.skipped = true
      smsAnalytics.reason = 'sms-disabled'
    } else if (!smsDestination) {
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
          // Update ReferralProfile with SMS info
          try {
            await prisma.referralProfile.update({
              where: { square_customer_id: customerId },
              data: {
                referral_sms_sent: true,
                referral_sms_sent_at: new Date(),
                referral_sms_sid: smsResult.sid ?? null,
                updated_at: new Date()
              }
            })
          } catch (profileError) {
            console.warn(`⚠️ Failed to update ReferralProfile SMS info: ${profileError.message}`)
          }
          
          // Also update square_existing_clients for backward compatibility
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

    // 1. Check if customer is new
    const isNew = await isNewCustomer(customerId)
    if (!isNew) {
      console.log(`ℹ️ Customer ${customerId} is not new, skipping...`)
      return
    }

    console.log(`🎉 New customer detected: ${customerId}`)

    // 2. Generate referral code immediately when customer creates profile
    // This allows customer to start sharing their referral code right away
    const customerName = `${givenName || ''} ${familyName || ''}`.trim() || 'Customer'
    const referralCode = await generateUniquePersonalCode(customerName, customerId)
    const referralUrl = generateReferralUrl(referralCode)
    
    console.log(`✅ Generated referral code: ${referralCode}`)
    console.log(`   - Referral URL: ${referralUrl}`)

    // 3. Add customer to database with referral code (but no gift card yet)
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
        referral_url,
        gift_card_id,
        used_referral_code,
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
        TRUE, -- Marked as referrer immediately (can share code right away)
        ${referralCode}, -- Referral code created immediately
        ${referralUrl}, -- Referral URL created immediately
        NULL, -- No gift card yet (will create on booking or after first payment)
        NULL, -- No referral code stored yet (will check on booking)
        FALSE, -- No email sent yet (will send immediately if email exists)
        NOW(),
        NOW()
      )
      ON CONFLICT (square_customer_id) DO UPDATE SET
        given_name = COALESCE(square_existing_clients.given_name, EXCLUDED.given_name),
        family_name = COALESCE(square_existing_clients.family_name, EXCLUDED.family_name),
        email_address = COALESCE(square_existing_clients.email_address, EXCLUDED.email_address),
        phone_number = COALESCE(square_existing_clients.phone_number, EXCLUDED.phone_number),
        personal_code = COALESCE(square_existing_clients.personal_code, EXCLUDED.personal_code),
        referral_url = COALESCE(square_existing_clients.referral_url, EXCLUDED.referral_url),
        activated_as_referrer = COALESCE(square_existing_clients.activated_as_referrer, TRUE),
        updated_at = NOW()
    `

    // 4. Update Square customer with referral code attribute
    try {
      await upsertCustomerCustomAttribute(customerId, REFERRAL_CODE_ATTRIBUTE_KEY, referralCode)
      await appendReferralNote(customerId, referralCode, referralUrl)
      console.log(`✅ Updated Square customer with referral code`)
    } catch (attrError) {
      console.warn(`⚠️ Failed to update Square customer attributes: ${attrError.message}`)
      // Don't fail the whole process if attribute update fails
    }

    console.log(`✅ Customer added to database with referral code`)
    console.log(`   - Referral Code: ${referralCode}`)
    console.log(`   - Customer can start sharing code immediately`)
    console.log(`   - Gift card will be created after first payment (or on booking if uses referral code)`)

    // 5. Send referral code email immediately (if email exists)
    // Note: We send email directly here (not via sendReferralCodeToNewClient) because:
    // - We don't want to create gift card yet (will be created after first payment)
    // - We don't want to set got_signup_bonus = TRUE (only for friends who used referral code)
    // - We just want to send the referral code email and mark referral_email_sent = TRUE
    if (emailAddress) {
      try {
        console.log(`📧 Sending referral code email immediately to ${emailAddress}...`)
        
        const emailResult = await sendReferralCodeEmail(
          customerName,
          emailAddress,
          referralCode,
          referralUrl,
          {
            customerId,
            metadata: {}
          }
        )
        
        if (emailResult.success && !emailResult.skipped) {
          // Mark email as sent in database
          await prisma.$executeRaw`
            UPDATE square_existing_clients 
            SET referral_email_sent = TRUE,
                updated_at = NOW()
            WHERE square_customer_id = ${customerId}
          `
          
          console.log(`✅ Referral code email sent successfully`)
          console.log(`   - Email: ${emailAddress}`)
          console.log(`   - Referral Code: ${referralCode}`)
          console.log(`   - Referral URL: ${referralUrl}`)
          console.log(`   - Customer can now share their code with friends immediately!`)
        } else if (emailResult.skipped) {
          console.log(`⏸️ Email sending is disabled or skipped (skipped sending to ${emailAddress})`)
        } else {
          console.log(`⚠️ Failed to send referral code email: ${emailResult.error || 'Unknown error'}`)
          console.log(`   - Email will be sent after first payment as fallback`)
        }
      } catch (emailError) {
        console.warn(`⚠️ Error sending referral code email: ${emailError.message}`)
        console.warn(`   - Email will be sent after first payment as fallback`)
        // Don't fail the whole process if email fails
      }
    } else {
      console.log(`ℹ️ No email address provided, referral code email will be sent after first payment`)
    }
    
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
  try {
    // Fix 1: Check if payment was already processed (idempotency)
    const paymentId = paymentData.id || paymentData.paymentId
    // Idempotency is handled by giftcard_runs table via correlationId

    // Get customer ID from payment data (could be snake_case or camelCase)
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
    
    // Log payment details including tender type for debugging
    console.log(`   Payment source_type: ${paymentData.source_type || 'unknown'}`)
    console.log(`   Payment tender_types: ${safeStringify(paymentData.tender || [])}`)
    const paymentLocationId = getFriendlyLocationIdFromPayment(paymentData)
    if (paymentLocationId) {
      console.log(`📍 Payment attributed to location: ${paymentLocationId}`)
    }

    // Process gift card redemptions (for ALL payments, not just first payment)
    await processGiftCardRedemptions(paymentData)

    // 1. Check if this is a new customer's first payment
    const customerData = await prisma.$queryRaw`
      SELECT square_customer_id, used_referral_code, got_signup_bonus, gift_card_id, 
             given_name, family_name, email_address, first_payment_completed, activated_as_referrer
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

        // Guard: block referrer reward if customer used their own code
        const isSelfReferral = referrer.square_customer_id === customerId
        if (isSelfReferral) {
          console.log(`⚠️ Skipping referrer reward because this looks like self-referral (customerId=${customerId})`)
          referrerCustomerId = null
        }

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

              // Create ReferralReward record for tracking
              try {
                // Find the gift card ID from the new gift_cards table
                const giftCardRecord = await prisma.giftCard.findUnique({
                  where: { square_gift_card_id: referrerGiftCard.giftCardId }
                })
                
                await prisma.referralReward.create({
                  data: {
                    referrer_customer_id: referrer.square_customer_id,
                    referred_customer_id: customerId,
                    reward_amount_cents: rewardAmountCents, // 1000 cents = $10
                    status: 'PAID',
                    gift_card_id: giftCardRecord?.id || null,
                    payment_id: paymentId || null,
                    booking_id: null,
                    reward_type: 'referrer_reward',
                    paid_at: new Date(),
                    metadata: {
                      referral_code: customer.used_referral_code,
                      source: 'payment.completed',
                      gift_card_square_id: referrerGiftCard.giftCardId
                    }
                  }
                })
                console.log(`✅ Created ReferralReward record for referrer ${referrer.square_customer_id}`)
              } catch (rewardError) {
                console.warn(`⚠️ Failed to create ReferralReward record: ${rewardError.message}`)
                // Continue - non-critical error
              }

              // Send notification to admin about referral code usage (referrer reward)
              try {
                await sendReferralCodeUsageNotification({
                  referralCode: customer.used_referral_code,
                  customer: {
                    square_customer_id: customerId,
                    given_name: customer.given_name,
                    family_name: customer.family_name,
                    email_address: customer.email_address,
                    phone_number: customer.phone_number
                  },
                  referrer: {
                    square_customer_id: referrer.square_customer_id,
                    given_name: referrer.given_name,
                    family_name: referrer.family_name,
                    email_address: referrer.email_address,
                    personal_code: referrer.personal_code
                  },
                  giftCard: {
                    giftCardId: referrerGiftCard.giftCardId,
                    giftCardGan: referrerGiftCard.giftCardGan,
                    amountCents: referrerGiftCard.amountCents
                  },
                  source: 'payment.completed (referrer_reward)'
                })
              } catch (notificationError) {
                // Don't fail the whole process if notification fails
                console.error('⚠️ Failed to send referral code usage notification:', notificationError.message)
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

              // Create ReferralReward record for tracking
              try {
                const giftCardRecord = await prisma.giftCard.findUnique({
                  where: { square_gift_card_id: referrerInfo.gift_card_id }
                })
                
                await prisma.referralReward.create({
                  data: {
                    referrer_customer_id: referrer.square_customer_id,
                    referred_customer_id: customerId,
                    reward_amount_cents: rewardAmountCents,
                    status: 'PAID',
                    gift_card_id: giftCardRecord?.id || null,
                    payment_id: paymentId || null,
                    booking_id: null,
                    reward_type: 'referrer_reward',
                    paid_at: new Date(),
                    metadata: {
                      referral_code: customer.used_referral_code,
                      source: 'payment.completed (load)',
                      gift_card_square_id: referrerInfo.gift_card_id
                    }
                  }
                })
                console.log(`✅ Created ReferralReward record for referrer ${referrer.square_customer_id}`)
              } catch (rewardError) {
                console.warn(`⚠️ Failed to create ReferralReward record: ${rewardError.message}`)
                // Continue - non-critical error
              }

              // Send notification to admin about referral code usage (referrer reward - loaded)
              try {
                await sendReferralCodeUsageNotification({
                  referralCode: customer.used_referral_code,
                  customer: {
                    square_customer_id: customerId,
                    given_name: customer.given_name,
                    family_name: customer.family_name,
                    email_address: customer.email_address,
                    phone_number: customer.phone_number
                  },
                  referrer: {
                    square_customer_id: referrer.square_customer_id,
                    given_name: referrer.given_name,
                    family_name: referrer.family_name,
                    email_address: referrer.email_address,
                    personal_code: referrer.personal_code
                  },
                  giftCard: {
                    giftCardId: referrerInfo.gift_card_id,
                    giftCardGan: loadResult.giftCardGan,
                    amountCents: rewardAmountCents
                  },
                  source: 'payment.completed (referrer_reward_loaded)'
                })
              } catch (notificationError) {
                // Don't fail the whole process if notification fails
                console.error('⚠️ Failed to send referral code usage notification:', notificationError.message)
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

    // 4. Mark first payment as completed ONLY if there were no errors
    // This allows the client to retry processing if something failed
    if (!paymentHadError) {
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET first_payment_completed = TRUE
        WHERE square_customer_id = ${customerId}
      `
    }

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

    // Idempotency is handled by giftcard_runs table via correlationId

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

// Process booking creation (when customer actually books)
/**
 * Save booking to database
 * If segment is provided, creates a booking record for that specific service
 * For multi-service bookings, creates multiple records with unique IDs
 */
async function saveBookingToDatabase(bookingData, segment, customerId, merchantId = null, organizationId = null) {
  try {
    const baseBookingId = bookingData.id || bookingData.bookingId
    const bookingId = segment 
      ? `${baseBookingId}-${segment.service_variation_id || segment.serviceVariationId || 'unknown'}` // Unique ID per service
      : baseBookingId
    
    const creatorDetails = bookingData.creator_details || bookingData.creatorDetails || {}
    const address = bookingData.address || {}
    
    // Extract merchant_id from bookingData if not provided
    const finalMerchantId = merchantId || bookingData.merchantId || bookingData.merchant_id || null
    
    // Resolve organization_id - PRIORITIZE location_id (always available, fast database lookup)
    let finalOrganizationId = organizationId
    
    // STEP 1: Try location_id FIRST (always available in webhooks, fast DB lookup)
    if (!finalOrganizationId) {
      const squareLocationId = 
        bookingData.location_id || 
        bookingData.locationId || 
        bookingData.location?.id ||
        bookingData.extendedProperties?.locationId ||
        (bookingData.raw_json && (bookingData.raw_json.location_id || bookingData.raw_json.locationId))
      
      if (squareLocationId) {
        console.log(`📍 Resolving organization_id from location_id: ${squareLocationId}`)
        finalOrganizationId = await resolveOrganizationIdFromLocationId(squareLocationId)
        if (finalOrganizationId) {
          console.log(`✅ Resolved organization_id from location: ${finalOrganizationId}`)
        }
      }
    }
    
    // STEP 2: Fallback to merchant_id (if location lookup failed)
    if (!finalOrganizationId && finalMerchantId) {
      finalOrganizationId = await resolveOrganizationId(finalMerchantId)
      if (finalOrganizationId) {
        console.log(`✅ Resolved organization_id from merchant_id: ${finalOrganizationId}`)
      }
    }
    
    // STEP 3: Fallback to customer (if both location and merchant failed)
    if (!finalOrganizationId && customerId) {
      try {
        const customerOrg = await prisma.$queryRaw`
          SELECT organization_id FROM square_existing_clients 
          WHERE square_customer_id = ${customerId}
          LIMIT 1
        `
        if (customerOrg && customerOrg.length > 0) {
          finalOrganizationId = customerOrg[0].organization_id
          console.log(`✅ Resolved organization_id from customer: ${finalOrganizationId}`)
        }
      } catch (error) {
        console.warn(`⚠️ Could not resolve organization_id from customer: ${error.message}`)
      }
    }
    
    if (!finalOrganizationId) {
      console.error(`❌ Cannot save booking: organization_id is required but could not be resolved`)
      console.error(`   Booking ID: ${bookingId}`)
      console.error(`   Customer ID: ${customerId || 'missing'}`)
      console.error(`   Merchant ID: ${finalMerchantId || 'missing'}`)
      console.error(`   Location ID: ${bookingData.location_id || bookingData.locationId || 'missing'}`)
      console.error(`   Attempted: merchant_id lookup, customer lookup, location_id lookup (with Square API)`)
      return
    }
    
    // Resolve location_id from Square location ID to UUID
    // Check multiple possible fields where locationId might be stored
    const squareLocationId = 
      bookingData.location_id || 
      bookingData.locationId || 
      bookingData.location?.id ||
      bookingData.extendedProperties?.locationId ||
      (bookingData.raw_json && (bookingData.raw_json.location_id || bookingData.raw_json.locationId))
    
    if (!squareLocationId) {
      console.warn(`⚠️ Booking ${bookingId} missing location_id in all checked fields`)
      console.warn(`   Checked fields: location_id, locationId, location.id, extendedProperties.locationId, raw_json`)
    } else {
      console.log(`📍 Found booking locationId: ${squareLocationId}`)
    }
    
    let locationUuid = null
    
    if (squareLocationId) {
      try {
        // Fetch location from Square API to get merchant_id and other details
        const locationData = await fetchAndUpdateLocationFromSquare(squareLocationId)
        const locationMerchantId = locationData?.merchantId || null
        const locationName = locationData?.name || `Location ${squareLocationId.substring(0, 8)}...`
        const locationAddress = locationData?.address || null
        
        // Ensure location exists first (with merchant_id if available)
        await prisma.$executeRaw`
          INSERT INTO locations (
            id,
            organization_id,
            square_location_id,
            square_merchant_id,
            name,
            address_line_1,
            locality,
            administrative_district_level_1,
            postal_code,
            created_at,
            updated_at
          ) VALUES (
            gen_random_uuid(),
            ${finalOrganizationId}::uuid,
            ${squareLocationId},
            ${locationMerchantId},
            ${locationName},
            ${locationAddress?.address_line_1 || locationAddress?.addressLine1 || null},
            ${locationAddress?.locality || null},
            ${locationAddress?.administrative_district_level_1 || locationAddress?.administrativeDistrictLevel1 || null},
            ${locationAddress?.postal_code || locationAddress?.postalCode || null},
            NOW(),
            NOW()
          )
          ON CONFLICT (organization_id, square_location_id) DO UPDATE SET
            square_merchant_id = COALESCE(EXCLUDED.square_merchant_id, locations.square_merchant_id),
            name = COALESCE(EXCLUDED.name, locations.name),
            address_line_1 = COALESCE(EXCLUDED.address_line_1, locations.address_line_1),
            locality = COALESCE(EXCLUDED.locality, locations.locality),
            administrative_district_level_1 = COALESCE(EXCLUDED.administrative_district_level_1, locations.administrative_district_level_1),
            postal_code = COALESCE(EXCLUDED.postal_code, locations.postal_code),
            updated_at = NOW()
        `
        
        // Get location UUID
        const locationRecord = await prisma.$queryRaw`
          SELECT id FROM locations 
          WHERE square_location_id = ${squareLocationId}
            AND organization_id = ${finalOrganizationId}::uuid
          LIMIT 1
        `
        locationUuid = locationRecord && locationRecord.length > 0 ? locationRecord[0].id : null
        
        if (!locationUuid) {
          console.error(`❌ Cannot save booking: location UUID not found for square_location_id ${squareLocationId}`)
          return
        }
      } catch (err) {
        console.error(`❌ Error resolving location: ${err.message}`)
        return
      }
    } else {
      console.warn(`⚠️ Booking ${bookingId} missing location_id, cannot save`)
      return
    }
    
    // Resolve service_variation_id from Square ID to internal UUID
    let serviceVariationUuid = null
    const squareServiceVariationId = segment?.service_variation_id || segment?.serviceVariationId
    if (squareServiceVariationId && finalOrganizationId) {
      try {
        const svRecord = await prisma.$queryRaw`
          SELECT uuid::text as id FROM service_variation
          WHERE square_variation_id = ${squareServiceVariationId}
            AND organization_id = ${finalOrganizationId}::uuid
          LIMIT 1
        `
        serviceVariationUuid = svRecord && svRecord.length > 0 ? svRecord[0].id : null
        if (serviceVariationUuid) {
          console.log(`✅ Resolved service variation ${squareServiceVariationId} to UUID ${serviceVariationUuid}`)
        } else {
          console.warn(`⚠️ Service variation ${squareServiceVariationId} not found in database`)
        }
      } catch (error) {
        console.error(`❌ Error resolving service variation: ${error.message}`)
      }
    }
    
    // Resolve technician_id from Square ID to internal UUID
    let technicianUuid = null
    const squareTeamMemberId = segment?.team_member_id || segment?.teamMemberId
    if (squareTeamMemberId && finalOrganizationId) {
      try {
        const tmRecord = await prisma.$queryRaw`
          SELECT id::text as id FROM team_members
          WHERE square_team_member_id = ${squareTeamMemberId}
            AND organization_id = ${finalOrganizationId}::uuid
          LIMIT 1
        `
        technicianUuid = tmRecord && tmRecord.length > 0 ? tmRecord[0].id : null
        if (technicianUuid) {
          console.log(`✅ Resolved team member ${squareTeamMemberId} to UUID ${technicianUuid}`)
        }
      } catch (error) {
        console.error(`❌ Error resolving team member: ${error.message}`)
      }
    }
    
    await prisma.$executeRaw`
      INSERT INTO bookings (
        id, organization_id, booking_id, version, customer_id, location_id, location_type, source,
        start_at, status, all_day, transition_time_minutes,
        creator_type, creator_customer_id, administrator_id,
        address_line_1, locality, administrative_district_level_1, postal_code,
        service_variation_id, service_variation_version, duration_minutes,
        intermission_minutes, technician_id, any_team_member,
        customer_note, seller_note,
        merchant_id, created_at, updated_at, raw_json
      ) VALUES (
        gen_random_uuid(),
        ${finalOrganizationId}::uuid,
        ${bookingId},
        ${bookingData.version || 0},
        ${customerId},
        ${locationUuid}::uuid,
        ${bookingData.location_type || bookingData.locationType || null},
        ${bookingData.source || null},
        ${bookingData.start_at || bookingData.startAt ? new Date(bookingData.start_at || bookingData.startAt) : new Date()}::timestamptz,
        ${bookingData.status || 'ACCEPTED'},
        ${bookingData.all_day || bookingData.allDay || false},
        ${bookingData.transition_time_minutes || bookingData.transitionTimeMinutes || 0},
        ${creatorDetails.creator_type || creatorDetails.creatorType || null},
        ${creatorDetails.customer_id || creatorDetails.customerId || null},
        ${creatorDetails.team_member_id || creatorDetails.teamMemberId || null},
        ${address.address_line_1 || address.addressLine1 || null},
        ${address.locality || null},
        ${address.administrative_district_level_1 || address.administrativeDistrictLevel1 || null},
        ${address.postal_code || address.postalCode || null},
        ${serviceVariationUuid || null},
        ${segment?.service_variation_version || segment?.serviceVariationVersion ? BigInt(segment.service_variation_version || segment.serviceVariationVersion) : null},
        ${segment?.duration_minutes || segment?.durationMinutes || null},
        ${segment?.intermission_minutes || segment?.intermissionMinutes || 0},
        ${technicianUuid || null},
        ${segment?.any_team_member ?? segment?.anyTeamMember ?? false},
        ${bookingData.customer_note || bookingData.customerNote || null},
        ${bookingData.seller_note || bookingData.sellerNote || null},
        ${finalMerchantId},
        ${bookingData.created_at || bookingData.createdAt ? new Date(bookingData.created_at || bookingData.createdAt) : new Date()}::timestamptz,
        ${bookingData.updated_at || bookingData.updatedAt ? new Date(bookingData.updatedAt || bookingData.updated_at) : new Date()}::timestamptz,
        ${JSON.stringify(bookingData)}::jsonb
      )
      ON CONFLICT (organization_id, booking_id) DO UPDATE SET
        version = EXCLUDED.version,
        status = EXCLUDED.status,
        merchant_id = COALESCE(EXCLUDED.merchant_id, bookings.merchant_id),
        service_variation_id = EXCLUDED.service_variation_id,
        service_variation_version = EXCLUDED.service_variation_version,
        technician_id = EXCLUDED.technician_id,
        customer_note = COALESCE(EXCLUDED.customer_note, bookings.customer_note),
        seller_note = COALESCE(EXCLUDED.seller_note, bookings.seller_note),
        updated_at = EXCLUDED.updated_at,
        raw_json = EXCLUDED.raw_json
    `
    
    console.log(`✅ Saved booking ${bookingId} with service ${segment?.service_variation_id || segment?.serviceVariationId || 'N/A'}`)
  } catch (error) {
    console.error(`❌ Error saving booking:`, error.message)
    // Don't throw - allow referral processing to continue
  }
}

/**
 * Process booking.updated webhook event
 * Updates existing booking with new data from Square
 */
async function processBookingUpdated(bookingData, eventId = null, eventCreatedAt = null) {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:3418',message:'processBookingUpdated called',data:{hasBookingData:!!bookingData,bookingId:bookingData?.id||bookingData?.bookingId||'missing',eventId:eventId||'missing'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    const baseBookingId = bookingData.id || bookingData.bookingId
    if (!baseBookingId) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:3422',message:'missing booking ID',data:{bookingDataKeys:bookingData?Object.keys(bookingData).join(','):'no-data'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      console.error('❌ booking.updated: Missing booking ID')
      return
    }

    console.log(`📅 Processing booking.updated for booking: ${baseBookingId}`)
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:3426',message:'processing booking updated',data:{baseBookingId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    // Extract data from webhook payload
    const customerId = bookingData.customer_id || bookingData.customerId || null
    const squareLocationId = bookingData.location_id || bookingData.locationId || null
    const status = bookingData.status || null
    const customerNote = bookingData.customer_note || bookingData.customerNote || null
    const sellerNote = bookingData.seller_note || bookingData.sellerNote || null
    const version = bookingData.version || null
    const updatedAt = bookingData.updated_at || bookingData.updatedAt ? new Date(bookingData.updated_at || bookingData.updatedAt) : new Date()
    const appointmentSegments = bookingData.appointment_segments || bookingData.appointmentSegments || []

    // Find existing booking(s) - there may be multiple records for multi-service bookings
    const existingBookings = await prisma.$queryRaw`
      SELECT id, organization_id, booking_id, service_variation_id, technician_id, administrator_id
      FROM bookings
      WHERE booking_id LIKE ${`${baseBookingId}%`}
      ORDER BY created_at ASC
    `

    if (!existingBookings || existingBookings.length === 0) {
      console.warn(`⚠️ booking.updated: Booking ${baseBookingId} not found in database`)
      console.warn(`   This might be a booking that was created before webhook handling was implemented`)
      console.warn(`   OR the booking.created webhook was missed/failed`)
      console.log(`   Creating booking from booking.updated webhook data...`)
      
      // Create booking if it doesn't exist (fallback for missed booking.created webhooks)
      const customerId = bookingData.customer_id || bookingData.customerId || 
                        bookingData.creator_details?.customer_id || 
                        bookingData.creatorDetails?.customerId || null
      
      if (!customerId) {
        console.error(`❌ Cannot create booking: customer_id is missing from booking data`)
        return
      }
      
      // Resolve organization_id - PRIORITIZE location_id (always available, fast database lookup)
      let organizationId = null
      // Extract merchantId from webhook data at this scope so it's available for saveBookingToDatabase
      const merchantId = bookingData.merchant_id || bookingData.merchantId || null
      
      // STEP 1: Try location_id FIRST (always available in webhooks, fast DB lookup)
      const squareLocationId = bookingData.location_id || bookingData.locationId
      if (squareLocationId) {
        console.log(`📍 Resolving organization_id from location_id: ${squareLocationId}`)
        organizationId = await resolveOrganizationIdFromLocationId(squareLocationId)
        if (organizationId) {
          console.log(`✅ Resolved organization_id from location: ${organizationId}`)
        }
      }
      
      // STEP 2: Fallback to merchant_id (if location lookup failed)
      if (!organizationId) {
        if (merchantId) {
          organizationId = await resolveOrganizationId(merchantId)
          if (organizationId) {
            console.log(`✅ Resolved organization_id from merchant_id: ${organizationId}`)
          }
        }
      }
      
      // STEP 3: Fallback to customer (if both location and merchant failed)
      if (!organizationId && customerId) {
        try {
          const customerOrg = await prisma.$queryRaw`
            SELECT organization_id FROM square_existing_clients 
            WHERE square_customer_id = ${customerId}
            LIMIT 1
          `
          if (customerOrg && customerOrg.length > 0) {
            organizationId = customerOrg[0].organization_id
            console.log(`✅ Resolved organization_id from customer: ${organizationId}`)
          }
        } catch (error) {
          console.warn(`⚠️ Could not resolve organization_id from customer: ${error.message}`)
        }
      }
      
      if (!organizationId) {
        console.error(`❌ Cannot create booking: organization_id is required but could not be resolved`)
        console.error(`   Booking ID: ${baseBookingId}`)
        console.error(`   Customer ID: ${customerId || 'missing'}`)
        console.error(`   Merchant ID: ${merchantId || 'missing'}`)
        console.error(`   Location ID: ${bookingData.location_id || bookingData.locationId || 'missing'}`)
        console.error(`   Attempted: customer lookup, merchant_id lookup, location_id lookup (with Square API)`)
        return
      }
      
      // Save booking using the same logic as processBookingCreated
      const segments = bookingData.appointment_segments || bookingData.appointmentSegments || []
      
      if (segments.length === 0) {
        // No services, save booking as-is
        await saveBookingToDatabase(bookingData, null, customerId, merchantId, organizationId)
      } else {
        // Multiple services - create one booking per service
        for (const segment of segments) {
          await saveBookingToDatabase(bookingData, segment, customerId, merchantId, organizationId)
        }
        console.log(`✅ Created ${segments.length} booking record(s) from booking.updated webhook`)
      }
      
      console.log(`✅ Successfully created booking ${baseBookingId} from booking.updated webhook`)
      return
    }

    console.log(`✅ Found ${existingBookings.length} booking record(s) for ${baseBookingId}`)
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:3541',message:'found existing bookings',data:{baseBookingId,count:existingBookings.length,bookingIds:existingBookings.map(b=>b.booking_id).join(','),versions:existingBookings.map(b=>b.version).join(','),statuses:existingBookings.map(b=>b.status).join(',')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion

    // Update each booking record (for multi-service bookings)
    for (const existingBooking of existingBookings) {
      const organizationId = existingBooking.organization_id
      const bookingUuid = existingBooking.id
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:3545',message:'processing existing booking update',data:{bookingUuid,existingVersion:existingBooking.version,existingStatus:existingBooking.status,newVersion:version,newStatus:status,newUpdatedAt:updatedAt?.toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion

      // Resolve location UUID if location_id changed
      let locationUuid = null
      if (squareLocationId) {
        const locationRecord = await prisma.$queryRaw`
          SELECT id FROM locations 
          WHERE square_location_id = ${squareLocationId}
            AND organization_id = ${organizationId}::uuid
          LIMIT 1
        `
        locationUuid = locationRecord && locationRecord.length > 0 ? locationRecord[0].id : null
      }

      // Process appointment segments to update service-specific fields
      let serviceVariationId = existingBooking.service_variation_id
      let technicianId = existingBooking.technician_id
      let administratorId = existingBooking.administrator_id
      let durationMinutes = null
      let serviceVariationVersion = null

      // Process appointment segments to resolve Square IDs to UUIDs
      if (appointmentSegments.length > 0) {
        // Try to match existing booking's service variation with segments
        let matchingSegment = null
        
        if (existingBooking.service_variation_id) {
          // Find the Square ID for the existing service variation
          const squareServiceVariationId = await prisma.$queryRaw`
            SELECT square_variation_id FROM service_variation
            WHERE uuid = ${existingBooking.service_variation_id}::uuid
            LIMIT 1
          `
          
          if (squareServiceVariationId && squareServiceVariationId.length > 0) {
            const svId = squareServiceVariationId[0].square_variation_id
            matchingSegment = appointmentSegments.find(seg => 
              (seg.service_variation_id || seg.serviceVariationId) === svId
            )
          }
        }
        
        // If no match found, use first segment
        if (!matchingSegment && appointmentSegments.length > 0) {
          matchingSegment = appointmentSegments[0]
        }
        
        if (matchingSegment) {
          // Resolve service variation Square ID to UUID
          const squareServiceVariationId = matchingSegment.service_variation_id || matchingSegment.serviceVariationId
          if (squareServiceVariationId) {
            const svRecord = await prisma.$queryRaw`
              SELECT uuid::text as id FROM service_variation
              WHERE square_variation_id = ${squareServiceVariationId}
                AND organization_id = ${organizationId}::uuid
              LIMIT 1
            `
            serviceVariationId = svRecord && svRecord.length > 0 ? svRecord[0].id : null
          }
          
          // Resolve team member Square ID to UUID
          const squareTeamMemberId = matchingSegment.team_member_id || matchingSegment.teamMemberId
          if (squareTeamMemberId) {
            const teamMemberRecord = await prisma.$queryRaw`
              SELECT id::text as id FROM team_members
              WHERE square_team_member_id = ${squareTeamMemberId}
                AND organization_id = ${organizationId}::uuid
              LIMIT 1
            `
            technicianId = teamMemberRecord && teamMemberRecord.length > 0 ? teamMemberRecord[0].id : null
          }
          
          durationMinutes = matchingSegment.duration_minutes || matchingSegment.durationMinutes || null
          serviceVariationVersion = matchingSegment.service_variation_version || matchingSegment.serviceVariationVersion
            ? BigInt(matchingSegment.service_variation_version || matchingSegment.serviceVariationVersion)
            : null
        }
      }

      // Build update query
      const updateFields = []
      const updateValues = []
      
      if (status) {
        updateFields.push('status = $' + (updateValues.length + 1))
        updateValues.push(status)
      }
      
      if (customerNote !== null) {
        updateFields.push('customer_note = $' + (updateValues.length + 1))
        updateValues.push(customerNote)
      }
      
      if (sellerNote !== null) {
        updateFields.push('seller_note = $' + (updateValues.length + 1))
        updateValues.push(sellerNote)
      }
      
      if (version !== null) {
        updateFields.push('version = $' + (updateValues.length + 1))
        updateValues.push(version)
      }
      
      if (locationUuid) {
        updateFields.push('location_id = $' + (updateValues.length + 1) + '::uuid')
        updateValues.push(locationUuid)
      }
      
      if (serviceVariationId) {
        updateFields.push('service_variation_id = $' + (updateValues.length + 1) + '::uuid')
        updateValues.push(serviceVariationId)
      }
      
      if (technicianId) {
        updateFields.push('technician_id = $' + (updateValues.length + 1) + '::uuid')
        updateValues.push(technicianId)
      }
      
      if (durationMinutes !== null) {
        updateFields.push('duration_minutes = $' + (updateValues.length + 1))
        updateValues.push(durationMinutes)
      }
      
      if (serviceVariationVersion !== null) {
        updateFields.push('service_variation_version = $' + (updateValues.length + 1))
        updateValues.push(serviceVariationVersion.toString())
      } else if (appointmentSegments.length > 0) {
        // If version is null but we have segments, try to get it from raw_json
        const firstSegment = appointmentSegments[0]
        const rawVersion = firstSegment.serviceVariationVersion || firstSegment.service_variation_version
        if (rawVersion) {
          updateFields.push('service_variation_version = $' + (updateValues.length + 1))
          updateValues.push(BigInt(rawVersion).toString())
        }
      }
      
      // Always update updated_at and raw_json
      updateFields.push('updated_at = $' + (updateValues.length + 1) + '::timestamptz')
      updateValues.push(updatedAt)
      
      updateFields.push('raw_json = $' + (updateValues.length + 1) + '::jsonb')
      updateValues.push(JSON.stringify(bookingData))

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:3682',message:'preparing update query',data:{bookingUuid,updateFieldsCount:updateFields.length,updateFields:updateFields.join(','),hasVersion:version!==null,versionValue:version,hasStatus:status!==null,statusValue:status,updatedAtValue:updatedAt?.toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
      // #endregion

      if (updateFields.length > 0) {
        const updateQuery = `
          UPDATE bookings
          SET ${updateFields.join(', ')}
          WHERE id = $${updateValues.length + 1}::uuid
        `
        updateValues.push(bookingUuid)
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:3690',message:'executing update query',data:{bookingUuid,queryPreview:updateQuery.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        
        await prisma.$executeRawUnsafe(updateQuery, ...updateValues)
        console.log(`✅ Updated booking ${bookingUuid} (${baseBookingId})`)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:3697',message:'update query completed',data:{bookingUuid,baseBookingId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'I'})}).catch(()=>{});
        // #endregion
      } else {
        console.log(`ℹ️ No fields to update for booking ${bookingUuid}`)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:3700',message:'no fields to update',data:{bookingUuid,version,status,updatedAt:updatedAt?.toISOString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'J'})}).catch(()=>{});
        // #endregion
      }
    }

    console.log(`✅ Successfully processed booking.updated for ${baseBookingId}`)
  } catch (error) {
    console.error(`❌ Error processing booking.updated:`, error.message)
    console.error(`   Stack:`, error.stack)
    throw error // Re-throw so webhook returns 500 and Square retries
  }
}

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

    // Idempotency is handled by giftcard_runs table via correlationId

    console.log(`📅 Processing booking created for customer: ${customerId}`)
    console.log('Full booking data:', safeStringify(bookingData))
    const bookingLocationId = getFriendlyLocationIdFromBooking(bookingData)
    if (bookingLocationId) {
      console.log(`📍 Booking attributed to location: ${bookingLocationId}`)
    }

    if (runContext?.correlationId) {
      await updateGiftCardRunStage(prisma, runContext.correlationId, {
        stage: 'booking:received',
        status: 'running',
        payload: bookingData,
        context: { customerId }
      })
    }

    // Save booking(s) to database - split if multiple services
    const bookingId = bookingData.id || bookingData.bookingId
    const segments = bookingData.appointment_segments || bookingData.appointmentSegments || []
    
    // Extract merchant_id from runContext or bookingData
    const merchantId = runContext?.merchantId || bookingData.merchantId || bookingData.merchant_id || null
    
    // Resolve organization_id - PRIORITIZE location_id (always available, fast database lookup)
    let organizationId = runContext?.organizationId || null
    
    // STEP 1: Try location_id FIRST (always available in webhooks, fast DB lookup)
    if (!organizationId) {
      const squareLocationId = bookingData.location_id || bookingData.locationId
      if (squareLocationId) {
        console.log(`📍 Resolving organization_id from location_id: ${squareLocationId}`)
        organizationId = await resolveOrganizationIdFromLocationId(squareLocationId)
        if (organizationId) {
          console.log(`✅ Resolved organization_id from location: ${organizationId}`)
        }
      }
    }
    
    // STEP 2: Fallback to merchant_id (if location lookup failed)
    if (!organizationId && merchantId) {
      organizationId = await resolveOrganizationId(merchantId)
      if (organizationId) {
        console.log(`✅ Resolved organization_id from merchant_id: ${organizationId}`)
      }
    }
    
    // STEP 3: Fallback to customer (if both location and merchant failed)
    if (!organizationId && customerId) {
      try {
        const customerOrg = await prisma.$queryRaw`
          SELECT organization_id FROM square_existing_clients 
          WHERE square_customer_id = ${customerId}
          LIMIT 1
        `
        if (customerOrg && customerOrg.length > 0) {
          organizationId = customerOrg[0].organization_id
          console.log(`✅ Resolved organization_id from customer: ${organizationId}`)
        }
      } catch (error) {
        console.warn(`⚠️ Could not resolve organization_id from customer: ${error.message}`)
      }
    }
    
    if (!organizationId) {
      console.error(`❌ CRITICAL: Cannot process booking: organization_id is required but could not be resolved`)
      console.error(`   Booking ID: ${bookingId}`)
      console.error(`   Customer ID: ${customerId}`)
      console.error(`   Merchant ID: ${merchantId || 'missing'}`)
      console.error(`   Location ID: ${bookingData.location_id || bookingData.locationId || 'missing'}`)
      console.error(`   Attempted: merchant_id lookup, customer lookup, location_id lookup (with Square API)`)
      throw new Error(`Cannot process booking: organization_id is required but could not be resolved. Booking ID: ${bookingId}, Customer ID: ${customerId}, Location ID: ${bookingData.location_id || bookingData.locationId || 'missing'}`)
    }
    
    if (segments.length === 0) {
      // No services, save booking as-is
      await saveBookingToDatabase(bookingData, null, customerId, merchantId, organizationId)
    } else {
      // Multiple services - create one booking per service
      for (const segment of segments) {
        await saveBookingToDatabase(bookingData, segment, customerId, merchantId, organizationId)
      }
      console.log(`✅ Saved ${segments.length} booking record(s) for booking ${bookingId}`)
    }

    // Check if customer exists in our database
    console.log('🔍 Step 1: Checking if customer exists in database...')
    let customerExists = await prisma.$queryRaw`
      SELECT square_customer_id, got_signup_bonus, used_referral_code, email_address,
             given_name, family_name, phone_number, gift_card_id,
             gift_card_order_id, gift_card_line_item_uid, gift_card_delivery_channel,
             gift_card_activation_url, gift_card_pass_kit_url, gift_card_digital_email,
             personal_code, activated_as_referrer
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
    console.log(`   Personal code: ${customer.personal_code || 'N/A'}`)
    console.log(`   Activated as referrer: ${customer.activated_as_referrer || false}`)
    console.log('🔍 Step 3: Checking for referral code in Square webhook data...')
    console.log(`   📦 Booking ID: ${bookingId}`)
    console.log(`   📦 Full booking payload keys: ${Object.keys(bookingData).join(', ')}`)

    // Get referral code from booking data or custom attributes
    let referralCode = null
    let referralCodeSource = null // Track where we found it
    
    // First check if booking has referral code data
    if (bookingData.serviceVariationCapabilityDetails) {
      // Try to get from booking extension data
      const extensionData = bookingData.serviceVariationCapabilityDetails
      if (extensionData && extensionData.values) {
        console.log(`   🔍 Checking serviceVariationCapabilityDetails for referral code...`)
        for (let key in extensionData.values) {
          if (key.toLowerCase().includes('referral') || key.toLowerCase().includes('ref')) {
            referralCode = extensionData.values[key]
            referralCodeSource = 'serviceVariationCapabilityDetails'
            console.log(`   ✅ Found referral code in serviceVariationCapabilityDetails: ${referralCode}`)
            console.log(`   📍 Source: serviceVariationCapabilityDetails[${key}]`)
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
              referralCodeSource = 'booking.custom_fields'
              console.log(`   ✅ Found referral code in booking.custom_fields: ${value}`)
              console.log(`   📍 Source: booking.custom_fields[${fieldName || fieldKey}]`)
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
                referralCodeSource = 'appointment_segments.custom_fields'
                console.log(`   ✅ Found referral code in appointment segment custom fields: ${value}`)
                console.log(`   📍 Source: appointment_segments[].custom_fields[${fieldName || fieldKey}]`)
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
          referralCodeSource = 'customer.custom_attributes[referral_code]'
          console.log(`   ✅ Valid referral code found: ${codeValue}`)
          console.log(`   📍 Source: customer.custom_attributes['referral_code']`)
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
              referralCodeSource = `customer.custom_attributes[${key}]`
              console.log(`   ✅ Found referral code in custom attribute: ${key} = ${value}`)
              console.log(`   📍 Source: customer.custom_attributes['${key}']`)
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
      console.log(`   📍 Referral code source: ${referralCodeSource || 'unknown'}`)
    }

    // EARLY VALIDATION: Check if customer is trying to use their own code
    if (referralCode && customer.personal_code) {
      const normalizedCustomerCode = customer.personal_code.toUpperCase().trim()
      const normalizedReferralCode = referralCode.toUpperCase().trim()
      if (normalizedCustomerCode === normalizedReferralCode) {
        console.log(`   ❌ BLOCKED: Customer tried to use their own personal_code`)
        console.log(`   ⚠️ Customer personal_code: ${customer.personal_code}`)
        console.log(`   ⚠️ Referral code used: ${referralCode}`)
        console.log(`   ⚠️ Skipping to prevent self-referral abuse`)
        
        referralCode = null // Clear it so no reward is given
      }
    }

    // NOW check for referral code and give gift card
    if (referralCode) {
      console.log(`🎁 Customer used referral code: ${referralCode}`)
      console.log(`   📋 Customer ID: ${customerId}`)
      console.log(`   📋 Customer name: ${customer.given_name} ${customer.family_name}`)
      console.log(`   📋 Customer personal_code: ${customer.personal_code || 'N/A'}`)
      console.log(`   📍 Code source: ${referralCodeSource || 'unknown'}`)

      // Find the referrer
      const referrer = await findReferrerByCode(referralCode)

      if (referrer) {
        console.log(`👤 Found referrer: ${referrer.given_name} ${referrer.family_name}`)
        console.log(`   📋 Referrer ID: ${referrer.square_customer_id}`)
        console.log(`   📋 Referrer personal_code: ${referrer.personal_code}`)

        // STRICT VALIDATION: Prevent self-referral and abuse
        const isSelfReferral = referrer.square_customer_id === customerId
        const isOwnCode = customer.personal_code && 
                          customer.personal_code.toUpperCase().trim() === referralCode.toUpperCase().trim()
        const isKnownReferrer = customer.activated_as_referrer === true
        
        console.log(`   🔒 Validation checks:`)
        console.log(`      - Is self-referral (same customer ID): ${isSelfReferral}`)
        console.log(`      - Is own code (personal_code matches): ${isOwnCode}`)
        console.log(`      - Is known referrer: ${isKnownReferrer}`)
        
        if (isSelfReferral || isOwnCode || isKnownReferrer) {
          const reason = isSelfReferral 
            ? 'Customer ID matches referrer ID (self-referral)'
            : isOwnCode
            ? 'Customer used their own personal_code'
            : 'Customer is already an activated referrer'
          
          console.log(`   ❌ BLOCKED: ${reason}`)
          console.log(`   ⚠️ Skipping friend reward to prevent abuse`)
          console.log(`   📝 Referral code will NOT be saved to used_referral_code`)
          
          return
        }
        
        console.log(`   ✅ Validation passed - referral code is valid`)
        
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
          // Save used_referral_code to ReferralProfile (new normalized table)
          try {
            await prisma.referralProfile.upsert({
              where: { square_customer_id: customerId },
              update: {
                used_referral_code: referralCode,
                updated_at: new Date()
              },
              create: {
                square_customer_id: customerId,
                used_referral_code: referralCode
              }
            })
            console.log(`✅ Updated ReferralProfile with used_referral_code: ${referralCode}`)
          } catch (profileError) {
            console.warn(`⚠️ Failed to update ReferralProfile with used_referral_code: ${profileError.message}`)
            // Continue - non-critical error
          }
          
          // Also update square_existing_clients for backward compatibility
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
            // Log email parameters for debugging
            console.log(`📧 Preparing to send gift card email to ${friendEmail}:`)
            console.log(`   - amountCents: ${friendGiftCard.amountCents} (type: ${typeof friendGiftCard.amountCents})`)
            console.log(`   - balanceCents: ${friendGiftCard.balanceCents} (type: ${typeof friendGiftCard.balanceCents})`)
            console.log(`   - giftCardGan: ${friendGiftCard.giftCardGan}`)
            console.log(`   - giftCardId: ${friendGiftCard.giftCardId}`)
            
            try {
              const emailResult = await sendGiftCardEmailNotification({
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
              
              if (emailResult?.success === false && emailResult?.skipped) {
                console.log(`⚠️ Email skipped: ${emailResult.reason}`)
                console.log(`   - amountCents was: ${friendGiftCard.amountCents}`)
                console.log(`   - balanceCents was: ${friendGiftCard.balanceCents}`)
              } else if (emailResult?.success === false) {
                console.error(`❌ Email sending failed:`, emailResult.error || 'Unknown error')
              } else {
                console.log(`✅ Email sent successfully`)
              }
            } catch (emailError) {
              console.error(`❌ Error in sendGiftCardEmailNotification:`, emailError.message)
              console.error(`   Stack:`, emailError.stack)
            }
          } else {
            console.log('⚠️ Friend gift card email skipped – missing email address')
          }

          // Create ReferralReward record for friend signup bonus
          try {
            const giftCardRecord = await prisma.giftCard.findUnique({
              where: { square_gift_card_id: friendGiftCard.giftCardId }
            })
            
            await prisma.referralReward.create({
              data: {
                referrer_customer_id: referrer.square_customer_id,
                referred_customer_id: customerId,
                reward_amount_cents: rewardAmountCents, // 1000 cents = $10
                status: 'PAID',
                gift_card_id: giftCardRecord?.id || null,
                payment_id: null,
                booking_id: bookingId || null,
                reward_type: 'friend_signup_bonus',
                paid_at: new Date(),
                metadata: {
                  referral_code: referralCode,
                  source: `booking.created (${referralCodeSource || 'unknown'})`,
                  gift_card_square_id: friendGiftCard.giftCardId
                }
              }
            })
            console.log(`✅ Created ReferralReward record for friend signup bonus`)
          } catch (rewardError) {
            console.warn(`⚠️ Failed to create ReferralReward record: ${rewardError.message}`)
            // Continue - non-critical error
          }

          // Send notification to admin about referral code usage
          try {
            await sendReferralCodeUsageNotification({
              referralCode,
              customer: {
                square_customer_id: customerId,
                given_name: customer.given_name,
                family_name: customer.family_name,
                email_address: customer.email_address,
                phone_number: customer.phone_number,
                personal_code: customer.personal_code
              },
              referrer: {
                square_customer_id: referrer.square_customer_id,
                given_name: referrer.given_name,
                family_name: referrer.family_name,
                email_address: referrer.email_address,
                personal_code: referrer.personal_code
              },
              booking: {
                id: bookingId,
                start_at: bookingData?.start_at,
                location_id: bookingLocationId
              },
              giftCard: {
                giftCardId: friendGiftCard.giftCardId,
                giftCardGan: friendGiftCard.giftCardGan,
                amountCents: friendGiftCard.amountCents
              },
              source: `booking.created (${referralCodeSource || 'unknown'})`
            })
          } catch (notificationError) {
            // Don't fail the whole process if notification fails
            console.error('⚠️ Failed to send referral code usage notification:', notificationError.message)
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

    // Idempotency is handled by giftcard_runs table via correlationId

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
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4689',message:'webhook parsed',data:{type:webhookData?.type,hasData:!!webhookData?.data,hasObject:!!webhookData?.data?.object,hasBooking:!!webhookData?.data?.object?.booking,eventId:webhookData?.event_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

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

        // Extract merchant_id from webhook event
        const merchantId = webhookData.merchant_id || webhookData.merchantId || customerData.merchantId || customerData.merchant_id || null
        
        // Resolve organization_id from merchant_id
        let organizationId = null
        if (merchantId) {
          organizationId = await resolveOrganizationId(merchantId)
        }

        const runContext = { correlationId, merchantId, organizationId }
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
            squareEventType: webhookData.type,
            merchantId: merchantId,
            organizationId: organizationId
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

        // Extract merchant_id from webhook event
        const merchantId = webhookData.merchant_id || webhookData.merchantId || bookingData.merchantId || bookingData.merchant_id || null
        
        // Resolve organization_id from merchant_id
        let organizationId = null
        if (merchantId) {
          organizationId = await resolveOrganizationId(merchantId)
        }
        
        const runContext = { correlationId, merchantId, organizationId }

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
            squareEventType: webhookData.type,
            merchantId: merchantId,
            organizationId: organizationId
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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4955',message:'checking webhook type',data:{webhookType:webhookData?.type,isBookingUpdated:webhookData?.type==='booking.updated',typeComparison:JSON.stringify({actual:webhookData?.type,expected:'booking.updated'})},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    // Process booking.updated events (when booking is modified)
    if (webhookData.type === 'booking.updated') {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4958',message:'booking.updated handler entered',data:{hasWebhookData:!!webhookData,hasData:!!webhookData?.data,hasObject:!!webhookData?.data?.object,hasBooking:!!webhookData?.data?.object?.booking,eventId:webhookData?.event_id,dataKeys:webhookData?.data?Object.keys(webhookData.data).join(','):'no-data',objectKeys:webhookData?.data?.object?Object.keys(webhookData.data.object).join(','):'no-object'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      const bookingData = webhookData.data?.object?.booking || webhookData.data?.booking
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4960',message:'bookingData extracted',data:{hasBookingData:!!bookingData,bookingId:bookingData?.id||bookingData?.bookingId||'missing',customerId:bookingData?.customer_id||bookingData?.customerId||'missing',status:bookingData?.status||'missing'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      console.log('📅 Processing booking.updated event')
      console.log('   Booking ID:', bookingData?.id || bookingData?.bookingId || 'missing')
      console.log('   Status:', bookingData?.status || 'missing')
      
      if (bookingData) {
        try {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4968',message:'calling processBookingUpdated',data:{bookingId:bookingData?.id||bookingData?.bookingId,eventId:webhookData?.event_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          
          await processBookingUpdated(bookingData, webhookData.event_id, webhookData.created_at)
          
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4972',message:'processBookingUpdated completed',data:{bookingId:bookingData?.id||bookingData?.bookingId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          
          console.log('✅ Booking updated webhook processed successfully')
          
          return Response.json({
            success: true,
            processed: true,
            bookingId: bookingData.id || bookingData.bookingId
          }, { status: 200 })
        } catch (bookingError) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4982',message:'processBookingUpdated error',data:{error:bookingError.message,bookingId:bookingData?.id||bookingData?.bookingId,stack:bookingError.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          
          console.error(`❌ Error processing booking.updated webhook:`, bookingError.message)
          console.error(`   Stack:`, bookingError.stack)
          // Re-throw to return 500 so Square will retry
          throw bookingError
        }
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4990',message:'booking.updated missing booking data',data:{hasData:!!webhookData?.data,hasObject:!!webhookData?.data?.object,webhookKeys:Object.keys(webhookData||{}).join(',')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        console.warn(`⚠️ Booking updated webhook received but booking data is missing`)
        console.warn(`   Tried: webhookData.data?.object?.booking, webhookData.data?.booking`)
        console.warn(`   webhookData.data keys:`, webhookData.data ? Object.keys(webhookData.data).join(', ') : 'N/A')
        
        return Response.json({
          success: false,
          error: 'Booking data missing from webhook'
        }, { status: 400 })
      }
    }

    // Process payment.created events (any payment type including cash)
    if (webhookData.type === 'payment.created') {
      const paymentData = webhookData.data.object.payment
      
      // Debug: Log payment data structure to verify location_id is present
      if (paymentData) {
        console.log(`🔍 Payment.created webhook - checking location_id:`)
        console.log(`   Payment ID: ${paymentData.id || paymentData.paymentId || 'unknown'}`)
        console.log(`   location_id (snake_case): ${paymentData.location_id || 'MISSING'}`)
        console.log(`   locationId (camelCase): ${paymentData.locationId || 'MISSING'}`)
        console.log(`   order_id: ${paymentData.order_id || paymentData.orderId || 'MISSING'}`)
      }
      
      // CRITICAL: Save payment to database first (before gift card processing)
      // This ensures payments are stored even if gift card processing fails
      if (paymentData) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4414',message:'payment.created webhook - starting save',data:{paymentId:paymentData.id||paymentData.paymentId||'unknown',hasLocationId:!!(paymentData.location_id||paymentData.locationId),locationId:paymentData.location_id||paymentData.locationId||'missing',orderId:paymentData.order_id||paymentData.orderId||'missing'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        let paymentSaveSuccess = false
        try {
          console.log(`💾 Attempting to save payment ${paymentData.id || paymentData.paymentId || 'unknown'} to database...`)
          const savePayment = await getSavePaymentToDatabase()
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4418',message:'savePayment function retrieved (payment.created)',data:{hasFunction:!!savePayment,isFunction:typeof savePayment==='function',type:typeof savePayment},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          if (savePayment && typeof savePayment === 'function') {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4420',message:'calling savePayment function (payment.created)',data:{paymentId:paymentData.id||paymentData.paymentId||'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            await savePayment(paymentData, webhookData.type, webhookData.event_id, webhookData.created_at)
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4422',message:'savePayment completed successfully (payment.created)',data:{paymentId:paymentData.id||paymentData.paymentId||'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
            console.log('✅ Payment saved to database')
            paymentSaveSuccess = true
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4424',message:'savePayment function not available (payment.created)',data:{hasFunction:!!savePayment,type:typeof savePayment,value:String(savePayment).substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            console.error('❌ savePaymentToDatabase function not available or not a function')
            console.error(`   Type: ${typeof savePayment}, Value: ${savePayment}`)
          }
        } catch (paymentSaveError) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4428',message:'payment save error (payment.created)',data:{error:paymentSaveError.message,stack:paymentSaveError.stack?.substring(0,500),paymentId:paymentData.id||paymentData.paymentId||'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
          // #endregion
          console.error(`❌ Error saving payment to database: ${paymentSaveError.message}`)
          console.error('   Stack:', paymentSaveError.stack)
          // Don't throw - we'll enqueue a job as fallback
        }
        
        // FALLBACK: If immediate save failed, enqueue a payment_save job for cron to process
        if (!paymentSaveSuccess) {
          console.warn('⚠️ Immediate payment save failed, enqueueing payment_save job as fallback...')
          try {
            const paymentResourceId = paymentData.id || paymentData.paymentId
            const customerIdFromPayment = paymentData.customerId || paymentData.customer_id || null
            const correlationId = buildCorrelationId({
              triggerType: webhookData.type,
              eventId: webhookData.event_id,
              resourceId: paymentResourceId || customerIdFromPayment || 'payment-save-fallback'
            })
            
            // Extract merchant_id for context
            const merchantId = webhookData.merchant_id || webhookData.merchantId || paymentData.merchantId || paymentData.merchant_id || null
            let organizationId = null
            if (merchantId) {
              organizationId = await resolveOrganizationId(merchantId)
            }
            
            await enqueueGiftCardJob(prisma, {
              correlationId,
              triggerType: webhookData.type,
              stage: 'payment_save', // New stage for payment saving
              payload: paymentData,
              context: {
                squareEventId: webhookData.event_id,
                squareEventType: webhookData.type,
                squareCreatedAt: webhookData.created_at,
                merchantId,
                organizationId,
                paymentId: paymentResourceId,
                customerId: customerIdFromPayment,
                fallback: true // Mark as fallback job
              }
            })
            console.log('✅ Payment save job enqueued as fallback')
          } catch (enqueueError) {
            console.error(`❌ Failed to enqueue payment save job: ${enqueueError.message}`)
            // Still continue with gift card processing
          }
        }
      }
      
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

        // Extract merchant_id from webhook event
        const merchantId = webhookData.merchant_id || webhookData.merchantId || paymentData.merchantId || paymentData.merchant_id || null
        
        // Resolve organization_id from merchant_id
        let organizationId = null
        if (merchantId) {
          organizationId = await resolveOrganizationId(merchantId)
        }

        const runContext = { correlationId, merchantId, organizationId }

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
            squareEventType: webhookData.type,
            merchantId: merchantId,
            organizationId: organizationId
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4579',message:'payment.updated handler entered',data:{hasWebhookData:!!webhookData,hasData:!!webhookData?.data,hasObject:!!webhookData?.data?.object,hasPayment:!!webhookData?.data?.object?.payment},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'P'})}).catch(()=>{});
      // #endregion
      const paymentData = webhookData.data.object.payment
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4581',message:'paymentData extracted',data:{hasPaymentData:!!paymentData,paymentId:paymentData?.id||paymentData?.paymentId||'null',locationId:paymentData?.location_id||paymentData?.locationId||'null'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'Q'})}).catch(()=>{});
      // #endregion
      
      // Debug: Log payment data structure to verify location_id is present
      if (paymentData) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4585',message:'paymentData exists - entering check block',data:{paymentId:paymentData.id||paymentData.paymentId||'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'R'})}).catch(()=>{});
        // #endregion
        console.log(`🔍 Payment.updated webhook - checking location_id:`)
        console.log(`   Payment ID: ${paymentData.id || paymentData.paymentId || 'unknown'}`)
        console.log(`   location_id (snake_case): ${paymentData.location_id || 'MISSING'}`)
        console.log(`   locationId (camelCase): ${paymentData.locationId || 'MISSING'}`)
        console.log(`   order_id: ${paymentData.order_id || paymentData.orderId || 'MISSING'}`)
        console.log(`   merchant_id: ${paymentData.merchant_id || paymentData.merchantId || 'MISSING'}`)
        
        // According to Square docs, payment.updated should include location_id
        // If it's missing, this might indicate a data issue or API version difference
        if (!paymentData.location_id && !paymentData.locationId) {
          console.warn(`⚠️ WARNING: Payment.updated webhook missing location_id (should be present per Square API docs)`)
          console.warn(`   Payment object keys:`, Object.keys(paymentData).join(', '))
        }
      }
      
      // CRITICAL: Save payment to database first (before gift card processing)
      // This ensures payments are stored even if gift card processing fails
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4599',message:'before payment save check',data:{hasPaymentData:!!paymentData,paymentDataType:typeof paymentData,paymentId:paymentData?.id||paymentData?.paymentId||'null'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'U'})}).catch(()=>{});
      // #endregion
      if (paymentData) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4601',message:'paymentData exists - entering save block',data:{paymentId:paymentData.id||paymentData.paymentId||'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'T'})}).catch(()=>{});
        // #endregion
        let paymentSaveSuccess = false
        try {
          console.log(`💾 Attempting to save payment ${paymentData.id || paymentData.paymentId || 'unknown'} to database...`)
          const savePayment = await getSavePaymentToDatabase()
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4605',message:'savePayment function retrieved (payment.updated)',data:{hasFunction:!!savePayment,isFunction:typeof savePayment==='function',type:typeof savePayment},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          if (savePayment && typeof savePayment === 'function') {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4607',message:'calling savePayment function (payment.updated)',data:{paymentId:paymentData.id||paymentData.paymentId||'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            await savePayment(paymentData, webhookData.type, webhookData.event_id, webhookData.created_at)
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4609',message:'savePayment completed successfully (payment.updated)',data:{paymentId:paymentData.id||paymentData.paymentId||'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
            // #endregion
            console.log('✅ Payment saved to database')
            paymentSaveSuccess = true
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4611',message:'savePayment function not available (payment.updated)',data:{hasFunction:!!savePayment,type:typeof savePayment,value:String(savePayment).substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            console.error('❌ savePaymentToDatabase function not available or not a function')
            console.error(`   Type: ${typeof savePayment}, Value: ${savePayment}`)
          }
        } catch (paymentSaveError) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4615',message:'payment save error (payment.updated)',data:{error:paymentSaveError.message,stack:paymentSaveError.stack?.substring(0,500),paymentId:paymentData.id||paymentData.paymentId||'unknown'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
          // #endregion
          console.error(`❌ Error saving payment to database: ${paymentSaveError.message}`)
          console.error('   Stack:', paymentSaveError.stack)
          // Don't throw - we'll enqueue a job as fallback
        }
        
        // FALLBACK: If immediate save failed, enqueue a payment_save job for cron to process
        if (!paymentSaveSuccess) {
          console.warn('⚠️ Immediate payment save failed, enqueueing payment_save job as fallback...')
          try {
            const paymentResourceId = paymentData.id || paymentData.paymentId
            const customerIdFromPayment = paymentData.customerId || paymentData.customer_id || null
            const correlationId = buildCorrelationId({
              triggerType: webhookData.type,
              eventId: webhookData.event_id,
              resourceId: paymentResourceId || customerIdFromPayment || 'payment-save-fallback'
            })
            
            // Extract merchant_id for context
            const merchantId = webhookData.merchant_id || webhookData.merchantId || paymentData.merchantId || paymentData.merchant_id || null
            let organizationId = null
            if (merchantId) {
              organizationId = await resolveOrganizationId(merchantId)
            }
            
            await enqueueGiftCardJob(prisma, {
              correlationId,
              triggerType: webhookData.type,
              stage: 'payment_save', // New stage for payment saving
              payload: paymentData,
              context: {
                squareEventId: webhookData.event_id,
                squareEventType: webhookData.type,
                squareCreatedAt: webhookData.created_at,
                merchantId,
                organizationId,
                paymentId: paymentResourceId,
                customerId: customerIdFromPayment,
                fallback: true // Mark as fallback job
              }
            })
            console.log('✅ Payment save job enqueued as fallback')
          } catch (enqueueError) {
            console.error(`❌ Failed to enqueue payment save job: ${enqueueError.message}`)
            // Still continue with gift card processing
          }
        }
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:4620',message:'paymentData is null - skipping save',data:{hasWebhookData:!!webhookData,webhookDataKeys:webhookData?Object.keys(webhookData).join(','):'null'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'V'})}).catch(()=>{});
        // #endregion
        console.warn('⚠️ payment.updated webhook: paymentData is null, cannot save payment')
      }
      
      // Process gift card redemptions for ALL payment updates (not just first payment)
      // This ensures we capture REDEEM transactions even if payment processing logic skips
      await processGiftCardRedemptions(paymentData)
      
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

        // Extract merchant_id from webhook event
        const merchantId = webhookData.merchant_id || webhookData.merchantId || paymentData.merchantId || paymentData.merchant_id || null
        
        // Resolve organization_id from merchant_id
        let organizationId = null
        if (merchantId) {
          organizationId = await resolveOrganizationId(merchantId)
        }

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
            paymentId: paymentResourceId,
            merchantId: merchantId,
            organizationId: organizationId
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
            squareEventType: webhookData.type,
            merchantId: merchantId,
            organizationId: organizationId
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d4bb41e0-e49d-40c3-bd8a-e995d2166939',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'referrals/route.js:5462',message:'default return for unhandled event',data:{webhookType:webhookData?.type,isBookingUpdated:webhookData?.type==='booking.updated'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    
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

// Export processBookingUpdated for use in main webhook route
export { processBookingUpdated }

// Handle GET requests for webhook verification
export async function GET(request) {
  return Response.json({
    message: 'Square Referral Webhook Handler',
    status: 'active',
    timestamp: new Date().toISOString()
  })
}

