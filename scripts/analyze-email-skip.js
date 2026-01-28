#!/usr/bin/env node
/**
 * Analyze why email was skipped based on code logic and database data
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const CUSTOMER_ID = '5Q1A2BG073YPWP8G6H0FGQE9VG'
const GIFT_CARD_ID = 'gftc:469e17f9f6f04d649ca31a668fbb23d0'

async function analyzeEmailSkip() {
  console.log('🔍 Analyzing Email Skip Reason - Code Logic Analysis')
  console.log('='.repeat(70))
  console.log('')

  try {
    // Get customer data
    const customer = await prisma.$queryRaw`
      SELECT 
        email_address,
        gift_card_id,
        gift_card_gan,
        gift_card_delivery_channel,
        got_signup_bonus
      FROM square_existing_clients
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    
    const cust = customer[0]
    
    console.log('1️⃣ Database Record Analysis')
    console.log('='.repeat(70))
    console.log(`   Email: ${cust.email_address || 'MISSING'}`)
    console.log(`   Gift Card ID: ${cust.gift_card_id || 'MISSING'}`)
    console.log(`   GAN: ${cust.gift_card_gan || 'MISSING'}`)
    console.log(`   Delivery Channel: ${cust.gift_card_delivery_channel || 'MISSING'}`)
    console.log(`   Got Signup Bonus: ${cust.got_signup_bonus}`)
    console.log('')

    console.log('2️⃣ Code Flow Analysis')
    console.log('='.repeat(70))
    console.log('   In processBookingCreated() function:')
    console.log('')
    console.log('   Line 2833: const friendGiftCard = await createGiftCard(...)')
    console.log('   Line 2836: rewardAmountCents = 1000  // $10')
    console.log('')
    console.log('   Line 2880-2884: Email sending call')
    console.log('   ```javascript')
    console.log('   await sendGiftCardEmailNotification({')
    console.log('     amountCents: friendGiftCard.amountCents,  // Line 2884')
    console.log('     ...')
    console.log('   })')
    console.log('   ```')
    console.log('')

    console.log('3️⃣ createGiftCard() Return Value Analysis')
    console.log('='.repeat(70))
    console.log('   From route.js line 1134-1144:')
    console.log('   ```javascript')
    console.log('   return {')
    console.log('     amountCents: amountMoney.amount,  // Line 1144')
    console.log('     balanceCents: activityBalanceNumber,  // Line 1143')
    console.log('     ...')
    console.log('   }')
    console.log('   ```')
    console.log('')
    console.log('   Key variables:')
    console.log('   - amountMoney.amount = rewardAmountCents (1000)')
    console.log('   - activityBalanceNumber = balance from activation activity')
    console.log('')

    console.log('4️⃣ Email Skip Logic (route.js line 386-389)')
    console.log('='.repeat(70))
    console.log('   ```javascript')
    console.log('   const meaningfulAmount = Number.isFinite(amountCents) ? amountCents : 0')
    console.log('   if (!isReminder && meaningfulAmount <= 0) {')
    console.log('     console.log("ℹ️ Gift card amount is zero, skipping issuance email")')
    console.log('     return { success: false, skipped: true, reason: "zero-amount" }')
    console.log('   }')
    console.log('   ```')
    console.log('')

    console.log('5️⃣ ROOT CAUSE ANALYSIS')
    console.log('='.repeat(70))
    console.log('')
    
    // Analyze based on delivery channel
    if (cust.gift_card_delivery_channel === 'owner_funded_activate') {
      console.log('   Delivery Channel: owner_funded_activate')
      console.log('   → Gift card was activated using OWNER_FUNDED method')
      console.log('   → This happens in createGiftCard() line 980-1020')
      console.log('')
      console.log('   The activation flow:')
      console.log('   1. Gift card created (state: PENDING)')
      console.log('   2. ACTIVATE activity created with amountMoney = { amount: 1000 }')
      console.log('   3. activityBalanceNumber set from activity.giftCardBalanceMoney.amount')
      console.log('   4. If activity balance is 0, then activityBalanceNumber = 0')
      console.log('')
      console.log('   CRITICAL ISSUE:')
      console.log('   → amountCents is ALWAYS set to amountMoney.amount (1000)')
      console.log('   → BUT if activation FAILED, activityBalanceNumber = 0')
      console.log('   → However, amountCents is still 1000, so email should NOT be skipped!')
      console.log('')
      console.log('   UNLESS...')
      console.log('   → If createGiftCard() returned null or undefined')
      console.log('   → Or if friendGiftCard.amountCents was undefined')
      console.log('   → Or if there was an error before reaching email sending code')
    }
    
    console.log('')
    console.log('6️⃣ EXACT REASON IDENTIFIED')
    console.log('='.repeat(70))
    console.log('')
    
    if (!cust.email_address) {
      console.log('❌ REASON: Missing email address')
      console.log('   → Line 2878: friendEmail would be null')
      console.log('   → Line 2879: if (friendEmail) check fails')
      console.log('   → Line 2897: "⚠️ Friend gift card email skipped – missing email address"')
    } else if (!cust.gift_card_gan) {
      console.log('❌ REASON: Missing gift card GAN')
      console.log('   → Line 381-383: GAN check fails')
      console.log('   → "⚠️ Skipping gift card email – card number missing"')
    } else {
      console.log('🔴 MOST LIKELY REASON: amountCents was 0 or undefined')
      console.log('')
      console.log('   Scenario 1: Activation failed completely')
      console.log('   → createGiftCard() might have returned amountCents = 0')
      console.log('   → If amountMoney.amount was somehow 0 (shouldn\'t happen)')
      console.log('')
      console.log('   Scenario 2: giftCardActivity was null')
      console.log('   → Line 1000-1014: If activation response missing activity')
      console.log('   → activityBalanceNumber remains 0')
      console.log('   → BUT amountCents should still be 1000!')
      console.log('')
      console.log('   Scenario 3: friendGiftCard was null or incomplete')
      console.log('   → Line 2841: if (friendGiftCard?.giftCardId)')
      console.log('   → If createGiftCard() returned null, email code never executes')
      console.log('')
      console.log('   Scenario 4: waitForPassKitUrl timeout/error')
      console.log('   → Line 427-429: If waitForPassKitUrl fails')
      console.log('   → Email might not be sent if error is thrown')
      console.log('')
      console.log('   ⚠️  Need to verify actual gift card balance to confirm!')
    }
    
    console.log('')
    console.log('7️⃣ SOLUTION')
    console.log('='.repeat(70))
    console.log('')
    console.log('   To determine exact reason, need to:')
    console.log('   1. Check gift card balance from Square API')
    console.log('   2. Check application logs for booking timestamp: 2026-01-15T22:00:32.872Z')
    console.log('   3. Look for these log messages:')
    console.log('      - "✅ Friend received $10 gift card IMMEDIATELY"')
    console.log('      - "⚠️ Friend gift card email skipped"')
    console.log('      - "ℹ️ Gift card amount is zero, skipping issuance email"')
    console.log('      - "waitForPassKitUrl" errors')
    console.log('')
    console.log('   Manual fix:')
    console.log('   1. Verify gift card balance via Square dashboard')
    console.log('   2. If balance is $0, manually activate using loadGiftCard()')
    console.log('   3. Manually send email using existing email sending scripts')
    
    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error:', error.message)
    await prisma.$disconnect()
  }
}

analyzeEmailSkip()




