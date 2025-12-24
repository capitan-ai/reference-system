#!/usr/bin/env node
// Test gift card email for a specific customer
// Usage: node scripts/test-customer-giftcard-email.js [customerId] [email]

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const { sendGiftCardIssuedEmail } = require('../lib/email-service-simple')
const QRCode = require('qrcode')

const prisma = new PrismaClient()
const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const giftCardsApi = squareClient.giftCardsApi

async function testCustomerGiftCardEmail() {
  const customerId = process.argv[2] || '70WNH5QYS71S32NG7Z77YW4DA8'
  const testEmail = process.argv[3] || 'umit0912@icloud.com'
  
  console.log('🧪 Testing Gift Card Email for Customer')
  console.log('='.repeat(60))
  console.log(`   Customer ID: ${customerId}`)
  console.log(`   Test Email: ${testEmail}`)
  console.log('')
  
  try {
    // Find customer in database - try Customer model first
    console.log('📋 Looking up customer...')
    let customer = await prisma.customer.findUnique({
      where: { squareCustomerId: customerId },
      select: {
        squareCustomerId: true,
        firstName: true,
        lastName: true,
        fullName: true,
        email: true
      }
    })
    
    let customerName = 'Customer'
    let customerEmail = null
    let giftCardId = null
    
    if (customer) {
      customerName = customer.fullName || `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer'
      customerEmail = customer.email
      console.log(`   ✅ Found in Customer table: ${customerName}`)
      console.log(`   Email: ${customerEmail || 'N/A'}`)
    } else {
      // Try raw SQL query for square_existing_clients table
      console.log('   Looking in square_existing_clients table...')
      const rawCustomer = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, gift_card_id
        FROM square_existing_clients 
        WHERE square_customer_id = ${customerId}
        LIMIT 1
      `
      
      if (rawCustomer && rawCustomer.length > 0) {
        const cust = rawCustomer[0]
        customerName = `${cust.given_name || ''} ${cust.family_name || ''}`.trim() || 'Customer'
        customerEmail = cust.email_address
        giftCardId = cust.gift_card_id
        console.log(`   ✅ Found in square_existing_clients: ${customerName}`)
        console.log(`   Email: ${customerEmail || 'N/A'}`)
        console.log(`   Gift Card ID: ${giftCardId || 'N/A'}`)
      } else {
        console.error('❌ Customer not found in database')
        process.exit(1)
      }
    }
    
    console.log('')
    
    // Get gift card from Square
    let giftCard = null
    let gan = null
    let balanceCents = 0
    
    if (giftCardId) {
      try {
        console.log('💳 Fetching gift card from Square...')
        const response = await giftCardsApi.retrieveGiftCard(giftCardId)
        giftCard = response.result?.giftCard
        
        if (giftCard) {
          gan = giftCard.gan
          balanceCents = giftCard.balanceMoney?.amount || 0
          console.log(`   ✅ Gift Card GAN: ${gan}`)
          console.log(`   Balance: $${(balanceCents / 100).toFixed(2)}`)
        }
      } catch (squareError) {
        console.warn(`   ⚠️ Could not fetch from Square: ${squareError.message}`)
      }
    }
    
    // Try to find in GiftCardCache
    if (!gan) {
      console.log('🔍 Looking in GiftCardCache...')
      const cache = await prisma.giftCardCache.findFirst({
        where: {
          owner: {
            squareCustomerId: customerId
          }
        },
        include: {
          owner: true
        }
      })
      
      if (cache) {
        // squareGiftCardId might be the full ID, extract GAN if needed
        gan = cache.squareGiftCardId
        balanceCents = cache.lastBalanceCents || 0
        console.log(`   ✅ Found in cache: ${gan}`)
        console.log(`   Balance: $${(balanceCents / 100).toFixed(2)}`)
      }
    }
    
    // Try to get from square_existing_clients table
    if (!gan && !giftCardId) {
      console.log('🔍 Looking in square_existing_clients table...')
      const rawData = await prisma.$queryRaw`
        SELECT gift_card_id
        FROM square_existing_clients 
        WHERE square_customer_id = ${customerId}
        LIMIT 1
      `
      
      if (rawData && rawData.length > 0) {
        const data = rawData[0]
        giftCardId = data.gift_card_id
        if (giftCardId) {
          // Extract GAN from gift card ID (format: gftc:GAN...)
          // The GAN is usually the part after "gftc:" and before the next part
          if (giftCardId.includes(':')) {
            const parts = giftCardId.split(':')
            if (parts.length > 1) {
              // GAN might be in the second part, or we need to extract it
              // Common format: gftc:GAN or the GAN might be embedded
              const possibleGan = parts[1]?.substring(0, 16).toUpperCase() // First 16 chars, uppercase
              if (possibleGan && possibleGan.length >= 8) {
                gan = possibleGan
                console.log(`   ✅ Extracted GAN from gift card ID: ${gan}`)
              }
            }
          }
          
          // Try to get full details from Square
          if (!gan || balanceCents === 0) {
            try {
              console.log(`   Fetching gift card ${giftCardId} from Square...`)
              const response = await giftCardsApi.retrieveGiftCard(giftCardId)
              if (response.result?.giftCard) {
                gan = response.result.giftCard.gan
                balanceCents = response.result.giftCard.balanceMoney?.amount || 0
                console.log(`   ✅ Got GAN from Square: ${gan}`)
                console.log(`   Balance: $${(balanceCents / 100).toFixed(2)}`)
              }
            } catch (err) {
              console.warn(`   ⚠️ Could not fetch from Square: ${err.message}`)
              // If we have a partial GAN, use it
              if (gan) {
                console.log(`   Using extracted GAN: ${gan}`)
              }
            }
          }
        }
      }
    }
    
    if (!gan) {
      console.error('❌ Could not find gift card GAN')
      console.log('   Using test GAN: TEST1234567890')
      gan = 'TEST1234567890'
      balanceCents = 1000
    }
    
    console.log('')
    
    // Generate QR code
    let qrDataUri = null
    try {
      qrDataUri = await QRCode.toDataURL(gan)
      console.log('✅ QR code generated')
    } catch (qrError) {
      console.warn('⚠️ Could not generate QR code:', qrError.message)
    }
    
    // Build Apple Wallet URL - always use production domain
    const baseUrl = 'https://www.zorinastudio-referral.com'
    const walletUrl = `${baseUrl}/api/wallet/pass/${gan}`
    
    console.log(`   Apple Wallet URL: ${walletUrl}`)
    console.log('')
    
    // Send gift card email
    console.log('📧 Sending gift card email...')
    const result = await sendGiftCardIssuedEmail(customerName, testEmail, {
      giftCardGan: gan,
      amountCents: balanceCents || 1000,
      balanceCents: balanceCents || 1000,
      qrDataUri: qrDataUri,
      activationUrl: null,
      passKitUrl: null,
      isReminder: false
    })
    
    console.log('')
    if (result.success) {
      if (result.skipped) {
        console.log('⏸️ Email sending skipped:', result.reason)
      } else {
        console.log('✅ Gift card email sent successfully!')
        console.log(`   Message ID: ${result.messageId}`)
        console.log('')
        console.log('📱 Check your inbox!')
        console.log(`   Email sent to: ${testEmail}`)
        console.log(`   The email includes an "Add to Apple Wallet" button`)
        console.log(`   Click it to add the pass to your iPhone Wallet`)
      }
    } else {
      console.error('❌ Failed to send email:', result.error)
    }
    
    console.log('')
    console.log('📋 Email Details:')
    console.log(`   Customer: ${customerName}`)
    console.log(`   GAN: ${gan}`)
    console.log(`   Balance: $${((balanceCents || 1000) / 100).toFixed(2)}`)
    console.log(`   Subject: 🎁 $${((balanceCents || 1000) / 100).toFixed(2)} gift card from Zorina Nail Studio`)
    console.log(`   Wallet URL: ${walletUrl}`)
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

testCustomerGiftCardEmail()

