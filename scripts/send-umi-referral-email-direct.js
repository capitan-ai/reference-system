#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

const prisma = new PrismaClient()

// You can specify Umi's exact email or customer ID here
const UMI_EMAIL = process.env.UMI_EMAIL || 'umitrakhimbekova@gmail.com' // Update this if different
const UMI_CUSTOMER_ID = process.env.UMI_CUSTOMER_ID || null // Or specify customer ID

async function sendUmiReferralEmail() {
  try {
    let umi = null
    
    // Try to find by email first
    if (UMI_EMAIL) {
      console.log(`🔍 Searching for customer with email: ${UMI_EMAIL}\n`)
      const byEmail = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, 
               personal_code, activated_as_referrer, referral_email_sent
        FROM square_existing_clients 
        WHERE email_address = ${UMI_EMAIL}
        LIMIT 1
      `
      if (byEmail && byEmail.length > 0) {
        umi = byEmail[0]
      }
    }
    
    // If not found by email, try by customer ID
    if (!umi && UMI_CUSTOMER_ID) {
      console.log(`🔍 Searching for customer with ID: ${UMI_CUSTOMER_ID}\n`)
      const byId = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, 
               personal_code, activated_as_referrer, referral_email_sent
        FROM square_existing_clients 
        WHERE square_customer_id = ${UMI_CUSTOMER_ID}
        LIMIT 1
      `
      if (byId && byId.length > 0) {
        umi = byId[0]
      }
    }
    
    // If still not found, show all customers and let user choose
    if (!umi) {
      console.log('❌ Could not find Umi with specified email/ID')
      console.log('\n📋 All customers with referral codes:')
      const all = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, personal_code
        FROM square_existing_clients 
        WHERE personal_code IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 20
      `
      all.forEach((c, i) => {
        console.log(`   ${i+1}. ${c.given_name} ${c.family_name}`)
        console.log(`      Email: ${c.email_address || 'NO EMAIL'}`)
        console.log(`      Code: ${c.personal_code}`)
        console.log(`      ID: ${c.square_customer_id}`)
        console.log('')
      })
      console.log('\n💡 To send email to specific customer:')
      console.log('   Set UMI_EMAIL environment variable: export UMI_EMAIL="actual-email@example.com"')
      console.log('   OR set UMI_CUSTOMER_ID: export UMI_CUSTOMER_ID="SQUARE_CUSTOMER_ID"')
      return
    }
    
    console.log('✅ Found Umi!')
    console.log(`   Name: ${umi.given_name} ${umi.family_name}`)
    console.log(`   Email: ${umi.email_address || 'NO EMAIL ❌'}`)
    console.log(`   Customer ID: ${umi.square_customer_id}`)
    console.log(`   Personal Code: ${umi.personal_code || 'NO CODE ❌'}`)
    console.log(`   Activated as Referrer: ${umi.activated_as_referrer}`)
    console.log('')
    
    if (!umi.email_address) {
      console.log('❌ Cannot send email - no email address')
      return
    }
    
    // Generate referral code if missing (using name+ID format)
    let referralCode = umi.personal_code
    if (!referralCode) {
      console.log('⚠️ No personal code found - generating one now...')
      const namePart = (umi.given_name || 'CUST').toString().trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10)
      const idStr = umi.square_customer_id.toString()
      const numericMatches = idStr.match(/\d+/g)
      let idPart = ''
      if (numericMatches && numericMatches.length > 0) {
        const allNums = numericMatches.join('')
        idPart = allNums.slice(-4).padStart(4, '0')
      } else {
        idPart = idStr.slice(-4).toUpperCase()
      }
      if (idPart.length < 3) idPart = idPart.padStart(4, '0')
      if (idPart.length > 4) idPart = idPart.slice(-4)
      referralCode = `${namePart}${idPart}`
      
      // Save to database
      await prisma.$executeRaw`
        UPDATE square_existing_clients 
        SET personal_code = ${referralCode}
        WHERE square_customer_id = ${umi.square_customer_id}
      `
      console.log(`✅ Generated and saved referral code: ${referralCode}`)
    }
    
    // Generate personalized referral URL
    const referralUrl = `https://referral-system-salon.vercel.app/ref/${referralCode}`
    
    console.log('📧 Sending referral email...')
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
      console.log('🔗 Test the personalized URL:')
      console.log(`   ${referralUrl}`)
      console.log('')
      console.log('✅ This URL will open your referral website with the code displayed!')
    } else {
      console.log('❌ Failed to send email')
      console.log(`   Error: ${emailResult.error}`)
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

sendUmiReferralEmail()
