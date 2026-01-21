#!/usr/bin/env node
/**
 * Send gift card email to Natalia and test email
 */

require('dotenv').config()

// SendGrid API key must be set via environment variable
if (!process.env.SENDGRID_API_KEY) {
  console.error('❌ SENDGRID_API_KEY environment variable is required')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const { sendGiftCardIssuedEmail } = require('../lib/email-service-simple')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const giftCardsApi = squareClient.giftCardsApi

const CUSTOMER_ID = '5Q1A2BG073YPWP8G6H0FGQE9VG'
const GIFT_CARD_ID = 'gftc:469e17f9f6f04d649ca31a668fbb23d0'
const TEST_EMAIL = process.env.TEST_EMAIL || 'umit0912@icloud.com' // Change this to your test email

// Generate QR code for gift card (Square format: sqgc://GAN)
async function generateQRCode(gan) {
  try {
    const QRCode = require('qrcode')
    // Clean GAN (only digits)
    const cleanGan = gan.toString().trim().replace(/\D/g, '')
    if (!cleanGan || cleanGan.length < 10) {
      console.warn(`⚠️ Invalid GAN format: ${gan}`)
      return null
    }
    
    // Square gift card QR code format: sqgc://GAN
    const qrData = `sqgc://${cleanGan}`
    const qrDataUri = await QRCode.toDataURL(qrData, {
      margin: 4,
      scale: 8,
      errorCorrectionLevel: 'H',
      width: 400
    })
    return qrDataUri
  } catch (error) {
    console.error(`❌ Error generating QR code:`, error.message)
    // Try fallback with simpler settings
    try {
      const QRCode = require('qrcode')
      const cleanGan = gan.toString().trim().replace(/\D/g, '')
      const qrData = `sqgc://${cleanGan}`
      return await QRCode.toDataURL(qrData, {
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

async function sendGiftCardEmail() {
  console.log('📧 Sending Gift Card Email to Natalia')
  console.log('='.repeat(60))
  console.log(`Customer ID: ${CUSTOMER_ID}`)
  console.log(`Gift Card ID: ${GIFT_CARD_ID}`)
  console.log(`Test Email: ${TEST_EMAIL}`)
  console.log('')

  try {
    // Step 1: Get customer from database
    console.log('📋 Step 1: Getting customer data from database...')
    const dbCustomer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address,
             gift_card_id, gift_card_gan, gift_card_order_id,
             gift_card_delivery_channel, gift_card_activation_url,
             gift_card_pass_kit_url, gift_card_digital_email
      FROM square_existing_clients 
      WHERE square_customer_id = ${CUSTOMER_ID}
    `

    if (!dbCustomer || dbCustomer.length === 0) {
      console.log('❌ Customer not found in database')
      return
    }

    const customer = dbCustomer[0]
    const customerEmail = customer.email_address || customer.gift_card_digital_email
    const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Valued Customer'
    
    console.log(`   ✅ Customer: ${customerName}`)
    console.log(`   - Email: ${customerEmail || 'None'}`)
    console.log(`   - Gift Card GAN: ${customer.gift_card_gan || 'None'}`)
    console.log('')

    // Step 2: Get gift card details from Square API
    console.log('📋 Step 2: Getting gift card details from Square API...')
    let giftCardGan = customer.gift_card_gan
    let balanceCents = 1000 // Default $10
    let activationUrl = customer.gift_card_activation_url || null
    let passKitUrl = customer.gift_card_pass_kit_url || null

    try {
      const giftCardResponse = await giftCardsApi.retrieveGiftCard(GIFT_CARD_ID)
      const giftCard = giftCardResponse.result.giftCard

      if (giftCard) {
        const balanceAmount = giftCard.balanceMoney?.amount || 0
        balanceCents = typeof balanceAmount === 'bigint' ? Number(balanceAmount) : balanceAmount

        if (giftCard.gan && giftCard.gan !== giftCardGan) {
          giftCardGan = giftCard.gan
        }

        if (giftCard.digitalDetails) {
          activationUrl = giftCard.digitalDetails.activationUrl || activationUrl
          passKitUrl = giftCard.digitalDetails.passKitUrl || passKitUrl
        }

        console.log(`   ✅ Gift Card Found:`)
        console.log(`      - GAN: ${giftCardGan}`)
        console.log(`      - Balance: $${(balanceCents / 100).toFixed(2)}`)
        console.log(`      - State: ${giftCard.state}`)
        if (activationUrl) {
          console.log(`      - Activation URL: ${activationUrl}`)
        }
        if (passKitUrl) {
          console.log(`      - PassKit URL: ${passKitUrl}`)
        }
        console.log('')
      }
    } catch (squareError) {
      console.log(`   ⚠️ Error fetching from Square: ${squareError.message}`)
      console.log(`   Using database values...`)
      console.log('')
    }

    if (!giftCardGan) {
      console.log('❌ Gift Card GAN is missing! Cannot send email.')
      return
    }

    // Step 3: Generate QR code
    console.log('📋 Step 3: Generating QR code...')
    const qrDataUri = await generateQRCode(giftCardGan)
    if (qrDataUri) {
      console.log(`   ✅ QR code generated`)
    } else {
      console.log(`   ⚠️ QR code generation failed (will send email without QR code)`)
    }
    console.log('')

    // Step 4: Send email to Natalia
    console.log('📋 Step 4: Sending email to Natalia...')
    if (!customerEmail) {
      console.log('   ❌ No email address found for customer')
    } else {
      try {
        const emailResult = await sendGiftCardIssuedEmail(
          customerName,
          customerEmail,
          {
            giftCardGan: giftCardGan,
            amountCents: 1000, // $10
            balanceCents: balanceCents,
            activationUrl: activationUrl,
            passKitUrl: passKitUrl,
            qrDataUri: qrDataUri,
            isReminder: false
          },
          {
            metadata: {
              customerId: CUSTOMER_ID,
              giftCardId: GIFT_CARD_ID,
              manualSend: true
            }
          }
        )

        if (emailResult.success) {
          console.log(`   ✅ Email sent successfully to ${customerEmail}`)
          console.log(`   - Message ID: ${emailResult.messageId || 'N/A'}`)
        } else if (emailResult.skipped) {
          console.log(`   ⚠️ Email skipped: ${emailResult.reason || 'Unknown reason'}`)
        } else {
          console.log(`   ❌ Email sending failed: ${emailResult.error || 'Unknown error'}`)
        }
      } catch (emailError) {
        console.log(`   ❌ Error sending email: ${emailError.message}`)
        console.error(emailError.stack)
      }
    }
    console.log('')

    // Step 5: Send copy to test email
    console.log('📋 Step 5: Sending copy to test email...')
    try {
      const testEmailResult = await sendGiftCardIssuedEmail(
        `[TEST COPY] ${customerName}`,
        TEST_EMAIL,
        {
          giftCardGan: giftCardGan,
          amountCents: 1000, // $10
          balanceCents: balanceCents,
          activationUrl: activationUrl,
          passKitUrl: passKitUrl,
          qrDataUri: qrDataUri,
          isReminder: false
        },
        {
          metadata: {
            customerId: CUSTOMER_ID,
            giftCardId: GIFT_CARD_ID,
            manualSend: true,
            testCopy: true
          }
        }
      )

      if (testEmailResult.success) {
        console.log(`   ✅ Test email sent successfully to ${TEST_EMAIL}`)
        console.log(`   - Message ID: ${testEmailResult.messageId || 'N/A'}`)
      } else if (testEmailResult.skipped) {
        console.log(`   ⚠️ Test email skipped: ${testEmailResult.reason || 'Unknown reason'}`)
      } else {
        console.log(`   ❌ Test email sending failed: ${testEmailResult.error || 'Unknown error'}`)
      }
    } catch (testEmailError) {
      console.log(`   ❌ Error sending test email: ${testEmailError.message}`)
      console.error(testEmailError.stack)
    }
    console.log('')

    console.log('✅ Gift card email sending complete!')
    console.log('')
    console.log('📋 Summary:')
    console.log(`   - Customer: ${customerName}`)
    console.log(`   - Customer Email: ${customerEmail || 'None'}`)
    console.log(`   - Test Email: ${TEST_EMAIL}`)
    console.log(`   - Gift Card GAN: ${giftCardGan}`)
    console.log(`   - Gift Card Balance: $${(balanceCents / 100).toFixed(2)}`)

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

sendGiftCardEmail()

