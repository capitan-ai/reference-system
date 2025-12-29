#!/usr/bin/env node

/**
 * Verify that everything is ready to send referral code emails to ALL customers
 * from square_existing_clients table (7000+ customers)
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function verifyAllCustomersEmailReadiness() {
  try {
    console.log('🔍 Verifying Email Readiness for ALL Customers (square_existing_clients)\n')
    console.log('='.repeat(60))
    
    let allReady = true
    
    // 1. Check SendGrid Configuration
    console.log('\n📧 1. Email Service Configuration:')
    const hasSendGridKey = !!process.env.SENDGRID_API_KEY
    const hasFromEmail = !!process.env.FROM_EMAIL
    const emailDisabled = process.env.DISABLE_EMAIL_SENDING === 'true' || process.env.EMAIL_ENABLED === 'false'
    
    if (hasSendGridKey) {
      console.log('   ✅ SENDGRID_API_KEY: Set')
    } else {
      console.log('   ❌ SENDGRID_API_KEY: NOT SET')
      console.log('      → Add SENDGRID_API_KEY to your environment variables')
      allReady = false
    }
    
    if (hasFromEmail) {
      console.log(`   ✅ FROM_EMAIL: ${process.env.FROM_EMAIL}`)
    } else {
      console.log('   ⚠️  FROM_EMAIL: Not set (will use default: info@studiozorina.com)')
    }
    
    if (emailDisabled) {
      console.log('   ⚠️  Email sending is DISABLED (DISABLE_EMAIL_SENDING=true or EMAIL_ENABLED=false)')
      console.log('      → Set DISABLE_EMAIL_SENDING=false to enable sending')
    } else {
      console.log('   ✅ Email sending is ENABLED')
    }
    
    // 2. Check Database Connection
    console.log('\n💾 2. Database Connection:')
    try {
      await prisma.$connect()
      console.log('   ✅ Database connection: OK')
    } catch (error) {
      console.log('   ❌ Database connection: FAILED')
      console.log(`      Error: ${error.message}`)
      allReady = false
    }
    
    // 3. Check Customers in square_existing_clients
    console.log('\n👥 3. Customer Data (square_existing_clients table):')
    try {
      const totalCount = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM square_existing_clients
      `
      const totalCustomers = Number(totalCount[0].count)
      console.log(`   📊 Total customers in database: ${totalCustomers.toLocaleString()}`)
      
      const withEmailCount = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM square_existing_clients 
        WHERE email_address IS NOT NULL AND email_address != ''
      `
      const customersWithEmail = Number(withEmailCount[0].count)
      console.log(`   📊 Customers with email addresses: ${customersWithEmail.toLocaleString()}`)
      
      const withCodeCount = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM square_existing_clients 
        WHERE personal_code IS NOT NULL AND personal_code != ''
      `
      const customersWithRefCodes = Number(withCodeCount[0].count)
      console.log(`   📊 Customers with referral codes: ${customersWithRefCodes.toLocaleString()}`)
      
      const readyCount = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM square_existing_clients 
        WHERE personal_code IS NOT NULL 
          AND personal_code != ''
          AND email_address IS NOT NULL 
          AND email_address != ''
      `
      const customersReadyForEmail = Number(readyCount[0].count)
      console.log(`   📊 Customers ready for emails: ${customersReadyForEmail.toLocaleString()}`)
      
      const alreadySentCount = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM square_existing_clients 
        WHERE referral_email_sent = TRUE
      `
      const alreadySent = Number(alreadySentCount[0].count)
      console.log(`   📊 Already sent emails: ${alreadySent.toLocaleString()}`)
      
      const pendingCount = customersReadyForEmail - alreadySent
      console.log(`   📊 Pending emails: ${pendingCount.toLocaleString()}`)
      
      if (customersReadyForEmail === 0) {
        console.log('\n   ⚠️  No customers are ready to receive emails!')
        console.log('      → Run: node scripts/generate-referral-links-for-all-customers.js')
        allReady = false
      } else {
        console.log('   ✅ Customers ready for emails: OK')
      }
      
      // Show sample of customers
      if (customersReadyForEmail > 0) {
        const sampleCustomers = await prisma.$queryRaw`
          SELECT 
            square_customer_id,
            given_name,
            family_name,
            email_address,
            personal_code,
            referral_email_sent
          FROM square_existing_clients
          WHERE personal_code IS NOT NULL 
            AND personal_code != ''
            AND email_address IS NOT NULL 
            AND email_address != ''
          ORDER BY created_at DESC
          LIMIT 5
        `
        
        console.log('\n   📋 Sample customers (first 5):')
        sampleCustomers.forEach((customer, i) => {
          const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
          const sent = customer.referral_email_sent ? '✅ Sent' : '⏳ Pending'
          console.log(`      ${i + 1}. ${name} (${customer.email_address}) - Code: ${customer.personal_code} [${sent}]`)
        })
      }
      
    } catch (error) {
      console.log('   ❌ Error checking customer data')
      console.log(`      Error: ${error.message}`)
      allReady = false
    }
    
    // 4. Check Email Service Module
    console.log('\n📦 4. Email Service Module:')
    try {
      const emailService = require('../lib/email-service-simple')
      if (emailService.sendReferralCodeEmail) {
        console.log('   ✅ Email service module: OK')
      } else {
        console.log('   ❌ Email service module: Missing sendReferralCodeEmail function')
        allReady = false
      }
    } catch (error) {
      console.log('   ❌ Email service module: FAILED to load')
      console.log(`      Error: ${error.message}`)
      allReady = false
    }
    
    // 5. Check Referral URL Utility
    console.log('\n🔗 5. Referral URL Utility:')
    try {
      const { generateReferralUrl } = require('../lib/utils/referral-url')
      if (typeof generateReferralUrl === 'function') {
        const testUrl = generateReferralUrl('TEST123')
        console.log('   ✅ Referral URL utility: OK')
        console.log(`      Test URL: ${testUrl}`)
      } else {
        console.log('   ❌ Referral URL utility: Missing generateReferralUrl function')
        allReady = false
      }
    } catch (error) {
      console.log('   ❌ Referral URL utility: FAILED to load')
      console.log(`      Error: ${error.message}`)
      allReady = false
    }
    
    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    
    if (allReady && !emailDisabled) {
      console.log('✅ Everything is ready! You can send emails to ALL customers.')
      console.log('\n📧 To send emails, run:')
      console.log('   DRY_RUN=false node scripts/send-referral-emails-to-all-customers.js')
      console.log('\n⚠️  Or test first with dry run:')
      console.log('   node scripts/send-referral-emails-to-all-customers.js')
      console.log('\n⏱️  Estimated time:')
      const readyCount = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM square_existing_clients 
        WHERE personal_code IS NOT NULL 
          AND personal_code != ''
          AND email_address IS NOT NULL 
          AND email_address != ''
      `
      const count = Number(readyCount[0].count)
      const batches = Math.ceil(count / 10)
      const minutes = Math.ceil((batches * 5) / 60)
      console.log(`   ~${minutes} minutes for ${count.toLocaleString()} customers (${batches} batches)`)
    } else if (emailDisabled) {
      console.log('⚠️  Email sending is disabled. Enable it to send emails.')
      console.log('   Set DISABLE_EMAIL_SENDING=false or EMAIL_ENABLED=true')
    } else {
      console.log('❌ Not everything is ready. Please fix the issues above.')
    }
    
    console.log('')
    
  } catch (error) {
    console.error('❌ Verification error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run verification
verifyAllCustomersEmailReadiness()


