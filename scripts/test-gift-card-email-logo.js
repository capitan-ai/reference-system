#!/usr/bin/env node

// Test script to send gift card email with real customer data
const path = require('path')
const fs = require('fs')

const envLocalPath = path.join(__dirname, '..', '.env.local')
const envPath = path.join(__dirname, '..', '.env')

if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath })
} else {
require('dotenv').config()
}
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath, override: false })
}

const nodemailer = require('nodemailer')
const QRCode = require('qrcode')
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const { buildGiftCardEmailPreview } = require('../lib/email-service-simple')

const prisma = new PrismaClient()

// Test email credentials
const TEST_EMAIL = 'rakhimbekova1112@gmail.com'
const TEST_EMAIL_PASSWORD = 'vwmfyatavrfjoozu'

const squareCustomerId = process.argv[2] || '70WNH5QYS71S32NG7Z77YW4DA8'
const recipientEmail = process.argv[3] || 'umit0912@icloud.com'
const amountCentsArg = Number.parseInt(process.argv[4], 10)
const amountCentsOverride = Number.isFinite(amountCentsArg) ? amountCentsArg : null

const formatUsd = (amountCents) => {
  if (!Number.isFinite(amountCents)) return '$0.00'
  return `$${(amountCents / 100).toFixed(2)}`
}

const productionBaseUrl = 'https://www.zorinastudio-referral.com'
const squareAccessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
const squareClient = squareAccessToken
  ? new Client({ accessToken: squareAccessToken, environment: Environment.Production })
  : null

async function fetchCustomer(squareId) {
  const rows = await prisma.$queryRaw`
    SELECT
      given_name,
      family_name,
      email_address,
      gift_card_id,
      gift_card_gan,
      gift_card_activation_url,
      gift_card_pass_kit_url,
      gift_card_digital_email
    FROM square_existing_clients
    WHERE square_customer_id = ${squareId}
    LIMIT 1
  `
  return rows[0] || null
}

async function fetchSquareCard(giftCardId) {
  if (!giftCardId || !squareClient) return null
  try {
    const response = await squareClient.giftCardsApi.retrieveGiftCard(giftCardId)
    return response.result?.giftCard || null
  } catch (error) {
    console.warn(`⚠️ Failed to retrieve gift card ${giftCardId} from Square: ${error.message}`)
    return null
  }
}

async function testGiftCardEmail() {
  try {
    console.log('🎁 Testing Gift Card Email with updated GAN + badge')
    console.log('='.repeat(60))
    console.log(`📧 From (TEST): ${TEST_EMAIL}`)
    console.log(`📧 To: ${recipientEmail}`)
    console.log(`🆔 Square customer ID: ${squareCustomerId}`)
    console.log('')
    
    const customerRecord = await fetchCustomer(squareCustomerId)
    if (!customerRecord) {
      throw new Error(`Customer ${squareCustomerId} not found in square_existing_clients`)
    }

    const squareCard = customerRecord.gift_card_id
      ? await fetchSquareCard(customerRecord.gift_card_id)
      : null

    let finalGan =
      customerRecord.gift_card_gan ||
      squareCard?.gan ||
      (customerRecord.gift_card_id?.startsWith('gftc:')
        ? squareCard?.gan
        : customerRecord.gift_card_id) ||
      null

    if (!finalGan) {
      throw new Error('Gift card GAN not available for this customer')
    }

    const finalBalanceCents =
      amountCentsOverride ??
      (squareCard?.balanceMoney?.amount
        ? Number(squareCard.balanceMoney.amount)
        : 1000)

    const activationUrl =
      customerRecord.gift_card_activation_url ||
      squareCard?.digitalDetails?.activationUrl ||
      `${productionBaseUrl}/wallet/digital/${finalGan}`

    const passKitUrl =
      customerRecord.gift_card_pass_kit_url ||
      squareCard?.digitalDetails?.passKitUrl ||
      `${productionBaseUrl}/api/wallet/pass/${finalGan}`

    const customerName = `${customerRecord.given_name || ''} ${customerRecord.family_name || ''}`.trim() ||
      customerRecord.email_address ||
      'Valued Customer'

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: TEST_EMAIL,
        pass: TEST_EMAIL_PASSWORD
      }
    })
    
    console.log('📱 Generating QR code for gift card...')
    const qrDataUri = await QRCode.toDataURL(`sqgc://${finalGan}`, {
      margin: 1,
      scale: 4,
      errorCorrectionLevel: 'M'
    })
    console.log('✅ QR code generated')
    console.log('')
    
    const template = buildGiftCardEmailPreview({
      customerName,
      giftCardGan: finalGan,
      amountCents: finalBalanceCents,
      balanceCents: finalBalanceCents,
      qrDataUri,
      activationUrl,
      passKitUrl
    })
    
    console.log('📦 Email Content:')
    console.log(`   - Customer: ${customerName}`)
    console.log(`   - Gift Card GAN: ${finalGan}`)
    console.log(`   - Amount: ${formatUsd(finalBalanceCents)}`)
    console.log(`   - Activation URL: ${activationUrl}`)
    console.log(`   - Apple Wallet: ${passKitUrl}`)
    console.log('')
    
    console.log('📤 Sending email...')
    const result = await transporter.sendMail({
      from: TEST_EMAIL,
      to: recipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text
    })
    
    console.log('✅ Test gift card email sent successfully!')
    console.log(`   Message ID: ${result.messageId}`)
    console.log(`\n📬 Check your inbox at ${recipientEmail}`)
    console.log('\n📋 Email includes:')
    console.log('   ✅ Large Logo (350px × 600px)')
    console.log('   ✅ QR Code (most important)')
    console.log(`   ✅ Gift Card Number (GAN: ${finalGan})`)
    console.log('   ✅ Activation URL button')
    console.log('   ✅ Apple Wallet badge (custom pass)')
    
    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error sending test email:', error.message)
    if (error.message.includes('Invalid login') || error.message.includes('credentials')) {
      console.error('\n💡 Make sure:')
      console.error('   1. The email is a valid Gmail address')
      console.error('   2. The password is a Gmail App Password (16 characters, no spaces)')
      console.error('   3. 2-Factor Authentication is enabled')
    }
    await prisma.$disconnect()
    process.exit(1)
  }
}

testGiftCardEmail()

