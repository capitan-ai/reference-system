#!/usr/bin/env node
/**
 * Check complete timeline: booking, payment, gift card, referral code
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const customersToCheck = [
  { name: 'Marina Apostolaki', id: '0MHT1S68NENXGAS2S635FDTQ74' },
  { name: 'Rahel Tekeste', id: 'P51JT0CJ0RQXEYZFERE67SXEQG' },
  { name: 'Mariele Longfellow', id: 'GE4KAHES1P4DY056MNTVQV3SJ4' },
  { name: 'Kate Rodgers', id: 'WGKFCXD42JE1QPFBNX5DS2D0NG' }
]

async function checkCompleteTimeline() {
  console.log('📅 Complete Timeline Analysis\n')
  console.log('='.repeat(80))
  
  try {
    for (const customerInfo of customersToCheck) {
      console.log(`\n📋 ${customerInfo.name}`)
      console.log(`   Customer ID: ${customerInfo.id}`)
      console.log('-'.repeat(80))
      
      // 1. Customer info from database
      const customer = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          used_referral_code,
          got_signup_bonus,
          first_payment_completed,
          gift_card_id,
          gift_card_gan,
          personal_code,
          activated_as_referrer,
          referral_email_sent,
          created_at,
          updated_at
        FROM square_existing_clients
        WHERE square_customer_id = ${customerInfo.id}
      `
      
      if (!customer || customer.length === 0) {
        console.log('   ❌ Customer not found')
        continue
      }
      
      const c = customer[0]
      
      console.log(`\n1️⃣ CUSTOMER STATUS:`)
      console.log(`   Created in DB: ${c.created_at}`)
      console.log(`   Last updated: ${c.updated_at}`)
      console.log(`   Email: ${c.email_address || 'N/A'}`)
      console.log(`   Used referral code: ${c.used_referral_code || 'N/A'}`)
      console.log(`   Got signup bonus: ${c.got_signup_bonus ? '✅ Yes' : '❌ No'}`)
      console.log(`   First payment completed: ${c.first_payment_completed ? '✅ Yes' : '❌ No'}`)
      console.log(`   Gift card ID: ${c.gift_card_id || 'N/A'}`)
      console.log(`   Gift card GAN: ${c.gift_card_gan || 'N/A'}`)
      console.log(`   Personal code: ${c.personal_code || '❌ NONE'}`)
      console.log(`   Activated as referrer: ${c.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
      console.log(`   Referral email sent: ${c.referral_email_sent ? '✅ Yes' : '❌ No'}`)
      
      // 2. Check booking events
      console.log(`\n2️⃣ BOOKING EVENTS:`)
      const bookingRuns = await prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          square_event_id,
          square_event_type,
          trigger_type,
          stage,
          status,
          context,
          payload,
          created_at,
          updated_at
        FROM giftcard_runs
        WHERE square_event_type = 'booking.created'
          AND context::text LIKE ${`%${customerInfo.id}%`}
        ORDER BY created_at ASC
        LIMIT 5
      `
      
      if (bookingRuns && bookingRuns.length > 0) {
        bookingRuns.forEach((run, idx) => {
          console.log(`   ${idx + 1}. Booking event:`)
          console.log(`      Correlation: ${run.correlation_id}`)
          console.log(`      Stage: ${run.stage}`)
          console.log(`      Status: ${run.status}`)
          console.log(`      Created: ${run.created_at}`)
          
          if (run.payload) {
            try {
              const payload = typeof run.payload === 'string' ? JSON.parse(run.payload) : run.payload
              if (payload.id) {
                console.log(`      Booking ID: ${payload.id}`)
              }
              if (payload.start_at) {
                console.log(`      Booking start: ${payload.start_at}`)
              }
            } catch (e) {
              // ignore
            }
          }
        })
      } else {
        console.log(`   ⚠️  No booking.created events found`)
      }
      
      // 3. Check payment events
      console.log(`\n3️⃣ PAYMENT EVENTS:`)
      const paymentRuns = await prisma.$queryRaw`
        SELECT 
          id,
          correlation_id,
          square_event_id,
          square_event_type,
          trigger_type,
          stage,
          status,
          last_error,
          context,
          payload,
          created_at,
          updated_at
        FROM giftcard_runs
        WHERE square_event_type = 'payment.updated'
          AND context::text LIKE ${`%${customerInfo.id}%`}
        ORDER BY created_at ASC
        LIMIT 5
      `
      
      if (paymentRuns && paymentRuns.length > 0) {
        paymentRuns.forEach((run, idx) => {
          console.log(`   ${idx + 1}. Payment event:`)
          console.log(`      Correlation: ${run.correlation_id}`)
          console.log(`      Stage: ${run.stage}`)
          console.log(`      Status: ${run.status}`)
          console.log(`      Created: ${run.created_at}`)
          console.log(`      Updated: ${run.updated_at}`)
          if (run.last_error) {
            console.log(`      ❌ Error: ${run.last_error.substring(0, 200)}`)
          }
          
          if (run.payload) {
            try {
              const payload = typeof run.payload === 'string' ? JSON.parse(run.payload) : run.payload
              if (payload.id) {
                console.log(`      Payment ID: ${payload.id}`)
              }
            } catch (e) {
              // ignore
            }
          }
        })
      } else {
        console.log(`   ⚠️  No payment.updated events found`)
      }
      
      // 4. Check giftcard_jobs
      console.log(`\n4️⃣ GIFT CARD JOBS:`)
      const jobs = await prisma.$queryRaw`
        SELECT 
          id,
          stage,
          status,
          correlation_id,
          attempts,
          last_error,
          created_at,
          scheduled_at,
          updated_at
        FROM giftcard_jobs
        WHERE correlation_id LIKE ${`%${customerInfo.id}%`}
        ORDER BY created_at ASC
        LIMIT 10
      `
      
      if (jobs && jobs.length > 0) {
        console.log(`   Found ${jobs.length} jobs:`)
        jobs.forEach((job, idx) => {
          console.log(`   ${idx + 1}. ${job.stage} - ${job.status}`)
          console.log(`      Created: ${job.created_at}`)
          console.log(`      Updated: ${job.updated_at}`)
          if (job.last_error) {
            console.log(`      ❌ Error: ${job.last_error.substring(0, 150)}`)
          }
        })
      } else {
        console.log(`   ⚠️  No giftcard_jobs found`)
      }
      
      // 5. Timeline summary
      console.log(`\n5️⃣ TIMELINE SUMMARY:`)
      
      const customerCreated = new Date(c.created_at)
      const customerUpdated = new Date(c.updated_at)
      
      if (bookingRuns && bookingRuns.length > 0) {
        const firstBooking = new Date(bookingRuns[0].created_at)
        console.log(`   📅 Booking: ${firstBooking.toISOString()}`)
        console.log(`      (${Math.round((firstBooking - customerCreated) / 1000 / 60)} minutes after customer created)`)
      }
      
      if (paymentRuns && paymentRuns.length > 0) {
        const firstPayment = new Date(paymentRuns[0].created_at)
        console.log(`   💰 Payment: ${firstPayment.toISOString()}`)
        if (bookingRuns && bookingRuns.length > 0) {
          const firstBooking = new Date(bookingRuns[0].created_at)
          const timeBetween = Math.round((firstPayment - firstBooking) / 1000 / 60)
          console.log(`      (${timeBetween} minutes after booking)`)
        }
      }
      
      console.log(`   🎁 Gift card: ${c.gift_card_id ? 'Created' : 'NOT created'}`)
      if (c.got_signup_bonus) {
        console.log(`      ✅ Signup bonus granted`)
      }
      
      console.log(`   📧 Referral code: ${c.personal_code || 'NOT generated'}`)
      if (c.activated_as_referrer) {
        console.log(`      ✅ Activated as referrer`)
      } else {
        console.log(`      ❌ NOT activated as referrer`)
      }
      if (c.referral_email_sent) {
        console.log(`      ✅ Email sent`)
      } else {
        console.log(`      ❌ Email NOT sent`)
      }
      
      // 6. Issues check
      console.log(`\n6️⃣ POTENTIAL ISSUES:`)
      const issues = []
      
      if (c.first_payment_completed && !c.activated_as_referrer) {
        issues.push('❌ First payment completed but NOT activated as referrer')
      }
      
      if (c.first_payment_completed && !c.personal_code) {
        issues.push('❌ First payment completed but NO personal_code generated')
      }
      
      if (c.first_payment_completed && !c.referral_email_sent) {
        issues.push('❌ First payment completed but referral email NOT sent')
      }
      
      if (c.got_signup_bonus && !c.gift_card_id) {
        issues.push('❌ Signup bonus granted but NO gift_card_id')
      }
      
      if (issues.length > 0) {
        issues.forEach(issue => console.log(`   ${issue}`))
      } else {
        console.log(`   ✅ No issues found`)
      }
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('✅ Analysis complete')
    console.log('='.repeat(80))
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkCompleteTimeline()

