#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const CUSTOMER_ID = '5Q1A2BG073YPWP8G6H0FGQE9VG'
const CORRELATION_ID = 'booking-created:cba3df6c3b49eead38d573af'

async function checkSummary() {
  console.log('🔍 Comprehensive Job & Email Check for Natalia Bijak\n')
  console.log('='.repeat(60))
  
  try {
    // 1. Customer data
    console.log('\n1️⃣ Customer Database Info:')
    const customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name || ' ' || family_name as name,
        email_address,
        gift_card_id,
        gift_card_gan,
        gift_card_delivery_channel,
        got_signup_bonus,
        used_referral_code,
        first_payment_completed
      FROM square_existing_clients 
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    console.log(JSON.stringify(customer[0], null, 2))
    
    // 2. Gift card runs
    console.log('\n2️⃣ Gift Card Runs:')
    const runs = await prisma.$queryRaw`
      SELECT 
        correlation_id,
        square_event_type,
        stage,
        status,
        attempts,
        last_error,
        created_at,
        updated_at
      FROM giftcard_runs
      WHERE resource_id = ${CUSTOMER_ID}
         OR correlation_id = ${CORRELATION_ID}
      ORDER BY created_at DESC
    `
    console.log(JSON.stringify(runs, null, 2))
    
    // 3. Gift card jobs
    console.log('\n3️⃣ Gift Card Jobs:')
    const jobs = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        stage,
        trigger_type,
        status,
        attempts,
        last_error,
        scheduled_at,
        created_at,
        updated_at
      FROM giftcard_jobs
      WHERE correlation_id = ${CORRELATION_ID}
         OR payload::text LIKE '%${CUSTOMER_ID}%'
         OR context::text LIKE '%${CUSTOMER_ID}%'
      ORDER BY created_at DESC
    `
    console.log(JSON.stringify(jobs, null, 2))
    
    // 4. Notification events
    console.log('\n4️⃣ Notification Events (Emails/SMS):')
    const notifications = await prisma.$queryRaw`
      SELECT 
        id,
        channel,
        "templateType",
        status,
        "customerId",
        "referrerCustomerId",
        "externalId",
        "errorMessage",
        "sentAt",
        "createdAt"
      FROM notification_events
      WHERE "customerId" = ${CUSTOMER_ID}
         OR "referrerCustomerId" = ${CUSTOMER_ID}
      ORDER BY "createdAt" DESC
    `
    console.log(notifications.length > 0 ? JSON.stringify(notifications, null, 2) : 'None found')
    
    // 5. Summary
    console.log('\n' + '='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    
    const hasGiftCard = customer[0]?.gift_card_id
    const hasEmail = customer[0]?.email_address
    const hasNotification = notifications.length > 0
    const jobCompleted = jobs.find(j => j.status === 'completed')
    const hasError = jobs.find(j => j.status === 'error' || j.last_error)
    
    console.log(`✅ Gift Card Created: ${hasGiftCard ? 'Yes' : 'No'}`)
    console.log(`   - ID: ${customer[0]?.gift_card_id || 'N/A'}`)
    console.log(`   - GAN: ${customer[0]?.gift_card_gan || 'N/A'}`)
    
    console.log(`\n📧 Email Status:`)
    console.log(`   - Email Address: ${hasEmail || 'Missing'}`)
    console.log(`   - Notification Events: ${notifications.length}`)
    console.log(`   - Email Sent: ${hasNotification ? 'Yes ✅' : 'No ❌'}`)
    
    console.log(`\n⚙️  Job Status:`)
    console.log(`   - Booking Job Completed: ${jobCompleted ? 'Yes' : 'No'}`)
    if (hasError) {
      console.log(`   - Errors Found: Yes ❌`)
      console.log(`   - Error: ${hasError.last_error}`)
    } else {
      console.log(`   - Errors: None ✅`)
    }
    
    console.log(`\n🔍 Conclusion:`)
    if (!hasEmail) {
      console.log(`   ❌ Email address is missing - email cannot be sent`)
    } else if (!hasNotification && jobCompleted) {
      console.log(`   ⚠️  Job completed but no email notification was created`)
      console.log(`   - Possible reasons:`)
      console.log(`     1. Email was skipped (zero amount, missing GAN, etc.)`)
      console.log(`     2. Email sending failed silently`)
      console.log(`     3. waitForPassKitUrl timed out and prevented email`)
      console.log(`     4. Notification event creation failed`)
    } else if (hasNotification) {
      console.log(`   ✅ Email notification was created`)
    }
    
    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error:', error.message)
    await prisma.$disconnect()
  }
}

checkSummary()




