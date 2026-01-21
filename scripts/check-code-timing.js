#!/usr/bin/env node
/**
 * Check timing of when personal_code was set vs when used_referral_code was used
 * This will help determine if they really used their own codes
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkCodeTiming() {
  console.log('🕐 Checking Code Timing for Self-Referrals\n')
  console.log('='.repeat(80))
  
  try {
    const selfReferrals = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        used_referral_code,
        personal_code,
        first_payment_completed,
        got_signup_bonus,
        gift_card_id,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE used_referral_code IS NOT NULL
        AND used_referral_code != ''
        AND personal_code IS NOT NULL
        AND personal_code != ''
        AND UPPER(TRIM(used_referral_code)) = UPPER(TRIM(personal_code))
      ORDER BY created_at
    `
    
    for (const customer of selfReferrals) {
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim()
      console.log(`\n${'='.repeat(80)}`)
      console.log(`\n👤 ${name} (${customer.square_customer_id})`)
      console.log(`   Code: ${customer.used_referral_code}`)
      
      // Check when the code was first used (from ref_matches or giftcard_jobs)
      const firstMatch = await prisma.$queryRaw`
        SELECT 
          "matchedAt",
          "createdAt",
          "matchedVia",
          "bookingId"
        FROM ref_matches
        WHERE "customerId" = ${customer.square_customer_id}
          AND "refCode" = ${customer.used_referral_code}
        ORDER BY "matchedAt" ASC
        LIMIT 1
      `
      
      const firstJob = await prisma.$queryRaw`
        SELECT 
          created_at,
          updated_at,
          stage,
          status
        FROM giftcard_jobs
        WHERE correlation_id LIKE ${`%${customer.square_customer_id}%`}
          AND stage = 'friend_reward'
        ORDER BY created_at ASC
        LIMIT 1
      `
      
      // Check when they became a referrer (when personal_code was likely set)
      // This happens after first payment completion
      const referrerInfo = await prisma.$queryRaw`
        SELECT 
          activated_as_referrer,
          referral_email_sent,
          email_sent_at,
          first_payment_completed,
          updated_at
        FROM square_existing_clients
        WHERE square_customer_id = ${customer.square_customer_id}
      `
      
      console.log(`\n   📅 TIMELINE:`)
      console.log(`      Customer created: ${customer.created_at}`)
      
      if (firstMatch && firstMatch.length > 0) {
        const match = firstMatch[0]
        console.log(`      Code first matched: ${match.matchedAt || match.createdAt}`)
        console.log(`         Via: ${match.matchedVia || 'N/A'}`)
        console.log(`         Booking: ${match.bookingId || 'N/A'}`)
      }
      
      if (firstJob && firstJob.length > 0) {
        const job = firstJob[0]
        console.log(`      Friend reward job created: ${job.created_at}`)
        if (job.status === 'completed') {
          console.log(`      Friend reward completed: ${job.updated_at}`)
        }
      }
      
      if (referrerInfo && referrerInfo.length > 0) {
        const ref = referrerInfo[0]
        if (ref.first_payment_completed) {
          console.log(`      First payment completed: ${ref.updated_at || customer.updated_at}`)
        }
        if (ref.activated_as_referrer) {
          console.log(`      Activated as referrer: ${ref.email_sent_at || ref.updated_at || customer.updated_at}`)
          console.log(`         (Personal code assigned around this time)`)
        }
      }
      
      console.log(`      Last updated: ${customer.updated_at}`)
      
      // Analysis
      console.log(`\n   🔍 ANALYSIS:`)
      
      if (firstMatch && firstMatch.length > 0) {
        const matchTime = new Date(firstMatch[0].matchedAt || firstMatch[0].createdAt)
        const customerCreated = new Date(customer.created_at)
        
        // Check if there's a pattern - did they use the code very early?
        const daysBetween = (matchTime - customerCreated) / (1000 * 60 * 60 * 24)
        
        if (daysBetween < 1) {
          console.log(`      ⚠️  Code was used within ${daysBetween.toFixed(1)} days of account creation`)
          console.log(`      ⚠️  This is suspicious - they might have known their code already`)
        }
        
        // Check if personal_code could have existed before they used it
        // We need to check if they were a referrer before using the code
        if (referrerInfo && referrerInfo[0].activated_as_referrer) {
          const activatedTime = referrerInfo[0].email_sent_at 
            ? new Date(referrerInfo[0].email_sent_at)
            : (referrerInfo[0].updated_at ? new Date(referrerInfo[0].updated_at) : null)
          
          if (activatedTime && matchTime < activatedTime) {
            console.log(`      ✅ Code was used BEFORE becoming a referrer`)
            console.log(`      ✅ This means they used someone else's code (or a code that doesn't exist yet)`)
            console.log(`      ⚠️  But personal_code matches - this is a DATA ISSUE!`)
          } else if (activatedTime && matchTime >= activatedTime) {
            console.log(`      ⚠️  Code was used AFTER becoming a referrer`)
            console.log(`      ⚠️  This means they COULD have used their own code`)
            console.log(`      ⚠️  This IS a self-referral!`)
          }
        } else {
          console.log(`      ⚠️  They are not activated as referrer yet`)
          console.log(`      ⚠️  But personal_code exists - this is unusual`)
        }
      }
      
      // Final verdict
      console.log(`\n   🎯 VERDICT:`)
      if (referrerInfo && referrerInfo[0].activated_as_referrer && 
          firstMatch && firstMatch.length > 0) {
        const matchTime = new Date(firstMatch[0].matchedAt || firstMatch[0].createdAt)
        const activatedTime = referrerInfo[0].email_sent_at 
          ? new Date(referrerInfo[0].email_sent_at)
          : (referrerInfo[0].updated_at ? new Date(referrerInfo[0].updated_at) : null)
        
        if (activatedTime && matchTime < activatedTime) {
          console.log(`      ❌ NOT a self-referral - data inconsistency!`)
          console.log(`      ❌ They used code before getting personal_code`)
          console.log(`      ❌ Personal_code was incorrectly matched later`)
        } else if (activatedTime && matchTime >= activatedTime) {
          console.log(`      ✅ CONFIRMED self-referral`)
          console.log(`      ✅ They used their own code after getting it`)
        } else {
          console.log(`      ⚠️  Cannot determine - missing timing data`)
        }
      } else {
        console.log(`      ⚠️  Cannot determine - insufficient data`)
      }
    }
    
    console.log(`\n${'='.repeat(80)}`)
    console.log('\n✅ Timing check complete\n')
    
  } catch (error) {
    console.error('\n❌ Error checking code timing:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkCodeTiming()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { checkCodeTiming }



