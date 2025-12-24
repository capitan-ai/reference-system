// Test script to send gift card email with QR code and Apple Wallet pass
// Usage: node scripts/send-test-wallet-email.js [squareCustomerId] [testEmail]

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const QRCode = require('qrcode')
const nodemailer = require('nodemailer')
const { sendGiftCardIssuedEmail } = require('../lib/email-service-simple')

// Test email credentials (for testing only)
const TEST_EMAIL = 'rakhimbekova1112@gmail.com'
const TEST_EMAIL_PASSWORD = 'vwmfyatavrfjoozu'

const prisma = new PrismaClient()
const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const giftCardsApi = squareClient.giftCardsApi
const customersApi = squareClient.customersApi

async function findCustomerAndGiftCard(squareCustomerId) {
  console.log(`🔍 Looking for customer: ${squareCustomerId}`)
  
  // Try to get from Square API first
  let squareCustomer = null
  let giftCardId = null
  let giftCardGan = null
  let balanceCents = 0
  
  try {
    const customerResponse = await customersApi.retrieveCustomer(squareCustomerId)
    squareCustomer = customerResponse.result?.customer
    
    if (squareCustomer) {
      console.log(`✅ Found customer in Square:`)
      console.log(`   Name: ${squareCustomer.givenName || ''} ${squareCustomer.familyName || ''}`)
      console.log(`   Email: ${squareCustomer.emailAddress || 'N/A'}`)
      
      // Try to find gift card ID from custom attributes or notes
      if (squareCustomer.note) {
        // Look for gift card GAN in notes
        const ganMatch = squareCustomer.note.match(/GIFT_CARD[:\s]+([A-Z0-9]+)/i)
        if (ganMatch) {
          giftCardGan = ganMatch[1]
        }
      }
      
      // Check for gift card ID in custom attributes
      try {
        const customAttrsResponse = await customersApi.listCustomerCustomAttributes(squareCustomerId)
        const attrs = customAttrsResponse.result?.customAttributes || []
        for (const attr of attrs) {
          if (attr.customAttribute?.key?.includes('gift_card') || attr.customAttribute?.value) {
            const value = attr.customAttribute?.value
            if (typeof value === 'string' && value.startsWith('gftc:')) {
              giftCardId = value
            } else if (typeof value === 'string' && /^[A-Z0-9]+$/.test(value)) {
              giftCardGan = value
            }
          }
        }
      } catch (attrError) {
        console.warn(`⚠️ Could not fetch custom attributes: ${attrError.message}`)
      }
    }
  } catch (error) {
    console.warn(`⚠️ Could not fetch from Square API: ${error.message}`)
  }
  
  // Try database lookup
  try {
    const dbCustomer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, gift_card_id
      FROM square_existing_clients 
      WHERE square_customer_id = ${squareCustomerId}
      LIMIT 1
    `
    
    if (dbCustomer && dbCustomer.length > 0) {
      const cust = dbCustomer[0]
      console.log(`✅ Found customer in database:`)
      console.log(`   Name: ${cust.given_name || ''} ${cust.family_name || ''}`)
      console.log(`   Email: ${cust.email_address || 'N/A'}`)
      console.log(`   Gift Card ID: ${cust.gift_card_id || 'N/A'}`)
      
      if (cust.gift_card_id && !giftCardId) {
        giftCardId = cust.gift_card_id
      }
      
      // Update squareCustomer info if not found from API
      if (!squareCustomer) {
        squareCustomer = {
          givenName: cust.given_name,
          familyName: cust.family_name,
          emailAddress: cust.email_address
        }
      }
    }
  } catch (dbError) {
    console.warn(`⚠️ Database query error: ${dbError.message}`)
  }
  
  // Try GiftCardCache
  try {
    const giftCardCache = await prisma.giftCardCache.findFirst({
      where: {
        owner: {
          squareCustomerId: squareCustomerId
        }
      },
      include: {
        owner: true
      }
    })
    
    if (giftCardCache) {
      console.log(`✅ Found gift card in cache:`)
      console.log(`   Square Gift Card ID: ${giftCardCache.squareGiftCardId}`)
      console.log(`   Balance: $${(giftCardCache.lastBalanceCents / 100).toFixed(2)}`)
      
      if (!giftCardId) {
        giftCardId = giftCardCache.squareGiftCardId
      }
      balanceCents = giftCardCache.lastBalanceCents
    }
  } catch (cacheError) {
    console.warn(`⚠️ GiftCardCache query error: ${cacheError.message}`)
  }
  
  // Get current gift card info from Square
  if (giftCardId) {
    try {
      console.log(`🔍 Retrieving gift card from Square: ${giftCardId}`)
      const giftCardResponse = await giftCardsApi.retrieveGiftCard(giftCardId)
      const giftCard = giftCardResponse.result?.giftCard
      
      if (giftCard) {
        giftCardGan = giftCard.gan
        balanceCents = giftCard.balanceMoney?.amount || balanceCents
        console.log(`✅ Retrieved gift card from Square:`)
        console.log(`   GAN: ${giftCardGan}`)
        console.log(`   Balance: $${(balanceCents / 100).toFixed(2)}`)
      } else {
        console.warn(`⚠️ Gift card response was empty`)
      }
    } catch (gcError) {
      console.warn(`⚠️ Could not retrieve gift card: ${gcError.message}`)
      if (gcError.statusCode === 401) {
        console.error(`❌ Authentication error - check SQUARE_ACCESS_TOKEN in .env`)
      }
    }
  } else {
    console.warn(`⚠️ No gift card ID found - customer may not have a gift card yet`)
  }
  
  return {
    customer: squareCustomer,
    giftCardId,
    giftCardGan,
    balanceCents
  }
}

async function sendTestEmail() {
  const squareCustomerId = process.argv[2] || '70WNH5QYS71S32NG7Z77YW4DA8'
  const testEmail = process.argv[3] || process.env.BUSINESS_EMAIL || process.env.TEST_EMAIL
  
  if (!testEmail) {
    console.error('❌ No test email provided. Usage: node scripts/send-test-wallet-email.js [squareCustomerId] [testEmail]')
    process.exit(1)
  }
  
  console.log('🧪 Testing Gift Card Email with Apple Wallet')
  console.log(`   Customer ID: ${squareCustomerId}`)
  console.log(`   Test Email: ${testEmail}`)
  console.log('')
  
  try {
    // Find customer and gift card
    const { customer, giftCardId, giftCardGan, balanceCents } = await findCustomerAndGiftCard(squareCustomerId)
    
    if (!customer) {
      console.error('❌ Customer not found!')
      process.exit(1)
    }
    
    const customerName = `${customer.givenName || ''} ${customer.familyName || ''}`.trim() || 'Customer'
    
    console.log('')
    console.log('📧 Customer Information:')
    console.log(`   Name: ${customerName}`)
    console.log(`   Email: ${customer.emailAddress || 'N/A'}`)
    console.log(`   Gift Card GAN: ${giftCardGan || 'N/A'}`)
    console.log(`   Balance: $${(balanceCents / 100).toFixed(2)}`)
    console.log('')
    
    // If no GAN found but we have gift card ID, try to construct a test GAN
    // or use a placeholder for testing
    let finalGan = giftCardGan
    let finalBalance = balanceCents
    
    if (!finalGan && giftCardId) {
      console.warn('⚠️ GAN not found, but gift card ID exists.')
      console.warn('   Using gift card ID as fallback for testing.')
      // For testing, we can use a format that looks like a GAN
      // In production, this should come from Square API
      finalGan = giftCardId.replace('gftc:', '').toUpperCase().substring(0, 16) || 'TEST1234567890'
      console.log(`   Using test GAN: ${finalGan}`)
    }
    
    if (!finalGan) {
      console.error('❌ No gift card GAN found! Cannot generate QR code or Apple Wallet pass.')
      console.log('   Please ensure the customer has a gift card.')
      console.log('   Using test GAN for demonstration...')
      finalGan = 'TEST1234567890'
      finalBalance = finalBalance || 1000
    }
    
    if (finalBalance === 0) {
      console.warn('⚠️ Balance is $0.00, using $10.00 for test email')
      finalBalance = 1000
    }
    
    // Generate QR code
    console.log('📱 Generating QR code...')
    const qrDataUri = await QRCode.toDataURL(`sqgc://${finalGan}`, {
      margin: 1,
      scale: 4,
      errorCorrectionLevel: 'M'
    })
    console.log('✅ QR code generated')
    
    // Generate Apple Wallet pass URL
    const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
    const walletPassUrl = `${appBaseUrl}/api/wallet/pass/${finalGan}`
    console.log(`✅ Apple Wallet pass URL: ${walletPassUrl}`)
    console.log('')
    
    // Temporarily set test credentials for email sending
    const originalBusinessEmail = process.env.BUSINESS_EMAIL
    const originalGmailPassword = process.env.GMAIL_APP_PASSWORD
    
    process.env.BUSINESS_EMAIL = TEST_EMAIL
    process.env.GMAIL_APP_PASSWORD = TEST_EMAIL_PASSWORD
    
    // Send email
    console.log('📧 Sending test email...')
    const emailResult = await sendGiftCardIssuedEmail(
      customerName,
      testEmail,
      {
        giftCardGan: finalGan,
        amountCents: finalBalance,
        balanceCents: finalBalance,
        qrDataUri: qrDataUri,
        activationUrl: null,
        passKitUrl: null,
        isReminder: false
      }
    )
    
    // Restore original credentials
    if (originalBusinessEmail) process.env.BUSINESS_EMAIL = originalBusinessEmail
    if (originalGmailPassword) process.env.GMAIL_APP_PASSWORD = originalGmailPassword
    
    if (emailResult.success) {
      console.log('✅ Test email sent successfully!')
      console.log(`   Message ID: ${emailResult.messageId || 'N/A'}`)
      console.log(`   Sent from: ${TEST_EMAIL}`)
      console.log(`   Sent to: ${testEmail}`)
      console.log('')
      console.log('📱 Email includes:')
      console.log('   ✅ QR code for scanning')
      console.log('   ✅ Gift card number (GAN)')
      console.log('   ✅ Apple Wallet pass link')
      console.log('   ✅ Balance information')
    } else {
      console.error('❌ Failed to send email:', emailResult.error || emailResult.reason)
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

sendTestEmail()

