#!/usr/bin/env node
/**
 * Verify if customers really used their own codes
 * Check timing: when was personal_code set vs when was used_referral_code set
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function verifySelfReferrals() {
  console.log('🔍 Verifying Self-Referral Cases\n')
  console.log('='.repeat(80))
  
  try {
    // Find all potential self-referrals
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
    
    if (!selfReferrals || selfReferrals.length === 0) {
      console.log('✅ No self-referrals found.')
      return
    }
    
    console.log(`\n📋 Found ${selfReferrals.length} potential self-referrals:\n`)
    
    for (const customer of selfReferrals) {
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim()
      console.log(`\n${'='.repeat(80)}`)
      console.log(`\n👤 ${name}`)
      console.log(`   Customer ID: ${customer.square_customer_id}`)
      console.log(`   Email: ${customer.email_address || 'N/A'}`)
      console.log(`   Used code: ${customer.used_referral_code}`)
      console.log(`   Personal code: ${customer.personal_code}`)
      console.log(`   Created: ${customer.created_at}`)
      console.log(`   Updated: ${customer.updated_at}`)
      
      // Check giftcard_jobs to see when the code was used
      const jobs = await prisma.$queryRaw`
        SELECT 
          id,
          stage,
          status,
          created_at,
          updated_at,
          context
        FROM giftcard_jobs
        WHERE correlation_id LIKE ${`%${customer.square_customer_id}%`}
          AND stage IN ('booking', 'friend_reward')
        ORDER BY created_at ASC
        LIMIT 5
      `
      
      if (jobs && jobs.length > 0) {
        console.log(`\n   📅 Gift Card Job History:`)
        jobs.forEach((job, idx) => {
          console.log(`      ${idx + 1}. Stage: ${job.stage}, Status: ${job.status}`)
          console.log(`         Created: ${job.created_at}`)
          if (job.status === 'completed') {
            console.log(`         Completed: ${job.updated_at}`)
          }
        })
      }
      
      // Note: ref_matches table has been removed
      // Referral matching is now tracked via square_existing_clients.used_referral_code
      const refMatches = []
      
      if (false) { // Always skip this section since table is removed
        console.log(`\n   📅 Referral Code Matches:`)
        refMatches.forEach((match, idx) => {
          console.log(`      ${idx + 1}. Code: ${match.refCode}`)
          console.log(`         Matched at: ${match.matchedAt}`)
          console.log(`         Matched via: ${match.matchedVia || 'N/A'}`)
          console.log(`         Booking ID: ${match.bookingId || 'N/A'}`)
        })
      }
      
      // Check when personal_code was first set
      // We can't track this directly, but we can check if they were activated as referrer
      const referrerActivation = await prisma.$queryRaw`
        SELECT 
          activated_as_referrer,
          referral_email_sent,
          email_sent_at
        FROM square_existing_clients
        WHERE square_customer_id = ${customer.square_customer_id}
      `
      
      if (referrerActivation && referrerActivation.length > 0) {
        const ref = referrerActivation[0]
        console.log(`\n   🎯 Referrer Status:`)
        console.log(`      Activated as referrer: ${ref.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
        console.log(`      Referral email sent: ${ref.referral_email_sent ? '✅ Yes' : '❌ No'}`)
        if (ref.email_sent_at) {
          console.log(`      Email sent at: ${ref.email_sent_at}`)
        }
      }
      
      // Analysis
      console.log(`\n   🔍 ANALYSIS:`)
      
      // Check if personal_code was set before or after used_referral_code
      // If customer was created with personal_code, it might have been set before
      // If they got it after first payment, it was set after
      
      const createdAt = new Date(customer.created_at)
      const updatedAt = new Date(customer.updated_at)
      
      if (customer.first_payment_completed) {
        console.log(`      ⚠️  Customer completed first payment`)
        console.log(`      💡 Personal code is typically assigned AFTER first payment`)
        console.log(`      💡 But used_referral_code is set when booking is created`)
        console.log(`      ⚠️  This suggests they used their code BEFORE getting it assigned!`)
        console.log(`      ⚠️  This is IMPOSSIBLE - they must have used someone else's code`)
        console.log(`      ⚠️  OR the personal_code was incorrectly matched`)
      } else {
        console.log(`      ℹ️  Customer hasn't completed first payment yet`)
        console.log(`      💡 Personal code might have been set manually or incorrectly`)
      }
      
      // Check if there's another customer with this code
      const otherCustomer = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          personal_code,
          activated_as_referrer,
          created_at
        FROM square_existing_clients
        WHERE UPPER(TRIM(personal_code)) = UPPER(TRIM(${customer.used_referral_code}))
          AND square_customer_id != ${customer.square_customer_id}
        LIMIT 1
      `
      
      if (otherCustomer && otherCustomer.length > 0) {
        const other = otherCustomer[0]
        const otherName = `${other.given_name || ''} ${other.family_name || ''}`.trim()
        console.log(`\n   ⚠️  IMPORTANT: Found ANOTHER customer with this code!`)
        console.log(`      Other customer: ${otherName} (${other.square_customer_id})`)
        console.log(`      Created: ${other.created_at}`)
        console.log(`      Activated as referrer: ${other.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
        console.log(`      ⚠️  This means ${name} used ${otherName}'s code, NOT their own!`)
        console.log(`      ⚠️  This is NOT a self-referral - it's a valid referral!`)
      } else {
        console.log(`\n   ✅ No other customer found with this code`)
        console.log(`      This confirms it's a self-referral`)
      }
    }
    
    console.log(`\n${'='.repeat(80)}`)
    console.log('\n✅ Verification complete\n')
    
  } catch (error) {
    console.error('\n❌ Error verifying self-referrals:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  verifySelfReferrals()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

module.exports = { verifySelfReferrals }



