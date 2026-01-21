#!/usr/bin/env node
/**
 * Find all customers who used their own referral code (self-referral abuse)
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function findSelfReferrals() {
  console.log('🔍 Finding All Self-Referral Cases\n')
  console.log('='.repeat(60))
  
  try {
    // Find customers who used their own personal_code
    const selfReferrals = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        personal_code,
        used_referral_code,
        got_signup_bonus,
        gift_card_id,
        gift_card_gan,
        first_payment_completed,
        activated_as_referrer,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE personal_code IS NOT NULL
        AND used_referral_code IS NOT NULL
        AND UPPER(TRIM(personal_code)) = UPPER(TRIM(used_referral_code))
      ORDER BY created_at DESC
    `
    
    if (!selfReferrals || selfReferrals.length === 0) {
      console.log('✅ No self-referrals found!')
      console.log('   All customers used different referral codes')
    } else {
      console.log(`❌ Found ${selfReferrals.length} self-referral case(s):\n`)
      
      let totalGiftCards = 0
      let totalAmount = 0
      
      selfReferrals.forEach((customer, idx) => {
        console.log(`${idx + 1}. ${customer.given_name || ''} ${customer.family_name || ''}`)
        console.log(`   📧 Email: ${customer.email_address}`)
        console.log(`   🆔 Square ID: ${customer.square_customer_id}`)
        console.log(`   💳 Personal Code: ${customer.personal_code}`)
        console.log(`   💳 Used Code: ${customer.used_referral_code}`)
        console.log(`   💳 Gift Card ID: ${customer.gift_card_id || 'N/A'}`)
        console.log(`   💳 Gift Card GAN: ${customer.gift_card_gan || 'N/A'}`)
        console.log(`   📅 Created: ${customer.created_at}`)
        console.log(`   📅 Updated: ${customer.updated_at}`)
        console.log(`   ⚠️  PROBLEM: Customer used their own code!`)
        console.log('')
        
        if (customer.gift_card_id) {
          totalGiftCards++
          totalAmount += 1000 // $10 per gift card
        }
      })
      
      console.log('='.repeat(60))
      console.log('📊 SUMMARY')
      console.log('='.repeat(60))
      console.log(`❌ Total self-referrals: ${selfReferrals.length}`)
      console.log(`💳 Gift cards issued: ${totalGiftCards}`)
      console.log(`💰 Total amount: $${(totalAmount / 100).toFixed(2)}`)
      console.log('\n💡 Recommendation:')
      console.log('   - These are historical cases (before fix)')
      console.log('   - New self-referrals are now blocked automatically')
      console.log('   - Consider reviewing these cases manually')
    }
    
    // Also check for cases where customer ID = referrer ID
    console.log('\n' + '='.repeat(60))
    console.log('🔍 Checking for Customer ID = Referrer ID cases')
    console.log('='.repeat(60))
    
    // This is harder to check directly, but we can check RefMatch table
    const suspiciousMatches = await prisma.$queryRaw`
      SELECT 
        rm."refCode" as ref_code,
        rm."customerId" as customer_id,
        rm."bookingId" as booking_id,
        rm."matchedAt" as matched_at,
        c1."squareCustomerId" as customer_square_id,
        c2."squareCustomerId" as referrer_square_id
      FROM ref_matches rm
      JOIN customers c1 ON rm."customerId" = c1.id
      LEFT JOIN ref_links rl ON rm."refCode" = rl."refCode"
      LEFT JOIN customers c2 ON rl."customerId" = c2.id
      WHERE c1."squareCustomerId" = c2."squareCustomerId"
      ORDER BY rm."matchedAt" DESC
      LIMIT 10
    `
    
    if (suspiciousMatches && suspiciousMatches.length > 0) {
      console.log(`\n⚠️  Found ${suspiciousMatches.length} suspicious match(es) where customer = referrer:\n`)
      suspiciousMatches.forEach((match, idx) => {
        console.log(`${idx + 1}. Booking: ${match.booking_id}`)
        console.log(`   Code: ${match.ref_code}`)
        console.log(`   Customer/Referrer ID: ${match.customer_square_id}`)
        console.log(`   Matched at: ${match.matched_at}`)
        console.log('')
      })
    } else {
      console.log('✅ No suspicious matches found in RefMatch table')
    }
    
  } catch (error) {
    console.error('\n❌ Error finding self-referrals:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

findSelfReferrals()



