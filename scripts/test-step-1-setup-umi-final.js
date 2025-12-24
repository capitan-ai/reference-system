#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

const prisma = new PrismaClient()

async function setupUmiWithEmail() {
  try {
    console.log('🎯 STEP 1: Setting up Umi as Referrer')
    console.log('=' .repeat(80))
    
    const customerId = '91JSN0S64QAR031H5ZESXPTZKR'
    const referralCode = 'CUST_MHA4LEYB5ERA'
    const email = 'umit0912@icloud.com'
    
    console.log('\n👤 Found Umi:')
    console.log(`   Name: Umit Rak`)
    console.log(`   Phone: +16287893902`)
    console.log(`   Customer ID: ${customerId}`)
    console.log(`   Existing Code: ${referralCode}`)
    
    // Update email and activate as referrer
    console.log('\n🔧 Updating Umi\'s email and activating as referrer...')
    
    await prisma.$executeRaw`
      UPDATE square_existing_clients 
      SET 
        email_address = ${email},
        activated_as_referrer = TRUE,
        referral_email_sent = FALSE
      WHERE square_customer_id = ${customerId}
    `
    
    console.log('✅ Email updated and activated as referrer')
    
    // Create referral URL
    const referralUrl = `https://studio-zorina.square.site/?ref=${referralCode}`
    
    // Send email
    console.log('\n📧 Sending referral code email to Umi...')
    
    const emailResult = await sendReferralCodeEmail(
      'Umit Rak',
      email,
      referralCode,
      referralUrl
    )
    
    if (emailResult.success) {
      // Mark email as sent
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET referral_email_sent = TRUE
        WHERE square_customer_id = ${customerId}
      `
      
      console.log('✅ Email sent successfully!')
    } else {
      console.log(`❌ Email failed: ${emailResult.error}`)
    }
    
    console.log('\n' + '=' .repeat(80))
    console.log('📋 STEP 1 COMPLETE - UMI\'S REFERRAL CODE:')
    console.log('=' .repeat(80))
    console.log(`   Referrer: Umit Rak`)
    console.log(`   Email: ${email}`)
    console.log(`   Phone: +16287893902`)
    console.log(`   Referral Code: ${referralCode}`)
    console.log(`   Referral URL: ${referralUrl}`)
    console.log('=' .repeat(80))
    
    console.log('\n✅ Email sent to Umi with referral code!')
    
    console.log('\n📝 NEXT STEP:')
    console.log('=' .repeat(80))
    console.log('Aby should now:')
    console.log(`   1. Go to: ${referralUrl}`)
    console.log(`   2. OR enter code "${referralCode}" in the referral field when booking`)
    console.log('   3. Create a booking on Square')
    console.log('   4. System will automatically give Aby $10 gift card')
    console.log('')
    console.log('After Aby books, run:')
    console.log('   node scripts/test-step-2-check-aby-booking.js')
    console.log('=' .repeat(80))
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

setupUmiWithEmail()
