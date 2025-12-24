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
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const customersApi = squareClient.customersApi
const giftCardsApi = squareClient.giftCardsApi
const giftCardActivitiesApi = squareClient.giftCardActivitiesApi
const customerCustomAttributesApi = squareClient.customerCustomAttributesApi
const ordersApi = squareClient.ordersApi
const paymentsApi = squareClient.paymentsApi

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

// Helper function: Generate QR code for gift card
async function generateGiftCardQrDataUri(giftCardGan) {
  if (!giftCardGan) return null
  try {
    return await QRCode.toDataURL(`sqgc://${giftCardGan}`, {
      margin: 1,
      scale: 4,
      errorCorrectionLevel: 'M'
    })
  } catch (error) {
    console.warn(`⚠️ Failed to generate QR for gift card ${giftCardGan}:`, error.message)
    return null
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

async function findReferrerByCode(referralCode) {
  try {
    if (!referralCode || typeof referralCode !== 'string') {
      console.error(`Invalid referral code provided: ${referralCode}`)
      return null
    }
    
    const normalizedCode = referralCode.trim().toUpperCase()
    console.log(`   🔍 Looking up referral code in database: "${normalizedCode}" (original: "${referralCode}")`)
    
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

async function getCustomerCustomAttributes(customerId) {
  try {
    console.log(`   Fetching custom attributes for customer ${customerId}...`)
    
    const response = await customerCustomAttributesApi.listCustomerCustomAttributes(customerId)
    
    console.log(`   Full custom attributes response:`, safeStringify(response.result))
    
    if (response.result && response.result.customAttributes) {
      const attributes = {}
      response.result.customAttributes.forEach(attr => {
        attributes[attr.key] = attr.value
        console.log(`   📋 Custom attribute: key="${attr.key}", value="${attr.value}"`)
      })
      
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

async function createGiftCard(customerId, customerName, amountCents = 1000, isReferrer = false, options = {}) {
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
    const giftCardGan = giftCard.gan
    console.log(`✅ Created gift card for ${customerName}: ${giftCardId}`)
    
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

async function checkSuspiciousActivity(customerId, ipAddress) {
  try {
    if (!ipAddress) return false

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
    
    if (!smsDestination) {
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

    const ipAddress = request?.headers?.get?.('x-forwarded-for') || 
                     request?.headers?.get?.('x-real-ip') || 
                     request?.connection?.remoteAddress ||
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

    const isSuspicious = await checkSuspiciousActivity(customerId, ipAddress)
    if (isSuspicious) {
      console.log(`⚠️ Suspicious activity detected for customer ${customerId}, flagging for review`)
    }

    const isNew = await isNewCustomer(customerId)
    if (!isNew) {
      console.log(`ℹ️ Customer ${customerId} is not new, skipping...`)
      return
    }

    console.log(`🎉 New customer detected: ${customerId}`)

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
             given_name, family_name, email_address, first_payment_completed
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `

    if (!customerData || customerData.length === 0) {
      console.log(`Customer ${customerId} not found in database`)
      return
    }

    const customer = customerData[0]
    
    if (customer.first_payment_completed) {
      console.log(`Customer ${customerId} already completed first payment`)
      return
    }

    console.log(`🎉 First payment completed for customer: ${customer.given_name} ${customer.family_name}`)
    const locationId = process.env.SQUARE_LOCATION_ID?.trim()
    
    if (customer.used_referral_code) {
      console.log(`🎯 Customer used referral code: ${customer.used_referral_code}`)
      const referrer = await findReferrerByCode(customer.used_referral_code)
      if (referrer) {
        console.log(`👤 Found referrer: ${referrer.given_name} ${referrer.family_name}`)

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

    await prisma.$executeRaw`
      UPDATE square_existing_clients 
      SET first_payment_completed = TRUE
      WHERE square_customer_id = ${customerId}
    `

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
             given_name, family_name, phone_number,
             gift_card_order_id, gift_card_line_item_uid, gift_card_delivery_channel,
             gift_card_activation_url, gift_card_pass_kit_url, gift_card_digital_email
      FROM square_existing_clients 
      WHERE square_customer_id = ${customerId}
    `
    console.log(`   Found ${customerExists?.length || 0} customer(s) in database`)

    if (!customerExists || customerExists.length === 0) {
      console.log(`ℹ️ Customer ${customerId} not in database yet - need to add them first`)
      
      try {
        const response = await customersApi.retrieveCustomer(customerId)
        const squareCustomer = response.result.customer
        
        console.log(`📥 Fetching customer from Square:`, safeStringify(squareCustomer))
        
        const ipAddress = 'unknown'
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
        
        const newCustomerData = await prisma.$queryRaw`
          SELECT square_customer_id, got_signup_bonus, used_referral_code, email_address,
                 given_name, family_name,
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
    
    if (!referralCode) {
      console.log(`   No referral code in booking, checking custom attributes...`)
      const attributes = await getCustomerCustomAttributes(customerId)
      console.log(`   Custom attributes from Square:`, safeStringify(attributes))
      
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
      
      if (!referralCode) {
        console.log(`   🔍 Checking all custom attribute values for valid referral codes...`)
        for (const [key, value] of Object.entries(attributes)) {
          if (typeof value === 'string' && value.length > 0) {
            console.log(`   🔍 Checking custom attribute value: "${value}" (key: ${key})`)
            
            if (value.length > 20 || value.split(' ').length > 3) {
              console.log(`   ⏭️ Skipping value "${value}" - looks like text/review, not a code`)
              continue
            }
            
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

    if (referralCode) {
      console.log(`🎁 Customer used referral code: ${referralCode}`)

      const referrer = await findReferrerByCode(referralCode)

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

// Export the three main processor functions
module.exports = {
  processCustomerCreated,
  processBookingCreated,
  processPaymentCompletion
}
