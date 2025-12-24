#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

const prisma = new PrismaClient()

async function testSendUmiReferralEmail() {
  try {
    console.log('🔍 Looking up Umi Rak in database...\n')
    
    // Find Umi by name
    const umiData = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, 
             personal_code, activated_as_referrer, referral_email_sent
      FROM square_existing_clients 
      WHERE given_name ILIKE '%umi%' OR family_name ILIKE '%umi%'
      LIMIT 1
    `
    
    if (!umiData || umiData.length === 0) {
      console.log('❌ Umi Rak not found in database')
      console.log('   Trying to find by exact name match...')
      
      // Try exact match
      const umiExact = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, 
               personal_code, activated_as_referrer, referral_email_sent
        FROM square_existing_clients 
        WHERE (given_name = 'Umi' OR given_name = 'Umit') 
          AND (family_name = 'Rak' OR family_name ILIKE '%rak%')
        LIMIT 1
      `
      
      if (!umiExact || umiExact.length === 0) {
        console.log('❌ Still not found. Showing first few customers to help identify...')
        const samples = await prisma.$queryRaw`
          SELECT given_name, family_name, email_address, personal_code
          FROM square_existing_clients 
          ORDER BY created_at DESC
          LIMIT 5
        `
        console.log('\nSample customers:')
        samples.forEach((c, i) => {
          console.log(`   ${i+1}. ${c.given_name} ${c.family_name} - ${c.email_address || 'no email'} - Code: ${c.personal_code || 'none'}`)
        })
        return
      }
      
      await processUmi(umiExact[0])
      return
    }
    
    await processUmi(umiData[0])
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

async function processUmi(umi) {
  console.log('✅ Found Umi!')
  console.log(`   Name: ${umi.given_name} ${umi.family_name}`)
  console.log(`   Email: ${umi.email_address || 'NO EMAIL ❌'}`)
  console.log(`   Personal Code: ${umi.personal_code || 'NO CODE ❌'}`)
  console.log(`   Activated as Referrer: ${umi.activated_as_referrer}`)
  console.log(`   Referral Email Sent: ${umi.referral_email_sent}`)
  console.log('')
  
  if (!umi.email_address) {
    console.log('❌ Cannot send email - no email address for Umi')
    console.log('   Please add email address to Umi\'s Square customer profile')
    return
  }
  
  if (!umi.personal_code) {
    console.log('❌ Cannot send email - no personal code (referral code) for Umi')
    console.log('   Personal code will be generated when Umi completes first payment')
    console.log('   OR we can generate one now - would you like to proceed?')
    return
  }
  
  // Generate personalized referral URL
  const referralCode = umi.personal_code
  const referralUrl = `https://referral-system-salon.vercel.app/ref/${referralCode}`
  
  console.log('📧 Preparing to send referral email...')
  console.log(`   To: ${umi.email_address}`)
  console.log(`   Referral Code: ${referralCode}`)
  console.log(`   Personalized URL: ${referralUrl}`)
  console.log('')
  
  // Send email
  const emailResult = await sendReferralCodeEmail(
    `${umi.given_name} ${umi.family_name}`,
    umi.email_address,
    referralCode,
    referralUrl
  )
  
  if (emailResult.success) {
    console.log('✅ Email sent successfully!')
    console.log(`   Message ID: ${emailResult.messageId}`)
    console.log('')
    console.log('📋 Email Details:')
    console.log(`   Subject: 🎁 Your Referral Code - Earn $10 for Each Friend!`)
    console.log(`   Recipient: ${umi.email_address}`)
    console.log(`   Referral Code: ${referralCode}`)
    console.log(`   Personalized URL: ${referralUrl}`)
    console.log('')
    console.log('🔗 Test the URL:')
    console.log(`   ${referralUrl}`)
    console.log('')
    console.log('💡 This URL should open your referral website with Umi\'s code displayed!')
  } else {
    console.log('❌ Failed to send email')
    console.log(`   Error: ${emailResult.error}`)
  }
}

testSendUmiReferralEmail()
