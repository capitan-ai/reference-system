#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const QRCode = require('qrcode')
const { sendGiftCardIssuedEmail } = require('../lib/email-service-simple')

const prisma = new PrismaClient()

const squareEnvironment =
  process.env.SQUARE_ENVIRONMENT?.toLowerCase() === 'sandbox'
    ? Environment.Sandbox
    : Environment.Production

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: squareEnvironment
})

const giftCardsApi = squareClient.giftCardsApi
const giftCardActivitiesApi = squareClient.giftCardActivitiesApi

const DELIVERY_CHANNELS = {
  SQUARE_EGIFT_ORDER: 'square_egift_order',
  OWNER_FUNDED_ACTIVATE: 'owner_funded_activate',
  OWNER_FUNDED_ADJUST: 'owner_funded_adjust'
}

async function generateQr(giftCardGan) {
  if (!giftCardGan) return null
  try {
    return await QRCode.toDataURL(`sqgc://${giftCardGan}`, {
      margin: 1,
      scale: 4,
      errorCorrectionLevel: 'M'
    })
  } catch (error) {
    console.warn(`⚠️ Failed to generate QR code: ${error.message}`)
    return null
  }
}

async function createGiftCardViaOrder(customerId, customerName, orderInfo, amountCents = 1000) {
  const locationId = process.env.SQUARE_LOCATION_ID?.trim()
  if (!locationId) throw new Error('SQUARE_LOCATION_ID missing')

  const amountMoney = { amount: amountCents, currency: 'USD' }
  const giftCardRequest = {
    idempotencyKey: `sandbox-egift-${customerId}-${Date.now()}`,
    locationId,
    giftCard: {
      type: 'DIGITAL',
      state: 'PENDING'
    }
  }

  const createResponse = await giftCardsApi.createGiftCard(giftCardRequest)
  const giftCard = createResponse.result.giftCard
  if (!giftCard) throw new Error('Gift card creation failed')

  const giftCardId = giftCard.id
  const giftCardGan = giftCard.gan

  let giftCardActivity = null
  let activationChannel = null

  if (orderInfo?.orderId && orderInfo?.lineItemUid) {
    try {
      const activateResponse = await giftCardActivitiesApi.createGiftCardActivity({
        idempotencyKey: `sandbox-egift-activate-${giftCardId}-${Date.now()}`,
        giftCardActivity: {
          giftCardId,
          type: 'ACTIVATE',
          locationId,
          activateActivityDetails: {
            orderId: orderInfo.orderId,
            lineItemUid: orderInfo.lineItemUid,
            referenceId: 'Sandbox eGift test'
          }
        }
      })
      giftCardActivity = activateResponse.result?.giftCardActivity || null
      if (giftCardActivity) {
        activationChannel = DELIVERY_CHANNELS.SQUARE_EGIFT_ORDER
      }
    } catch (err) {
      console.error('❌ Order-based activation failed:', err.errors || err.message)
    }
  }

  if (!giftCardActivity && amountMoney.amount > 0) {
    const activateResponse = await giftCardActivitiesApi.createGiftCardActivity({
      idempotencyKey: `sandbox-egift-owner-activate-${giftCardId}-${Date.now()}`,
      giftCardActivity: {
        giftCardId,
        type: 'ACTIVATE',
        locationId,
        activateActivityDetails: {
          amountMoney,
          referenceId: 'Sandbox fallback',
          buyerPaymentInstrumentIds: ['OWNER_FUNDED']
        }
      }
    })
    giftCardActivity = activateResponse.result?.giftCardActivity || null
    if (giftCardActivity) activationChannel = DELIVERY_CHANNELS.OWNER_FUNDED_ACTIVATE
  }

  if (!giftCardActivity) {
    throw new Error('Gift card activation failed')
  }

  const verify = await giftCardsApi.retrieveGiftCard(giftCardId)
  const verifyCard = verify.result.giftCard

  return {
    giftCardId,
    giftCardGan,
    activationChannel,
    activationUrl: verifyCard?.digitalDetails?.activationUrl || null,
    passKitUrl: verifyCard?.digitalDetails?.passKitUrl || null,
    digitalEmail: verifyCard?.digitalDetails?.email || null,
    balanceCents: verifyCard?.balanceMoney?.amount ? Number(verifyCard.balanceMoney.amount) : amountMoney.amount,
    amountCents: amountMoney.amount
  }
}

async function main() {
  const customerId = process.argv[2] || ''
  const orderId = process.argv[3] || ''
  const lineItemUid = process.argv[4] || ''

  if (!customerId || !orderId || !lineItemUid) {
    console.error('Usage: node scripts/run-egift-order-test.js <customerId> <orderId> <lineItemUid>')
    process.exit(1)
  }

  console.log('🔧 Running sandbox eGift card test')
  console.log(`   Customer ID: ${customerId}`)
  console.log(`   Order ID:    ${orderId}`)
  console.log(`   Line Item:   ${lineItemUid}`)

  try {
    const customerRow = await prisma.$queryRaw`
      SELECT given_name, family_name, email_address
      FROM square_existing_clients
      WHERE square_customer_id = ${customerId}
      LIMIT 1
    `

    if (!customerRow || customerRow.length === 0) {
      throw new Error('Customer not found in square_existing_clients; insert the row first.')
    }

    const customer = customerRow[0]
    const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Gift Card Guest'

    const result = await createGiftCardViaOrder(
      customerId,
      customerName,
      { orderId, lineItemUid },
      1000
    )

    console.log('✅ Gift card created and activated:')
    console.log(`   ID: ${result.giftCardId}`)
    console.log(`   GAN: ${result.giftCardGan}`)
    console.log(`   Channel: ${result.activationChannel}`)

    await prisma.$executeRaw`
      UPDATE square_existing_clients
      SET
        gift_card_id = ${result.giftCardId},
        gift_card_order_id = ${orderId},
        gift_card_line_item_uid = ${lineItemUid},
        gift_card_delivery_channel = ${result.activationChannel},
        gift_card_activation_url = ${result.activationUrl},
        gift_card_pass_kit_url = ${result.passKitUrl},
        gift_card_digital_email = ${result.digitalEmail},
        got_signup_bonus = TRUE,
        updated_at = NOW()
      WHERE square_customer_id = ${customerId}
    `

    const qrDataUri = await generateQr(result.giftCardGan)

    await sendGiftCardIssuedEmail(
      customerName,
      customer.email_address || result.digitalEmail,
      {
        giftCardGan: result.giftCardGan,
        amountCents: result.amountCents,
        balanceCents: result.balanceCents,
        activationUrl: result.activationUrl,
        passKitUrl: result.passKitUrl,
        qrDataUri
      }
    )

    console.log('📧 Gift card email dispatched (or logged if sending disabled).')
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    if (error.errors) {
      console.error(JSON.stringify(error.errors, null, 2))
    }
  } finally {
    await prisma.$disconnect()
  }
}

main()


