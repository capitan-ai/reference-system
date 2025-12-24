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

// Main function to distribute referral codes
async function distributeReferralCodesToExistingCustomers() {
  try {
    console.log('🚀 STARTING STEP 0: DISTRIBUTE REFERRAL CODES TO EXISTING CUSTOMERS')
    console.log('=' .repeat(80))
    
    // Get all existing customers
    const customers = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, 
             personal_code, activated_as_referrer, referral_email_sent
      FROM square_existing_clients 
      WHERE email_address IS NOT NULL 
        AND email_address != ''
      ORDER BY created_at
    `
    
    console.log(`📊 Found ${customers.length} customers with email addresses`)
    console.log('')
    
    let successCount = 0
    let skipCount = 0
    let errorCount = 0
    
    // Process each customer
    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i]
      const progress = `[${i + 1}/${customers.length}]`
      
      try {
        // Skip if already has referral code and email was sent
        if (customer.personal_code && customer.referral_email_sent) {
          console.log(`${progress} ⏭️  SKIP: ${customer.given_name} ${customer.family_name} - Already has code and email sent`)
          skipCount++
          continue
        }
        
        // Generate referral code if doesn't exist
        let referralCode = customer.personal_code || generateReferralCode()
        const referralUrl = `https://studio-zorina.square.site/?ref=${referralCode}`
        
        // Update database with referral code
        await prisma.$executeRaw`
          UPDATE square_existing_clients 
          SET 
            personal_code = ${referralCode},
            activated_as_referrer = TRUE,
            referral_email_sent = FALSE
          WHERE square_customer_id = ${customer.square_customer_id}
        `
        
        // Send email
        const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim()
        const emailResult = await sendReferralCodeEmail(
          customerName, 
          customer.email_address, 
          referralCode, 
          referralUrl
        )
        
        if (emailResult.success) {
          // Mark email as sent
          await prisma.$executeRaw`
            UPDATE square_existing_clients 
            SET referral_email_sent = TRUE
            WHERE square_customer_id = ${customer.square_customer_id}
          `
          
          successCount++
          console.log(`${progress} ✅ SUCCESS: ${customerName} - Code: ${referralCode}`)
        } else {
          errorCount++
          console.log(`${progress} ❌ ERROR: ${customerName} - ${emailResult.error}`)
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500))
        
      } catch (error) {
        errorCount++
        console.log(`${progress} ❌ ERROR: ${customer.given_name} ${customer.family_name} - ${error.message}`)
      }
    }
    
    console.log('')
    console.log('=' .repeat(80))
    console.log('📊 SUMMARY:')
    console.log(`   ✅ Successful: ${successCount}`)
    console.log(`   ⏭️  Skipped (already sent): ${skipCount}`)
    console.log(`   ❌ Errors: ${errorCount}`)
    console.log(`   📧 Total sent: ${successCount}`)
    console.log('=' .repeat(80))
    console.log('🎉 STEP 0 COMPLETE!')
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the distribution
distributeReferralCodesToExistingCustomers()
