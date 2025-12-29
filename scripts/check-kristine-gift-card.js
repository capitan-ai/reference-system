#!/usr/bin/env node
/**
 * Check gift card information for Kristine
 * Specifically checks QR code format and GAN validity
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const QRCode = require('qrcode')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const giftCardsApi = squareClient.giftCardsApi

async function checkKristineGiftCard() {
  console.log('🔍 Checking Gift Card for Kristine\n')
  console.log('='.repeat(60))
  
  try {
    // Find Kristine in database
    console.log('\n📋 Step 1: Finding Kristine in database...')
    const customers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        gift_card_id,
        gift_card_gan,
        got_signup_bonus,
        used_referral_code,
        first_payment_completed,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE 
        LOWER(given_name) LIKE '%kristine%'
        OR LOWER(family_name) LIKE '%kristine%'
        OR LOWER(email_address) LIKE '%kristine%'
      ORDER BY created_at DESC
      LIMIT 10
    `
    
    if (!customers || customers.length === 0) {
      console.log('   ❌ No customers found with name containing "Kristine"')
      return
    }
    
    console.log(`   ✅ Found ${customers.length} customer(s) matching "Kristine":\n`)
    
    for (const customer of customers) {
      console.log(`\n${'='.repeat(60)}`)
      console.log(`👤 Customer: ${customer.given_name || ''} ${customer.family_name || ''}`)
      console.log(`   Email: ${customer.email_address || 'None'}`)
      console.log(`   Square ID: ${customer.square_customer_id}`)
      console.log(`   Gift Card ID: ${customer.gift_card_id || 'None'}`)
      console.log(`   Gift Card GAN (from DB): ${customer.gift_card_gan || 'None'}`)
      console.log(`   Created: ${customer.created_at}`)
      console.log(`   Updated: ${customer.updated_at}`)
      
      if (!customer.gift_card_id) {
        console.log('\n   ⚠️ No gift card ID found in database')
        continue
      }
      
      // Get gift card from Square
      console.log('\n📋 Step 2: Fetching gift card from Square...')
      try {
        const giftCardResponse = await giftCardsApi.retrieveGiftCard(customer.gift_card_id)
        const giftCard = giftCardResponse.result.giftCard
        
        if (!giftCard) {
          console.log('   ❌ Gift card not found in Square')
          continue
        }
        
        console.log('   ✅ Gift Card Details:')
        console.log(`      - ID: ${giftCard.id}`)
        console.log(`      - Type: ${giftCard.type}`)
        console.log(`      - State: ${giftCard.state}`)
        console.log(`      - Balance: $${(giftCard.balanceMoney?.amount || 0) / 100}`)
        
        const squareGan = giftCard.gan
        const dbGan = customer.gift_card_gan
        
        console.log(`      - GAN (from Square): ${squareGan || 'None'}`)
        console.log(`      - GAN (from DB): ${dbGan || 'None'}`)
        
        if (squareGan && dbGan && squareGan !== dbGan) {
          console.log(`      ⚠️ GAN MISMATCH! Square: ${squareGan}, DB: ${dbGan}`)
        }
        
        // Validate GAN format
        console.log('\n📋 Step 3: Validating GAN format...')
        const ganToCheck = squareGan || dbGan
        if (!ganToCheck) {
          console.log('   ❌ No GAN available for validation')
          continue
        }
        
        const cleanGan = ganToCheck.toString().trim().replace(/\D/g, '')
        console.log(`   - Original GAN: ${ganToCheck}`)
        console.log(`   - Cleaned GAN: ${cleanGan}`)
        console.log(`   - Length: ${cleanGan.length} digits`)
        
        if (cleanGan.length < 10 || cleanGan.length > 16) {
          console.log(`   ❌ INVALID GAN FORMAT! Length should be 10-16 digits, got ${cleanGan.length}`)
        } else {
          console.log(`   ✅ GAN format is valid (${cleanGan.length} digits)`)
        }
        
        // Check gift card state
        console.log('\n📋 Step 4: Checking gift card state...')
        if (giftCard.state !== 'ACTIVE' && giftCard.state !== 'PENDING') {
          console.log(`   ⚠️ WARNING: Gift card state is ${giftCard.state}`)
          console.log(`   QR code may not work until card is ACTIVE`)
        } else {
          console.log(`   ✅ Gift card state is ${giftCard.state} (OK for QR code)`)
        }
        
        // Generate QR code and test
        console.log('\n📋 Step 5: Testing QR code generation...')
        if (cleanGan && cleanGan.length >= 10 && cleanGan.length <= 16) {
          const qrData = `sqgc://${cleanGan}`
          console.log(`   QR Data String: ${qrData}`)
          console.log(`   QR Data Length: ${qrData.length} characters`)
          
          // Test with different configurations
          const configs = [
            { name: 'High Quality', margin: 4, scale: 8, errorCorrectionLevel: 'H', width: 400 },
            { name: 'Medium Quality', margin: 3, scale: 6, errorCorrectionLevel: 'M', width: 300 },
            { name: 'Standard Quality', margin: 2, scale: 5, errorCorrectionLevel: 'M', width: 250 }
          ]
          
          for (const config of configs) {
            try {
              console.log(`\n   Testing ${config.name} configuration...`)
              const qrDataUri = await QRCode.toDataURL(qrData, config)
              
              if (qrDataUri && qrDataUri.startsWith('data:image')) {
                const sizeKB = (qrDataUri.length / 1024).toFixed(2)
                console.log(`      ✅ QR code generated successfully`)
                console.log(`      Size: ${sizeKB} KB`)
                console.log(`      Format: data:image/png;base64,...`)
                
                // Check if QR code is readable (basic validation)
                if (qrDataUri.length > 1000) {
                  console.log(`      ✅ QR code size looks good (${sizeKB} KB)`)
                } else {
                  console.log(`      ⚠️ QR code seems too small (${sizeKB} KB)`)
                }
              } else {
                console.log(`      ❌ QR code generation returned invalid data`)
              }
            } catch (qrError) {
              console.log(`      ❌ Failed to generate QR code: ${qrError.message}`)
            }
          }
          
          // Validate QR data format
          console.log(`\n   📋 QR Code Format Validation:`)
          if (qrData.startsWith('sqgc://')) {
            console.log(`      ✅ Correct prefix: sqgc://`)
          } else {
            console.log(`      ❌ Wrong prefix! Expected: sqgc://`)
          }
          
          const ganInQr = qrData.replace('sqgc://', '')
          if (ganInQr === cleanGan) {
            console.log(`      ✅ GAN in QR matches cleaned GAN`)
          } else {
            console.log(`      ❌ GAN mismatch! QR: ${ganInQr}, Cleaned: ${cleanGan}`)
          }
          
          if (ganInQr.length >= 10 && ganInQr.length <= 16) {
            console.log(`      ✅ GAN length is valid (${ganInQr.length} digits)`)
          } else {
            console.log(`      ❌ GAN length is invalid (${ganInQr.length} digits, should be 10-16)`)
          }
          
        } else {
          console.log(`   ❌ Cannot generate QR code - invalid GAN format`)
        }
        
        // Summary
        console.log('\n📋 Summary:')
        const issues = []
        if (!squareGan) issues.push('No GAN in Square')
        if (squareGan && dbGan && squareGan !== dbGan) issues.push('GAN mismatch between Square and DB')
        if (cleanGan && (cleanGan.length < 10 || cleanGan.length > 16)) issues.push('Invalid GAN format')
        if (giftCard.state !== 'ACTIVE' && giftCard.state !== 'PENDING') issues.push(`Gift card state is ${giftCard.state}`)
        
        if (issues.length > 0) {
          console.log(`   ⚠️ Issues found:`)
          issues.forEach(issue => console.log(`      - ${issue}`))
        } else {
          console.log(`   ✅ No issues found - QR code should work!`)
        }
        
      } catch (error) {
        console.log(`   ❌ Error fetching gift card: ${error.message}`)
        if (error.errors) {
          console.log(`   Square API Errors:`, JSON.stringify(error.errors, null, 2))
        }
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('✅ Check complete!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkKristineGiftCard()

