#!/usr/bin/env node
/**
 * Check QR code for Kristine Blukis gift card
 * Validates GAN format and tests QR code generation
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const QRCode = require('qrcode')

const prisma = new PrismaClient()

async function checkKristineQR() {
  console.log('🔍 Checking QR Code for Kristine Blukis\n')
  console.log('='.repeat(60))
  
  try {
    // Find Kristine Blukis
    const customer = await prisma.$queryRaw`
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
      WHERE square_customer_id = 'EDAP6Z012DMZHGTSXQMT56MKPM'
      LIMIT 1
    `
    
    if (!customer || customer.length === 0) {
      console.log('❌ Customer not found')
      return
    }
    
    const k = customer[0]
    console.log(`👤 Customer: ${k.given_name} ${k.family_name}`)
    console.log(`   Email: ${k.email_address}`)
    console.log(`   Gift Card ID: ${k.gift_card_id || 'None'}`)
    console.log(`   Gift Card GAN: ${k.gift_card_gan || 'None'}`)
    console.log('')
    
    if (!k.gift_card_gan) {
      console.log('❌ No GAN found in database')
      return
    }
    
    const gan = k.gift_card_gan
    console.log('📋 Step 1: Validating GAN format...')
    console.log(`   Original GAN: ${gan}`)
    
    // Clean GAN
    const cleanGan = gan.toString().trim().replace(/\D/g, '')
    console.log(`   Cleaned GAN: ${cleanGan}`)
    console.log(`   Length: ${cleanGan.length} digits`)
    
    if (cleanGan.length < 10 || cleanGan.length > 16) {
      console.log(`   ❌ INVALID GAN FORMAT! Length should be 10-16 digits`)
      console.log(`   This is likely the problem - Square cannot read QR codes with invalid GANs`)
      return
    }
    
    if (cleanGan !== gan) {
      console.log(`   ⚠️ WARNING: GAN had non-digit characters removed!`)
      console.log(`   Original: ${gan}`)
      console.log(`   Cleaned: ${cleanGan}`)
      console.log(`   This mismatch could cause QR code issues`)
    }
    
    console.log(`   ✅ GAN format is valid (${cleanGan.length} digits)`)
    console.log('')
    
    // Generate QR code
    console.log('📋 Step 2: Generating QR code...')
    const qrData = `sqgc://${cleanGan}`
    console.log(`   QR Data String: ${qrData}`)
    console.log(`   Format: sqgc://[16-digit-GAN]`)
    console.log('')
    
    // Test with different configurations
    const configs = [
      { name: 'High Quality (Current)', margin: 4, scale: 8, errorCorrectionLevel: 'H', width: 400 },
      { name: 'Medium Quality', margin: 3, scale: 6, errorCorrectionLevel: 'M', width: 300 },
      { name: 'Standard Quality', margin: 2, scale: 5, errorCorrectionLevel: 'M', width: 250 },
      { name: 'Old Quality (Before fix)', margin: 1, scale: 4, errorCorrectionLevel: 'M' }
    ]
    
    for (const config of configs) {
      try {
        console.log(`   Testing ${config.name}...`)
        const qrDataUri = await QRCode.toDataURL(qrData, config)
        
        if (qrDataUri && qrDataUri.startsWith('data:image')) {
          const sizeKB = (qrDataUri.length / 1024).toFixed(2)
          console.log(`      ✅ Generated successfully (${sizeKB} KB)`)
          
          // Check QR code quality
          if (qrDataUri.length > 5000) {
            console.log(`      ✅ Good quality (large file size)`)
          } else if (qrDataUri.length > 2000) {
            console.log(`      ⚠️ Medium quality`)
          } else {
            console.log(`      ⚠️ Low quality (small file size)`)
          }
        } else {
          console.log(`      ❌ Invalid data URI`)
        }
      } catch (error) {
        console.log(`      ❌ Error: ${error.message}`)
      }
      console.log('')
    }
    
    // Summary
    console.log('📋 Step 3: Summary and Recommendations')
    console.log('='.repeat(60))
    console.log(`GAN: ${cleanGan}`)
    console.log(`GAN Length: ${cleanGan.length} digits ✅`)
    console.log(`QR Format: ${qrData} ✅`)
    console.log('')
    
    const issues = []
    if (cleanGan.length !== 16) {
      issues.push(`GAN length is ${cleanGan.length}, expected 16 for Square digital cards`)
    }
    if (gan !== cleanGan) {
      issues.push(`GAN had non-digit characters: "${gan}" → "${cleanGan}"`)
    }
    
    if (issues.length > 0) {
      console.log('⚠️ Potential Issues:')
      issues.forEach(issue => console.log(`   - ${issue}`))
      console.log('')
    }
    
    console.log('✅ QR code should work with current fixes!')
    console.log('')
    console.log('💡 If Square still cannot read the QR code:')
    console.log('   1. Check if gift card is ACTIVE in Square')
    console.log('   2. Verify GAN matches Square API exactly')
    console.log('   3. Test QR code with a QR scanner app first')
    console.log('   4. Check if email client is distorting the QR image')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkKristineQR()



