#!/usr/bin/env node
/**
 * Deep dive into Kate Rodgers payment processing
 * to understand why referrer reward wasn't granted
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

const CUSTOMER_ID = 'WGKFCXD42JE1QPFBNX5DS2D0NG'
const REFERRER_CODE = 'KATE1520'
const REFERRER_ID = 'A07R0HJ5AS37KDPNENA1W5V2N0'

async function checkKateRodgersPayment() {
  console.log('🔍 Deep Analysis: Kate Rodgers Payment Processing\n')
  console.log('='.repeat(80))
  
  try {
    // 1. Customer details
    console.log('\n1️⃣ CUSTOMER DETAILS:')
    const customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        used_referral_code,
        first_payment_completed,
        got_signup_bonus,
        gift_card_id,
        personal_code,
        activated_as_referrer,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    
    if (customer && customer.length > 0) {
      const c = customer[0]
      console.log(`   Name: ${c.given_name} ${c.family_name}`)
      console.log(`   Email: ${c.email_address || 'N/A'}`)
      console.log(`   Phone: ${c.phone_number || 'N/A'}`)
      console.log(`   Used referral code: ${c.used_referral_code}`)
      console.log(`   First payment completed: ${c.first_payment_completed ? '✅ Yes' : '❌ No'}`)
      console.log(`   Got signup bonus: ${c.got_signup_bonus ? '✅ Yes' : '❌ No'}`)
      console.log(`   Gift card ID: ${c.gift_card_id || 'N/A'}`)
      console.log(`   Personal code: ${c.personal_code || 'N/A'}`)
      console.log(`   Activated as referrer: ${c.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
      console.log(`   Created: ${c.created_at}`)
      console.log(`   Updated: ${c.updated_at}`)
      console.log(`   Time difference: ${new Date(c.updated_at) - new Date(c.created_at)}ms`)
    }
    
    // 2. Referrer details
    console.log('\n2️⃣ REFERRER DETAILS:')
    const referrer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        personal_code,
        activated_as_referrer,
        total_referrals,
        total_rewards,
        gift_card_id,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE square_customer_id = ${REFERRER_ID}
    `
    
    if (referrer && referrer.length > 0) {
      const r = referrer[0]
      console.log(`   Name: ${r.given_name} ${r.family_name}`)
      console.log(`   Email: ${r.email_address || 'N/A'}`)
      console.log(`   Phone: ${r.phone_number || 'N/A'}`)
      console.log(`   Personal code: ${r.personal_code}`)
      console.log(`   Activated as referrer: ${r.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
      console.log(`   Total referrals: ${r.total_referrals || 0}`)
      console.log(`   Total rewards: $${((r.total_rewards || 0) / 100).toFixed(2)}`)
      console.log(`   Gift card ID: ${r.gift_card_id || '❌ NONE'}`)
      console.log(`   Created: ${r.created_at}`)
      console.log(`   Updated: ${r.updated_at}`)
      
      // Check if referrer was activated before customer's payment
      const customerCreated = new Date(customer[0].created_at)
      const referrerUpdated = new Date(r.updated_at)
      console.log(`\n   ⏰ TIMELINE CHECK:`)
      console.log(`      Customer created: ${customerCreated.toISOString()}`)
      console.log(`      Referrer last updated: ${referrerUpdated.toISOString()}`)
      console.log(`      Referrer was activated BEFORE customer payment: ${referrerUpdated < customerCreated ? '✅ Yes' : '❌ No'}`)
    }
    
    // 3. Check processed events
    console.log('\n3️⃣ PROCESSED EVENTS:')
    try {
      const processedEvents = await prisma.$queryRaw`
        SELECT 
          "idempotencyKey" as idempotency_key,
          "createdAt" as created_at
        FROM processed_events
        WHERE "idempotencyKey" LIKE ${`%${CUSTOMER_ID}%`}
           OR "idempotencyKey" LIKE ${`%payment%`}
        ORDER BY "createdAt" DESC
        LIMIT 10
      `
    
      if (processedEvents && processedEvents.length > 0) {
        console.log(`   Found ${processedEvents.length} processed events:`)
        processedEvents.forEach((event, idx) => {
          console.log(`      ${idx + 1}. ${event.idempotency_key} - ${event.created_at}`)
        })
      } else {
        console.log(`   ❌ No processed events found`)
      }
    } catch (error) {
      console.log(`   ⚠️  Could not check processed_events: ${error.message}`)
    }
    
    // 4. Check giftcard_jobs
    console.log('\n4️⃣ GIFTCARD JOBS:')
    const jobs = await prisma.$queryRaw`
      SELECT 
        id,
        stage,
        status,
        correlation_id,
        attempts,
        max_attempts,
        last_error,
        created_at,
        scheduled_at,
        updated_at,
        payload
      FROM giftcard_jobs
      WHERE correlation_id LIKE ${`%${CUSTOMER_ID}%`}
      ORDER BY created_at DESC
      LIMIT 10
    `
    
    if (jobs && jobs.length > 0) {
      console.log(`   Found ${jobs.length} jobs:`)
      jobs.forEach((job, idx) => {
        console.log(`      ${idx + 1}. Stage: ${job.stage}, Status: ${job.status}`)
        console.log(`         Correlation: ${job.correlation_id}`)
        console.log(`         Attempts: ${job.attempts}/${job.max_attempts}`)
        if (job.last_error) {
          console.log(`         ❌ Error: ${job.last_error.substring(0, 300)}`)
        }
        console.log(`         Created: ${job.created_at}`)
        console.log(`         Updated: ${job.updated_at}`)
      })
    } else {
      console.log(`   ❌ No giftcard_jobs found`)
    }
    
    // 5. Check giftcard_runs
    console.log('\n5️⃣ GIFTCARD RUNS:')
    const runs = await prisma.$queryRaw`
      SELECT 
        id,
        correlation_id,
        square_event_id,
        square_event_type,
        trigger_type,
        stage,
        status,
        attempts,
        last_error,
        context,
        payload,
        created_at,
        updated_at
      FROM giftcard_runs
      WHERE correlation_id LIKE ${`%${CUSTOMER_ID}%`}
         OR correlation_id LIKE ${`%payment%`}
      ORDER BY created_at DESC
      LIMIT 10
    `
    
    if (runs && runs.length > 0) {
      console.log(`   Found ${runs.length} runs:`)
      runs.forEach((run, idx) => {
        console.log(`      ${idx + 1}. Stage: ${run.stage}, Status: ${run.status}`)
        console.log(`         Correlation: ${run.correlation_id}`)
        console.log(`         Event type: ${run.square_event_type || 'N/A'}`)
        console.log(`         Trigger: ${run.trigger_type}`)
        console.log(`         Attempts: ${run.attempts}`)
        if (run.last_error) {
          console.log(`         ❌ Error: ${run.last_error.substring(0, 300)}`)
        }
        if (run.context) {
          try {
            const context = typeof run.context === 'string' ? JSON.parse(run.context) : run.context
            console.log(`         Context: ${JSON.stringify(context).substring(0, 200)}`)
          } catch (e) {
            console.log(`         Context: ${String(run.context).substring(0, 200)}`)
          }
        }
        console.log(`         Created: ${run.created_at}`)
        console.log(`         Updated: ${run.updated_at}`)
      })
    } else {
      console.log(`   ❌ No giftcard_runs found`)
    }
    
    // 6. Check if referrer code lookup would work
    console.log('\n6️⃣ REFERRER CODE LOOKUP TEST:')
    const codeLookup = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        personal_code
      FROM square_existing_clients
      WHERE UPPER(TRIM(personal_code)) = UPPER(TRIM(${REFERRER_CODE}))
         OR personal_code = ${REFERRER_CODE}
      LIMIT 5
    `
    
    if (codeLookup && codeLookup.length > 0) {
      console.log(`   ✅ Referrer code lookup works:`)
      codeLookup.forEach((ref, idx) => {
        console.log(`      ${idx + 1}. ${ref.given_name} ${ref.family_name} (${ref.square_customer_id})`)
        console.log(`         Code: ${ref.personal_code}`)
      })
    } else {
      console.log(`   ❌ Referrer code lookup FAILED - code not found!`)
    }
    
    // 7. Check for self-referral
    console.log('\n7️⃣ SELF-REFERRAL CHECK:')
    if (customer && customer.length > 0 && referrer && referrer.length > 0) {
      const c = customer[0]
      const r = referrer[0]
      const isSelfReferral = c.square_customer_id === r.square_customer_id
      const isOwnCode = c.personal_code && 
                        c.personal_code.toUpperCase().trim() === REFERRER_CODE.toUpperCase().trim()
      
      console.log(`   Customer ID: ${c.square_customer_id}`)
      console.log(`   Referrer ID: ${r.square_customer_id}`)
      console.log(`   Is self-referral (same ID): ${isSelfReferral ? '❌ YES - BLOCKED' : '✅ No'}`)
      console.log(`   Is own code: ${isOwnCode ? '❌ YES - BLOCKED' : '✅ No'}`)
      
      if (isSelfReferral || isOwnCode) {
        console.log(`   ⚠️  THIS WOULD BE BLOCKED by validation logic!`)
      }
    }
    
    // 8. Summary
    console.log('\n' + '='.repeat(80))
    console.log('📊 SUMMARY:')
    console.log('='.repeat(80))
    
    if (customer && customer.length > 0 && customer[0].first_payment_completed) {
      console.log('✅ Customer completed first payment')
      
      if (referrer && referrer.length > 0) {
        const r = referrer[0]
        if ((r.total_referrals || 0) === 0 && (r.total_rewards || 0) === 0) {
          console.log('❌ Referrer reward was NOT granted')
          console.log('\n   Possible reasons:')
          console.log('   1. Payment processing failed before referrer reward step')
          console.log('   2. Referrer code lookup failed during payment processing')
          console.log('   3. Gift card creation/loading failed')
          console.log('   4. Self-referral validation blocked it')
          console.log('   5. Error occurred and paymentHadError was set to true')
          console.log('   6. Payment was processed before referrer was activated')
        } else {
          console.log('✅ Referrer reward WAS granted')
        }
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkKateRodgersPayment()

