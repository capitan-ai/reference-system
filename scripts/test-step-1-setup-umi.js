#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

const prisma = new PrismaClient()

// Generate unique referral code
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

async function setupUmiAsReferrer() {
  try {
    console.log('🎯 STEP 1: Setting up Umi as Referrer')
    console.log('=' .repeat(80))
    
    // Search for Umi in database
    console.log('\n📍 Searching for Umi in database...')
    
    const umiResults = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, 
             personal_code, activated_as_referrer
      FROM square_existing_clients 
      WHERE (given_name ILIKE '%umi%' OR given_name ILIKE '%umit%')
      LIMIT 5
    `
    
    if (!umiResults || umiResults.length === 0) {
      console.log('❌ Could not find Umi in database')
      console.log('\nPlease provide Umi\'s:')
      console.log('- Email address')
      console.log('- Phone number')
      console.log('- Or Square Customer ID')
      return
    }
    
    console.log(`\n✅ Found ${umiResults.length} potential match(es):`)
    umiResults.forEach((customer, index) => {
      console.log(`\n${index + 1}. ${customer.given_name} ${customer.family_name}`)
      console.log(`   Email: ${customer.email_address}`)
      console.log(`   Customer ID: ${customer.square_customer_id}`)
      console.log(`   Has referral code: ${customer.personal_code ? 'YES - ' + customer.personal_code : 'NO'}`)
      console.log(`   Activated as referrer: ${customer.activated_as_referrer ? 'YES' : 'NO'}`)
    })
    
    // Use the first match
    const umi = umiResults[0]
    console.log(`\n👤 Using: ${umi.given_name} ${umi.family_name}`)
    
    // Generate or use existing code
    let referralCode = umi.personal_code
    
    if (!referralCode) {
      console.log('\n🔧 Generating new referral code...')
      referralCode = generateReferralCode()
      
      // Update database
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET 
          personal_code = ${referralCode},
          activated_as_referrer = TRUE,
          referral_email_sent = FALSE
        WHERE square_customer_id = ${umi.square_customer_id}
      `
      
      console.log(`✅ Generated code: ${referralCode}`)
    } else {
      console.log(`\n✅ Using existing code: ${referralCode}`)
    }
    
    // Create referral URL
    const referralUrl = `https://studio-zorina.square.site/?ref=${referralCode}`
    
    // Send email
    console.log('\n📧 Sending email to Umi...')
    
    const emailResult = await sendReferralCodeEmail(
      `${umi.given_name} ${umi.family_name}`,
      umi.email_address,
      referralCode,
      referralUrl
    )
    
    if (emailResult.success) {
      // Mark email as sent
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET referral_email_sent = TRUE
        WHERE square_customer_id = ${umi.square_customer_id}
      `
      
      console.log('✅ Email sent successfully!')
    } else {
      console.log(`❌ Email failed: ${emailResult.error}`)
    }
    
    console.log('\n' + '=' .repeat(80))
    console.log('📋 SUMMARY:')
    console.log(`   Referrer: ${umi.given_name} ${umi.family_name}`)
    console.log(`   Email: ${umi.email_address}`)
    console.log(`   Referral Code: ${referralCode}`)
    console.log(`   Referral URL: ${referralUrl}`)
    console.log('=' .repeat(80))
    
    console.log('\n✅ STEP 1 COMPLETE!')
    console.log('\n📝 NEXT: Aby should:')
    console.log(`   1. Go to: ${referralUrl}`)
    console.log(`   2. OR enter code "${referralCode}" when booking`)
    console.log(`   3. Create booking`)
    console.log(`   4. System will automatically give Aby $10 gift card`)
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

setupUmiAsReferrer()
