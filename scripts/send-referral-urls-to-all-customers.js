#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')

const prisma = new PrismaClient()

// Configuration
const BATCH_SIZE = 10 // Send 10 emails per batch (to avoid rate limits)
const DELAY_BETWEEN_BATCHES = 5000 // Wait 5 seconds between batches
const DRY_RUN = process.env.DRY_RUN !== 'false' // Set DRY_RUN=false to actually send emails

async function sendReferralUrlsToAllCustomers() {
  try {
    console.log('🔍 Fetching all customers with referral codes...\n')
    
    // Get all customers who have personal_code (referral code)
    const customers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code,
        referral_email_sent,
        activated_as_referrer
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL
        AND email_address IS NOT NULL
        AND email_address != ''
      ORDER BY created_at DESC
    `
    
    console.log(`✅ Found ${customers.length} customers with referral codes and email addresses\n`)
    
    if (customers.length === 0) {
      console.log('❌ No customers found with referral codes and email addresses')
      return
    }
    
    // Filter customers
    const customersToEmail = customers.filter(c => {
      // Include customers who:
      // 1. Have a personal code
      // 2. Have an email address
      // 3. Optionally: haven't received email yet (uncomment to send only to new customers)
      // return !c.referral_email_sent
      return true // Send to all for now
    })
    
    console.log(`📧 Will send emails to ${customersToEmail.length} customers\n`)
    
    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - No emails will be sent')
      console.log('   Set DRY_RUN=false to actually send emails\n')
    }
    
    // Process in batches
    let successCount = 0
    let errorCount = 0
    const errors = []
    
    for (let i = 0; i < customersToEmail.length; i += BATCH_SIZE) {
      const batch = customersToEmail.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(customersToEmail.length / BATCH_SIZE)
      
      console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} customers)...`)
      
      // Process batch in parallel
      const promises = batch.map(async (customer) => {
        try {
          const referralCode = customer.personal_code
          const referralUrl = `https://referral-system-salon.vercel.app/ref/${referralCode}`
          const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Valued Customer'
          
          if (DRY_RUN) {
            console.log(`   [DRY RUN] Would send to: ${customer.email_address}`)
            console.log(`   Code: ${referralCode}`)
            console.log(`   URL: ${referralUrl}`)
            return { success: true, customer: customer.email_address }
          }
          
          // Send email
          const emailResult = await sendReferralCodeEmail(
            customerName,
            customer.email_address,
            referralCode,
            referralUrl
          )
          
          if (emailResult.success) {
            // Update database to mark email as sent
            await prisma.$executeRaw`
              UPDATE square_existing_clients
              SET referral_email_sent = TRUE
              WHERE square_customer_id = ${customer.square_customer_id}
            `
            
            console.log(`   ✅ Sent to: ${customer.email_address} (${referralCode})`)
            return { success: true, customer: customer.email_address, code: referralCode }
          } else {
            console.log(`   ❌ Failed: ${customer.email_address} - ${emailResult.error}`)
            errors.push({ email: customer.email_address, error: emailResult.error })
            return { success: false, customer: customer.email_address, error: emailResult.error }
          }
        } catch (error) {
          console.log(`   ❌ Error: ${customer.email_address} - ${error.message}`)
          errors.push({ email: customer.email_address, error: error.message })
          return { success: false, customer: customer.email_address, error: error.message }
        }
      })
      
      const results = await Promise.all(promises)
      
      // Count successes and errors
      results.forEach(result => {
        if (result.success) {
          successCount++
        } else {
          errorCount++
        }
      })
      
      // Wait before next batch (to avoid rate limits)
      if (i + BATCH_SIZE < customersToEmail.length) {
        console.log(`   ⏳ Waiting ${DELAY_BETWEEN_BATCHES / 1000} seconds before next batch...`)
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES))
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    console.log(`Total customers: ${customers.length}`)
    console.log(`Customers to email: ${customersToEmail.length}`)
    console.log(`✅ Successfully sent: ${successCount}`)
    console.log(`❌ Failed: ${errorCount}`)
    
    if (DRY_RUN) {
      console.log('\n⚠️  This was a DRY RUN - no emails were actually sent!')
      console.log('   To send emails, run: DRY_RUN=false node scripts/send-referral-urls-to-all-customers.js')
    }
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:')
      errors.slice(0, 10).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.email}: ${err.error}`)
      })
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`)
      }
    }
    
    console.log('\n✅ Done!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
sendReferralUrlsToAllCustomers()
