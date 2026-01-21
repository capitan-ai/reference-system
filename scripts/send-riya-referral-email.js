/**
 * Send referral code email to Riya Dulepet
 */

require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

const CUSTOMER_ID = 'PC9XDNW0KATPG52FAXJXV9045G' // Riya Dulepet

async function sendRiyaReferralEmail() {
  try {
    console.log('🔍 Fetching customer data...')
    
    // Get customer data
    const customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        personal_code,
        referral_url,
        referral_email_sent
      FROM square_existing_clients
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    
    if (!customer || customer.length === 0) {
      console.error('❌ Customer not found!')
      return
    }
    
    const customerData = customer[0]
    const customerName = `${customerData.given_name || ''} ${customerData.family_name || ''}`.trim() || 'Unknown'
    const email = customerData.email_address
    const referralCode = customerData.personal_code
    const referralUrl = customerData.referral_url || generateReferralUrl(referralCode)
    
    console.log(`\n📋 Customer Information:`)
    console.log(`   Name: ${customerName}`)
    console.log(`   Email: ${email}`)
    console.log(`   Referral Code: ${referralCode}`)
    console.log(`   Referral URL: ${referralUrl}`)
    console.log(`   Email Already Sent: ${customerData.referral_email_sent ? '✅ YES' : '❌ NO'}`)
    
    if (!email) {
      console.error('❌ No email address found for this customer!')
      return
    }
    
    if (!referralCode) {
      console.error('❌ No referral code found for this customer!')
      return
    }
    
    if (customerData.referral_email_sent) {
      console.log('\n⚠️  Email was already sent to this customer.')
      console.log('   Proceeding anyway to send updated referral URL...')
    }
    
    console.log(`\n📧 Sending referral code email to ${email}...`)
    
    // Send email
    const emailResult = await sendReferralCodeEmail(
      customerName,
      email,
      referralCode,
      referralUrl,
      {
        customerId: CUSTOMER_ID
      }
    )
    
    if (emailResult.success) {
      if (emailResult.skipped) {
        console.log(`⏸️ Email sending is disabled (skipped)`)
        return
      }
      
      console.log(`✅ Email sent successfully!`)
      console.log(`   Message ID: ${emailResult.messageId || 'N/A'}`)
      
      // Update database
      await prisma.$executeRaw`
        UPDATE square_existing_clients
        SET 
          referral_email_sent = TRUE,
          referral_url = ${referralUrl},
          updated_at = NOW()
        WHERE square_customer_id = ${CUSTOMER_ID}
      `
      
      console.log(`✅ Database updated: referral_email_sent = TRUE`)
      console.log(`✅ Referral URL saved: ${referralUrl}`)
      
    } else {
      console.error(`❌ Failed to send email: ${emailResult.error || 'Unknown error'}`)
      if (emailResult.reason) {
        console.error(`   Reason: ${emailResult.reason}`)
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run
sendRiyaReferralEmail()
  .then(() => {
    console.log('\n✨ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })

