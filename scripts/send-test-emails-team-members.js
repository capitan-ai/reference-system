#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

const prisma = new PrismaClient()

async function sendTeamMemberEmails() {
  try {
    console.log('📧 Sending test emails to team members only...\n')
    
    const teamEmails = [
      'Goddbbaby@gmail.com',
      'yana@studiozorina.com'
    ]
    
    const teamMembers = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, 
             personal_code, created_at
      FROM square_existing_clients 
      WHERE LOWER(email_address) IN (LOWER(${teamEmails[0]}), LOWER(${teamEmails[1]}))
      ORDER BY created_at DESC
    `
    
    if (!teamMembers || teamMembers.length === 0) {
      console.log('❌ Team members not found by email addresses')
      return
    }
    
    console.log(`✅ Found ${teamMembers.length} team member(s):\n`)
    
    for (const member of teamMembers) {
      const fullName = `${member.given_name || ''} ${member.family_name || ''}`.trim()
      
      console.log(`📋 Team Member: ${fullName}`)
      console.log(`   Email: ${member.email_address}`)
      console.log(`   Code: ${member.personal_code || 'NO CODE ❌'}`)
      console.log(`   Customer ID: ${member.square_customer_id}`)
      
      if (!member.email_address) {
        console.log(`   ⚠️ Skipping ${fullName} - no email address\n`)
        continue
      }
      
      let referralCode = member.personal_code
      if (!referralCode) {
        console.log(`   ⚠️ No referral code found, generating one...`)
        const namePart = (member.given_name || 'CUST').toString().trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10)
        const idStr = member.square_customer_id.toString()
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
        
        await prisma.$executeRaw`
          UPDATE square_existing_clients 
          SET personal_code = ${referralCode}
          WHERE square_customer_id = ${member.square_customer_id}
        `
        console.log(`   ✅ Generated referral code: ${referralCode}`)
      }
      
      const referralUrl = `https://referral-system-salon.vercel.app/ref/${referralCode}`
      
      console.log(`\n📧 Sending test email to ${fullName}...`)
      console.log(`   Email: ${member.email_address}`)
      console.log(`   Referral Code: ${referralCode}`)
      console.log(`   Referral URL: ${referralUrl}`)
      
      const emailResult = await sendReferralCodeEmail(
        fullName,
        member.email_address,
        referralCode,
        referralUrl
      )
      
      if (emailResult.success) {
        console.log(`   ✅ Email sent successfully!`)
        console.log(`   Message ID: ${emailResult.messageId}\n`)
      } else {
        console.log(`   ❌ Failed to send email: ${emailResult.error}\n`)
      }
    }
    
    console.log('✅ Test email sending completed!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

sendTeamMemberEmails()





