#!/usr/bin/env node
/**
 * Send referral code email and $10 gift card email to Iana Zorina / yanaa.zorinaa@gmail.com
 */

require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const { sendReferralCodeEmail, sendGiftCardIssuedEmail } = require('../lib/email-service-simple')
const { generateReferralUrl } = require('../lib/utils/referral-url')
const QRCode = require('qrcode')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const giftCardsApi = squareClient.giftCardsApi

const SEARCH_EMAIL = 'yanaa.zorinaa@gmail.com'
const SEARCH_NAME = 'Iana Zorina'

// Generate QR code for gift card (Square format: sqgc://GAN)
async function generateQRCode(gan) {
  try {
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

async function findAndSendYanaEmails() {
  try {
    console.log('🔍 Searching for customer in database...')
    console.log(`   Email: ${SEARCH_EMAIL}`)
    console.log(`   Name: ${SEARCH_NAME}\n`)
    
    // Try to find by email first
    let customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        personal_code,
        referral_url,
        referral_email_sent,
        gift_card_id,
        gift_card_gan
      FROM square_existing_clients
      WHERE LOWER(email_address) = LOWER(${SEARCH_EMAIL})
      LIMIT 1
    `
    
    // If not found by email, try by name
    if (!customer || customer.length === 0) {
      console.log('⚠️  Not found by email, trying by name...')
      customer = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          phone_number,
          personal_code,
          referral_url,
          referral_email_sent,
          gift_card_id,
          gift_card_gan
        FROM square_existing_clients
        WHERE LOWER(given_name) LIKE LOWER(${'%Iana%'})
           OR LOWER(family_name) LIKE LOWER(${'%Zorina%'})
           OR LOWER(CONCAT(given_name, ' ', family_name)) LIKE LOWER(${'%Iana Zorina%'})
        LIMIT 5
      `
      
      if (customer && customer.length > 0) {
        console.log(`\n📋 Found ${customer.length} customer(s) with similar name:`)
        customer.forEach((c, idx) => {
          console.log(`\n${idx + 1}. ${c.given_name || ''} ${c.family_name || ''}`)
          console.log(`   Email: ${c.email_address || 'N/A'}`)
          console.log(`   Square Customer ID: ${c.square_customer_id}`)
          console.log(`   Referral Code: ${c.personal_code || 'N/A'}`)
        })
        
        // Use the first match
        if (customer.length === 1) {
          customer = [customer[0]]
          console.log('\n✅ Using the first match')
        } else {
          console.log('\n⚠️  Multiple matches found. Using the first match.')
          customer = [customer[0]]
        }
      }
    }
    
    if (!customer || customer.length === 0) {
      console.error('❌ Customer not found in database!')
      console.log('\n💡 Searched for:')
      console.log(`   Email: ${SEARCH_EMAIL}`)
      console.log(`   Name: ${SEARCH_NAME}`)
      return
    }
    
    const customerData = customer[0]
    const customerName = `${customerData.given_name || ''} ${customerData.family_name || ''}`.trim() || 'Unknown'
    const email = customerData.email_address || SEARCH_EMAIL
    const referralCode = customerData.personal_code
    const referralUrl = customerData.referral_url || (referralCode ? generateReferralUrl(referralCode) : null)
    const customerId = customerData.square_customer_id
    let giftCardId = customerData.gift_card_id
    let giftCardGan = customerData.gift_card_gan
    
    console.log(`\n✅ Customer Found!`)
    console.log(`\n📋 Customer Information:`)
    console.log(`   Name: ${customerName}`)
    console.log(`   Email: ${email}`)
    console.log(`   Square Customer ID: ${customerId}`)
    console.log(`   Phone: ${customerData.phone_number || 'N/A'}`)
    console.log(`   Referral Code: ${referralCode || '❌ NOT FOUND'}`)
    console.log(`   Referral URL: ${referralUrl || '❌ NOT FOUND'}`)
    console.log(`   Gift Card ID (from square_existing_clients): ${giftCardId || '❌ NOT FOUND'}`)
    console.log(`   Gift Card GAN (from square_existing_clients): ${giftCardGan || '❌ NOT FOUND'}`)
    
    // Check other tables for gift card data
    if (!giftCardId && !giftCardGan) {
      console.log(`\n🔍 Checking other tables for gift card data...`)
      
      // Check gift_cards table
      try {
        const giftCards = await prisma.$queryRaw`
          SELECT square_gift_card_id, gift_card_gan, reward_type, current_balance_cents
          FROM gift_cards
          WHERE square_customer_id = ${customerId}
          ORDER BY created_at DESC
          LIMIT 5
        `
        
        if (giftCards && giftCards.length > 0) {
          console.log(`   ✅ Found ${giftCards.length} gift card(s) in gift_cards table:`)
          giftCards.forEach((gc, idx) => {
            console.log(`      ${idx + 1}. ID: ${gc.square_gift_card_id}, GAN: ${gc.gift_card_gan || 'N/A'}, Type: ${gc.reward_type}, Balance: $${((gc.current_balance_cents || 0) / 100).toFixed(2)}`)
          })
          // Use the first gift card
          if (!giftCardId) giftCardId = giftCards[0].square_gift_card_id
          if (!giftCardGan) giftCardGan = giftCards[0].gift_card_gan
        }
      } catch (err) {
        console.log(`   ⚠️  Could not check gift_cards table: ${err.message}`)
      }
      
      // Check device_pass_registrations table
      try {
        const devicePasses = await prisma.$queryRaw`
          SELECT "giftCardId", "giftCardGan", "balanceCents"
          FROM device_pass_registrations
          WHERE "squareCustomerId" = ${customerId}
          ORDER BY "updatedAt" DESC
          LIMIT 5
        `
        
        if (devicePasses && devicePasses.length > 0) {
          console.log(`   ✅ Found ${devicePasses.length} device pass registration(s):`)
          devicePasses.forEach((dp, idx) => {
            console.log(`      ${idx + 1}. ID: ${dp.giftCardId || 'N/A'}, GAN: ${dp.giftCardGan || 'N/A'}, Balance: $${((dp.balanceCents || 0) / 100).toFixed(2)}`)
          })
          // Use the first one if we still don't have data
          if (!giftCardId) giftCardId = devicePasses[0].giftCardId
          if (!giftCardGan) giftCardGan = devicePasses[0].giftCardGan
        }
      } catch (err) {
        console.log(`   ⚠️  Could not check device_pass_registrations table: ${err.message}`)
      }
      
      // Check square_gift_card_gan_audit table
      try {
        const ganAudit = await prisma.$queryRaw`
          SELECT gift_card_id, resolved_gan
          FROM square_gift_card_gan_audit
          WHERE square_customer_id = ${customerId}
          ORDER BY verified_at DESC
          LIMIT 5
        `
        
        if (ganAudit && ganAudit.length > 0) {
          console.log(`   ✅ Found ${ganAudit.length} entry/entries in gan_audit table:`)
          ganAudit.forEach((ga, idx) => {
            console.log(`      ${idx + 1}. ID: ${ga.gift_card_id}, GAN: ${ga.resolved_gan || 'N/A'}`)
          })
          // Use the first one if we still don't have data
          if (!giftCardId) giftCardId = ganAudit[0].gift_card_id
          if (!giftCardGan) giftCardGan = ganAudit[0].resolved_gan
        }
      } catch (err) {
        console.log(`   ⚠️  Could not check square_gift_card_gan_audit table: ${err.message}`)
      }
      
      // Check payment_tenders for gift card usage
      try {
        const paymentTenders = await prisma.$queryRaw`
          SELECT pt.gift_card_id, pt.gift_card_gan
          FROM payment_tenders pt
          INNER JOIN payments p ON pt.payment_id = p.id
          WHERE p.customer_id = ${customerId}
            AND pt.type = 'SQUARE_GIFT_CARD'
            AND (pt.gift_card_id IS NOT NULL OR pt.gift_card_gan IS NOT NULL)
          ORDER BY pt.created_at DESC
          LIMIT 5
        `
        
        if (paymentTenders && paymentTenders.length > 0) {
          console.log(`   ✅ Found ${paymentTenders.length} gift card payment(s):`)
          paymentTenders.forEach((pt, idx) => {
            console.log(`      ${idx + 1}. ID: ${pt.gift_card_id || 'N/A'}, GAN: ${pt.gift_card_gan || 'N/A'}`)
          })
          // Use the first one if we still don't have data
          if (!giftCardId) giftCardId = paymentTenders[0].gift_card_id
          if (!giftCardGan) giftCardGan = paymentTenders[0].gift_card_gan
        }
      } catch (err) {
        console.log(`   ⚠️  Could not check payment_tenders table: ${err.message}`)
      }
    }
    
    console.log(`\n📋 Final Gift Card Information:`)
    console.log(`   Gift Card ID: ${giftCardId || '❌ NOT FOUND'}`)
    console.log(`   Gift Card GAN: ${giftCardGan || '❌ NOT FOUND'}`)
    console.log(`   Referral Email Sent: ${customerData.referral_email_sent ? '✅ YES' : '❌ NO'}`)
    console.log(`   From Email: ${process.env.FROM_EMAIL || 'info@studiozorina.com (default)'}`)
    
    // ============================================
    // PART 1: Send Referral Code Email
    // ============================================
    if (referralCode && referralUrl) {
      console.log(`\n${'='.repeat(60)}`)
      console.log('📧 PART 1: Sending Referral Code Email')
      console.log('='.repeat(60))
      
      const emailResult = await sendReferralCodeEmail(
        customerName,
        email,
        referralCode,
        referralUrl,
        {
          customerId: customerId
        }
      )
      
      if (emailResult.success) {
        if (emailResult.skipped) {
          console.log(`⏸️ Referral email sending is disabled (skipped)`)
        } else {
          console.log(`✅ Referral code email sent successfully!`)
          console.log(`   Message ID: ${emailResult.messageId || 'N/A'}`)
          
          // Update database
          await prisma.$executeRaw`
            UPDATE square_existing_clients
            SET 
              referral_email_sent = TRUE,
              referral_url = ${referralUrl},
              updated_at = NOW()
            WHERE square_customer_id = ${customerId}
          `
          
          console.log(`✅ Database updated: referral_email_sent = TRUE`)
        }
      } else {
        console.error(`❌ Failed to send referral email: ${emailResult.error || 'Unknown error'}`)
        if (emailResult.reason) {
          console.error(`   Reason: ${emailResult.reason}`)
        }
      }
    } else {
      console.log(`\n⚠️  Skipping referral email - missing referral code or URL`)
    }
    
    // ============================================
    // PART 2: Send Gift Card Email
    // ============================================
    console.log(`\n${'='.repeat(60)}`)
    console.log('🎁 PART 2: Sending $10 Gift Card Email')
    console.log('='.repeat(60))
    
    if (!giftCardId && !giftCardGan) {
      console.error('❌ No gift card found for this customer!')
      console.log('   Cannot send gift card email without gift card ID or GAN.')
      return
    }
    
    // Get gift card details from Square API
    let finalGiftCardGan = giftCardGan
    let balanceCents = 1000 // Default $10
    let activationUrl = null
    let passKitUrl = null
    
    if (giftCardId) {
      console.log(`\n📋 Fetching gift card details from Square API...`)
      console.log(`   Gift Card ID: ${giftCardId}`)
      
      try {
        const giftCardResponse = await giftCardsApi.retrieveGiftCard(giftCardId)
        const giftCard = giftCardResponse.result?.giftCard
        
        if (giftCard) {
          const balanceAmount = giftCard.balanceMoney?.amount || 0
          balanceCents = typeof balanceAmount === 'bigint' ? Number(balanceAmount) : Number(balanceAmount)
          
          if (giftCard.gan) {
            finalGiftCardGan = giftCard.gan
          }
          
          if (giftCard.digitalDetails) {
            activationUrl = giftCard.digitalDetails.activationUrl || null
            passKitUrl = giftCard.digitalDetails.passKitUrl || null
          }
          
          console.log(`   ✅ Gift Card Found:`)
          console.log(`      - GAN: ${finalGiftCardGan || 'N/A'}`)
          console.log(`      - Balance: $${(balanceCents / 100).toFixed(2)}`)
          console.log(`      - State: ${giftCard.state}`)
        }
      } catch (squareError) {
        console.log(`   ⚠️ Error fetching from Square: ${squareError.message}`)
        console.log(`   Using database values...`)
        if (!finalGiftCardGan) {
          console.error(`   ❌ No GAN available! Cannot send gift card email.`)
          return
        }
      }
    } else if (finalGiftCardGan) {
      console.log(`\n⚠️  No gift card ID found, using GAN from database: ${finalGiftCardGan}`)
      console.log(`   Using default balance: $10.00`)
    }
    
    if (!finalGiftCardGan) {
      console.error('❌ Gift Card GAN is missing! Cannot send email.')
      return
    }
    
    // Generate QR code
    console.log(`\n📋 Generating QR code...`)
    const qrDataUri = await generateQRCode(finalGiftCardGan)
    if (qrDataUri) {
      console.log(`   ✅ QR code generated`)
    } else {
      console.log(`   ⚠️ QR code generation failed (will send email without QR code)`)
    }
    
    // Send gift card email
    console.log(`\n📧 Sending gift card email to ${email}...`)
    const giftCardEmailResult = await sendGiftCardIssuedEmail(
      customerName,
      email,
      {
        giftCardGan: finalGiftCardGan,
        amountCents: 1000, // $10
        balanceCents: balanceCents,
        activationUrl: activationUrl,
        passKitUrl: passKitUrl,
        qrDataUri: qrDataUri,
        isReminder: false
      },
      {
        customerId: customerId,
        metadata: {
          giftCardId: giftCardId,
          manualSend: true
        }
      }
    )
    
    if (giftCardEmailResult.success) {
      if (giftCardEmailResult.skipped) {
        console.log(`⏸️ Gift card email sending is disabled (skipped)`)
      } else {
        console.log(`✅ Gift card email sent successfully!`)
        console.log(`   Message ID: ${giftCardEmailResult.messageId || 'N/A'}`)
      }
    } else {
      console.error(`❌ Failed to send gift card email: ${giftCardEmailResult.error || 'Unknown error'}`)
      if (giftCardEmailResult.reason) {
        console.error(`   Reason: ${giftCardEmailResult.reason}`)
      }
    }
    
    // Summary
    console.log(`\n${'='.repeat(60)}`)
    console.log('✨ Summary')
    console.log('='.repeat(60))
    console.log(`   Customer: ${customerName}`)
    console.log(`   Email: ${email}`)
    console.log(`   From: ${process.env.FROM_EMAIL || 'info@studiozorina.com'}`)
    console.log(`   Referral Code: ${referralCode || 'N/A'}`)
    console.log(`   Gift Card GAN: ${finalGiftCardGan || 'N/A'}`)
    console.log(`   Gift Card Balance: $${(balanceCents / 100).toFixed(2)}`)
    console.log(`   Referral Email: ${referralCode ? '✅ Sent' : '❌ Skipped'}`)
    console.log(`   Gift Card Email: ${finalGiftCardGan ? '✅ Sent' : '❌ Skipped'}`)
    
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run
findAndSendYanaEmails()
  .then(() => {
    console.log('\n✨ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })

