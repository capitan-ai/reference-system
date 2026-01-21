#!/usr/bin/env node

/**
 * Send referral code emails to all customers from the database
 * Uses the current Prisma schema (Customer and RefLink models)
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { sendReferralCodeEmail } = require('../lib/email-service-simple')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

// Configuration
const BATCH_SIZE = 10 // Send 10 emails per batch (to avoid rate limits)
const DELAY_BETWEEN_BATCHES = 5000 // Wait 5 seconds between batches
const DRY_RUN = process.env.DRY_RUN !== 'false' // Set DRY_RUN=false to actually send emails

async function sendReferralEmailsToCustomers() {
  try {
    console.log('🔍 Fetching customers with referral codes and email addresses...\n')
    
    // Get all customers who have:
    // 1. An email address
    // 2. An active referral link (RefLink)
    const customers = await prisma.customer.findMany({
      where: {
        email: {
          not: null,
          not: ''
        },
        RefLinks: {
          some: {
            status: 'ACTIVE'
          }
        }
      },
      include: {
        RefLinks: {
          where: {
            status: 'ACTIVE'
          },
          take: 1 // Get the first active referral link
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    console.log(`✅ Found ${customers.length} customers with referral codes and email addresses\n`)
    
    if (customers.length === 0) {
      console.log('❌ No customers found with referral codes and email addresses')
      console.log('\n💡 To generate referral codes for customers, run:')
      console.log('   node scripts/generate-referral-links-for-all-customers.js')
      return
    }
    
    // Filter customers who have both email and referral link
    const customersToEmail = customers.filter(c => {
      return c.email && 
             c.email.trim() !== '' && 
             c.RefLinks && 
             c.RefLinks.length > 0 &&
             c.RefLinks[0].refCode
    })
    
    console.log(`📧 Will send emails to ${customersToEmail.length} customers\n`)
    
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
          const refLink = customer.RefLinks[0]
          const referralCode = refLink.refCode
          const referralUrl = refLink.url || generateReferralUrl(referralCode)
          
          // Get customer name
          const customerName = customer.fullName || 
                              `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 
                              'Valued Customer'
          
          if (DRY_RUN) {
            console.log(`   [DRY RUN] Would send to: ${customer.email}`)
            console.log(`   Name: ${customerName}`)
            console.log(`   Code: ${referralCode}`)
            console.log(`   URL: ${referralUrl}`)
            return { success: true, customer: customer.email, skipped: false }
          }
          
          // Send email
          const emailResult = await sendReferralCodeEmail(
            customerName,
            customer.email,
            referralCode,
            referralUrl
          )
          
          if (emailResult.success) {
            if (emailResult.skipped) {
              skippedCount++
              console.log(`   ⏭️  Skipped: ${customer.email} (${emailResult.reason || 'email disabled'})`)
              return { success: true, customer: customer.email, skipped: true }
            } else {
              successCount++
              console.log(`   ✅ Sent to: ${customer.email} (${referralCode})`)
              return { success: true, customer: customer.email, code: referralCode, skipped: false }
            }
          } else {
            errorCount++
            console.log(`   ❌ Failed: ${customer.email} - ${emailResult.error}`)
            errors.push({ email: customer.email, error: emailResult.error })
            return { success: false, customer: customer.email, error: emailResult.error }
          }
        } catch (error) {
          errorCount++
          console.log(`   ❌ Error: ${customer.email} - ${error.message}`)
          errors.push({ email: customer.email, error: error.message })
          return { success: false, customer: customer.email, error: error.message }
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
      console.log('   DRY_RUN=false node scripts/send-referral-emails-to-customers.js')
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
sendReferralEmailsToCustomers()


