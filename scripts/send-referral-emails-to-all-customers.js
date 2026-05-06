#!/usr/bin/env node

/**
 * Send referral code emails to all customers from square_existing_clients table
 * This works with the 7000+ customers in the legacy table
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

// Configuration
const BATCH_SIZE = 10 // Send 10 emails per batch (to avoid rate limits)
const DELAY_BETWEEN_BATCHES = 10000 // Wait 10 seconds between batches
const DRY_RUN = process.env.DRY_RUN !== 'false' // Set DRY_RUN=false to actually send emails
const SEND_ONLY_PENDING = process.env.SEND_ONLY_PENDING !== 'false'
const SKIP_SUPPRESSED = process.env.SKIP_SUPPRESSED !== 'false'
const SUPPRESSION_REPORT_PATH = path.join(
  __dirname,
  '..',
  'reports',
  'referral-email-discrepancies.json'
)

function loadSuppressedEmails() {
  if (!SKIP_SUPPRESSED) {
    return new Set()
  }
  if (!fs.existsSync(SUPPRESSION_REPORT_PATH)) {
    return new Set()
  }
  try {
    const report = JSON.parse(
      fs.readFileSync(SUPPRESSION_REPORT_PATH, 'utf-8')
    )
    const emails = new Set(
      report
        .map((entry) => (entry.email || '').trim().toLowerCase())
        .filter((email) => email.length > 0)
    )
    console.log(
      `   ⚠️  SKIP_SUPPRESSED enabled – will skip ${emails.size} emails listed in ${SUPPRESSION_REPORT_PATH}`
    )
    return emails
  } catch (error) {
    console.log(
      `   ⚠️  Failed to parse suppression report (${SUPPRESSION_REPORT_PATH}): ${error.message}`
    )
    return new Set()
  }
}

async function sendReferralEmailsToAllCustomers() {
  try {
    console.log('🔍 Fetching customers from square_existing_clients table...\n')
    
    // Get all customers from square_existing_clients who have:
    // 1. An email address
    // 2. A referral code (personal_code)
    const customers = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code,
        referral_url,
        referral_email_sent
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL
        AND personal_code != ''
        AND email_address IS NOT NULL
        AND email_address != ''
      ORDER BY created_at DESC
    `
    
    console.log(`✅ Found ${customers.length} customers with referral codes and email addresses\n`)
    
    if (customers.length === 0) {
      console.log('❌ No customers found with referral codes and email addresses')
      return
    }
    
    const suppressedEmails = loadSuppressedEmails()
    console.log('📋 Filter configuration:')
    console.log(`   SEND_ONLY_PENDING: ${SEND_ONLY_PENDING ? '✅ pending only' : '♻️  all ready customers'}`)
    console.log(`   SKIP_SUPPRESSED: ${SKIP_SUPPRESSED ? '✅ enabled' : '⚠️  disabled'}`)
    
    let invalidDataSkipCount = 0
    let pendingSkipCount = 0
    let suppressedSkipCount = 0

    // Filter customers down to the next batch
    const customersToEmail = customers.filter((c) => {
      const email = (c.email_address || '').trim()
      const code = (c.personal_code || '').trim()
      if (!email || !code) {
        invalidDataSkipCount++
        return false
      }
      if (SEND_ONLY_PENDING && c.referral_email_sent) {
        pendingSkipCount++
        return false
      }
      if (
        suppressedEmails.size > 0 &&
        suppressedEmails.has(email.toLowerCase())
      ) {
        suppressedSkipCount++
        return false
      }
      return true
    })

    console.log(`📧 Will send emails to ${customersToEmail.length} customers`)
    if (invalidDataSkipCount > 0) {
      console.log(`   ⏭️  Skipped ${invalidDataSkipCount} customers missing email/code data`)
    }
    if (SEND_ONLY_PENDING) {
      const pendingCount = customers.filter(
        (c) =>
          (c.email_address || '').trim() !== '' &&
          (c.personal_code || '').trim() !== '' &&
          !c.referral_email_sent
      ).length
      console.log(`   Pending customers detected: ${pendingCount.toLocaleString()}`)
      if (pendingSkipCount > 0) {
        console.log(`   ⏭️  Already marked sent (excluded): ${pendingSkipCount}`)
      }
    }
    if (suppressedSkipCount > 0) {
      console.log(`   ⏭️  Skipping ${suppressedSkipCount} customers from suppression report`)
    }
    console.log('')
    
    // Check email configuration
    console.log('📋 Email Configuration:')
    console.log(`   SENDGRID_API_KEY: ${process.env.SENDGRID_API_KEY ? '✅ Set' : '❌ Not set'}`)
    console.log(`   FROM_EMAIL: ${process.env.FROM_EMAIL || '⚠️  Not set (will use default: info@studiozorina.com)'}`)
    console.log(`   DRY_RUN: ${DRY_RUN ? '✅ Enabled (no emails will be sent)' : '❌ Disabled (emails WILL be sent)'}`)
    console.log('')
    
    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - No emails will be sent')
      console.log('   Set DRY_RUN=false to actually send emails\n')
    } else {
      if (!process.env.SENDGRID_API_KEY) {
        console.log('❌ ERROR: SENDGRID_API_KEY is not set!')
        console.log('   Emails cannot be sent without SendGrid API key.')
        console.log('   Please set SENDGRID_API_KEY in your environment variables.\n')
        return
      }
    }
    
    // Process in batches
    let successCount = 0
    let errorCount = 0
    let skippedCount = 0
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
          // Use existing referral_url if available, otherwise generate it
          const referralUrl = customer.referral_url || generateReferralUrl(referralCode)
          
          // Get customer name
          const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 
                              'Valued Customer'
          
          if (DRY_RUN) {
            console.log(`   [DRY RUN] Would send to: ${customer.email_address}`)
            console.log(`   Name: ${customerName}`)
            console.log(`   Code: ${referralCode}`)
            console.log(`   URL: ${referralUrl}`)
            return { success: true, customer: customer.email_address, skipped: false }
          }
          
          // Send email
          const emailResult = await sendReferralCodeEmail(
            customerName,
            customer.email_address,
            referralCode,
            referralUrl
          )
          
          if (emailResult.success) {
            if (emailResult.skipped) {
              skippedCount++
              console.log(`   ⏭️  Skipped: ${customer.email_address} (${emailResult.reason || 'email disabled'})`)
              return { success: true, customer: customer.email_address, skipped: true }
            } else {
              successCount++
              
              // Update database to mark email as sent
              try {
                await prisma.$executeRaw`
                  UPDATE square_existing_clients
                  SET referral_email_sent = TRUE,
                      updated_at = NOW()
                  WHERE square_customer_id = ${customer.square_customer_id}
                `
              } catch (updateError) {
                // Log but don't fail if update fails
                console.log(`   ⚠️  Email sent but couldn't update database: ${updateError.message}`)
              }
              
              console.log(`   ✅ Sent to: ${customer.email_address} (${referralCode})`)
              return { success: true, customer: customer.email_address, code: referralCode, skipped: false }
            }
          } else {
            errorCount++
            console.log(`   ❌ Failed: ${customer.email_address} - ${emailResult.error}`)
            errors.push({ email: customer.email_address, error: emailResult.error })
            return { success: false, customer: customer.email_address, error: emailResult.error }
          }
        } catch (error) {
          errorCount++
          console.log(`   ❌ Error: ${customer.email_address} - ${error.message}`)
          errors.push({ email: customer.email_address, error: error.message })
          return { success: false, customer: customer.email_address, error: error.message }
        }
      })
      
      const results = await Promise.all(promises)
      
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
    console.log(`Total customers found: ${customers.length}`)
    console.log(`Customers to email: ${customersToEmail.length}`)
    console.log(`✅ Successfully sent: ${successCount}`)
    console.log(`⏭️  Skipped: ${skippedCount}`)
    console.log(`❌ Failed: ${errorCount}`)
    
    if (DRY_RUN) {
      console.log('\n⚠️  This was a DRY RUN - no emails were actually sent!')
      console.log('   To send emails, run:')
      console.log('   DRY_RUN=false node scripts/send-referral-emails-to-all-customers.js')
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
sendReferralEmailsToAllCustomers()

