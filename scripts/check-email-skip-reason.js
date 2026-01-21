#!/usr/bin/env node
/**
 * Check exact reason why email was skipped and gift card amount
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

// Verify environment variable is loaded
if (!process.env.SQUARE_ACCESS_TOKEN) {
  console.error('❌ SQUARE_ACCESS_TOKEN not found in environment variables')
  process.exit(1)
}

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN.trim(),
  environment: Environment.Production,
})

const giftCardsApi = squareClient.giftCardsApi

console.log('✅ Square API client initialized')
console.log(`   Access Token: ${process.env.SQUARE_ACCESS_TOKEN.substring(0, 10)}...`)

const CUSTOMER_ID = '5Q1A2BG073YPWP8G6H0FGQE9VG'
const GIFT_CARD_ID = 'gftc:469e17f9f6f04d649ca31a668fbb23d0'

async function checkEmailSkipReason() {
  console.log('🔍 Checking Gift Card Amount & Email Skip Reason')
  console.log('='.repeat(70))
  console.log('')

  try {
    // Step 1: Get gift card balance from Square API
    console.log('1️⃣ Checking Gift Card Balance from Square API...')
    let squareBalance = null
    let squareState = null
    let activationAmount = null
    
    try {
      const giftCardResponse = await giftCardsApi.retrieveGiftCard(GIFT_CARD_ID)
      const giftCard = giftCardResponse.result.giftCard
      
      if (giftCard) {
        squareBalance = giftCard.balanceMoney?.amount || 0
        squareState = giftCard.state
        
        console.log(`   ✅ Gift Card Found:`)
        console.log(`      - Balance: $${(squareBalance / 100).toFixed(2)}`)
        console.log(`      - State: ${squareState}`)
        console.log(`      - GAN: ${giftCard.gan}`)
        console.log('')

        // Get activities to see activation amount
        const activitiesResponse = await giftCardsApi.listGiftCardActivities(GIFT_CARD_ID, {})
        if (activitiesResponse.result?.giftCardActivities) {
          const activities = activitiesResponse.result.giftCardActivities
          console.log(`   📋 Activities (${activities.length}):`)
          
          for (const activity of activities) {
            console.log(`      - Type: ${activity.type}, Created: ${activity.createdAt}`)
            
            if (activity.type === 'ACTIVATE' && activity.activateActivityDetails) {
              activationAmount = activity.activateActivityDetails.amountMoney?.amount || 0
              console.log(`        → Activation Amount: $${(activationAmount / 100).toFixed(2)}`)
            }
            
            if (activity.type === 'ADJUST_INCREMENT' && activity.adjustIncrementActivityDetails) {
              const adjustAmount = activity.adjustIncrementActivityDetails.amountMoney?.amount || 0
              console.log(`        → Adjust Amount: $${(adjustAmount / 100).toFixed(2)}`)
            }
          }
        }
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`)
    }
    console.log('')

    // Step 2: Analyze what createGiftCard would have returned
    console.log('2️⃣ Analyzing createGiftCard Return Value...')
    console.log('   Code flow:')
    console.log('   ```')
    console.log('   const friendGiftCard = await createGiftCard(...)')
    console.log('   // Returns: { amountCents: amountMoney.amount, balanceCents: activityBalanceNumber }')
    console.log('   ```')
    console.log('')
    console.log('   Expected values:')
    console.log('   - amountCents: 1000 (from rewardAmountCents parameter)')
    console.log('   - balanceCents: activityBalanceNumber (from activation activity)')
    console.log('')
    
    // What would have been returned
    const expectedAmountCents = 1000
    const actualBalanceCents = squareBalance
    
    console.log('   Actual values (from Square API):')
    console.log(`   - Square Balance: ${squareBalance !== null ? `$${(squareBalance / 100).toFixed(2)}` : 'Could not verify'}`)
    console.log(`   - Activation Amount: ${activationAmount !== null ? `$${(activationAmount / 100).toFixed(2)}` : 'N/A'}`)
    console.log('')

    // Step 3: Check email skip logic
    console.log('3️⃣ Email Skip Logic Analysis')
    console.log('='.repeat(70))
    console.log('   Code in sendGiftCardEmailNotification (line 386-389):')
    console.log('   ```javascript')
    console.log('   const meaningfulAmount = Number.isFinite(amountCents) ? amountCents : 0')
    console.log('   if (!isReminder && meaningfulAmount <= 0) {')
    console.log('     console.log("ℹ️ Gift card amount is zero, skipping issuance email")')
    console.log('     return { success: false, skipped: true, reason: "zero-amount" }')
    console.log('   }')
    console.log('   ```')
    console.log('')
    console.log('   Called with:')
    console.log('   ```javascript')
    console.log('   await sendGiftCardEmailNotification({')
    console.log('     amountCents: friendGiftCard.amountCents,  // Line 2884')
    console.log('     ...')
    console.log('   })')
    console.log('   ```')
    console.log('')

    // Step 4: Determine the exact reason
    console.log('4️⃣ ROOT CAUSE ANALYSIS')
    console.log('='.repeat(70))
    
    if (squareBalance === null) {
      console.log('❌ Cannot determine - Square API check failed')
    } else if (squareBalance === 0) {
      console.log('🔴 ROOT CAUSE IDENTIFIED: Gift Card Balance is $0.00')
      console.log('')
      console.log('   What happened:')
      console.log('   1. createGiftCard() was called with amountCents = 1000')
      console.log('   2. Gift card was created successfully (giftCardId exists)')
      console.log('   3. BUT activation activity FAILED or returned balance = 0')
      console.log('   4. createGiftCard() returned:')
      console.log('      - amountCents: 1000 (from parameter)')
      console.log('      - balanceCents: 0 (from failed activation)')
      console.log('   5. However, if activation failed completely, amountCents might also be 0')
      console.log('')
      console.log('   Why email was skipped:')
      if (activationAmount === 0 || activationAmount === null) {
        console.log('   → Activation activity amount was $0.00 or missing')
        console.log('   → This means activityBalanceNumber = 0 in createGiftCard()')
        console.log('   → If amountMoney.amount was also 0 (shouldn\'t happen), amountCents = 0')
        console.log('   → Email function checked: meaningfulAmount <= 0 → SKIPPED')
      } else {
        console.log('   → Even though activation amount exists, balance is 0')
        console.log('   → This suggests activation failed after activity was created')
      }
    } else if (squareBalance === 1000) {
      console.log('🟡 ROOT CAUSE: Gift Card HAS $10.00, but email still skipped')
      console.log('')
      console.log('   What happened:')
      console.log('   1. Gift card was created and activated with $10.00 ✅')
      console.log('   2. createGiftCard() should have returned:')
      console.log('      - amountCents: 1000')
      console.log('      - balanceCents: 1000')
      console.log('   3. BUT email was still not sent')
      console.log('')
      console.log('   Possible reasons email was skipped:')
      console.log('   → amountCents parameter was undefined/null when passed to email function')
      console.log('   → waitForPassKitUrl() threw an error before email sending')
      console.log('   → Email sending failed silently (SendGrid error)')
      console.log('   → Notification event creation failed')
    } else {
      console.log(`⚠️  Gift card has $${(squareBalance / 100).toFixed(2)} (unexpected amount)`)
    }
    
    console.log('')
    
    // Step 5: Check what the actual issue is
    console.log('5️⃣ Verification of Email Skip Conditions')
    console.log('='.repeat(70))
    
    const customer = await prisma.$queryRaw`
      SELECT email_address, gift_card_gan
      FROM square_existing_clients
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    const cust = customer[0]
    
    console.log('   Preconditions check:')
    console.log(`   - Email exists: ${cust.email_address ? '✅ YES' : '❌ NO'}`)
    console.log(`   - GAN exists: ${cust.gift_card_gan ? '✅ YES' : '❌ NO'}`)
    console.log(`   - Gift card balance: ${squareBalance !== null ? `$${(squareBalance / 100).toFixed(2)}` : '❌ UNKNOWN'}`)
    console.log('')
    
    if (!cust.email_address) {
      console.log('   ❌ Email would be skipped: missing email address')
    } else if (!cust.gift_card_gan) {
      console.log('   ❌ Email would be skipped: missing GAN')
    } else if (squareBalance === 0) {
      console.log('   ❌ Email would be skipped: amountCents = 0 (because balance = 0)')
      console.log('   → This is the EXACT reason!')
    } else if (squareBalance === 1000) {
      console.log('   ⚠️  All preconditions met, but email still not sent')
      console.log('   → Check application logs for:')
      console.log('      - "waitForPassKitUrl" errors')
      console.log('      - SendGrid API errors')
      console.log('      - "Error sending gift card email"')
    }
    
    console.log('')
    console.log('6️⃣ SUMMARY')
    console.log('='.repeat(70))
    
    if (squareBalance === 0) {
      console.log('✅ EXACT REASON FOUND:')
      console.log('   Gift card was created but NOT loaded with $10.00')
      console.log('   → amountCents in createGiftCard return was likely 0 or undefined')
      console.log('   → Email function correctly skipped: meaningfulAmount <= 0')
      console.log('')
      console.log('   Solution: Manually activate gift card and send email')
    } else if (squareBalance === 1000) {
      console.log('✅ Gift card balance is correct ($10.00)')
      console.log('   → Email skip reason is different - check logs for:')
      console.log('      - PassKit URL timeout')
      console.log('      - SendGrid errors')
      console.log('      - Silent failures in email sending')
    } else {
      console.log('⚠️  Could not verify balance - check Square API connection')
    }
    
    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
    await prisma.$disconnect()
  }
}

checkEmailSkipReason()

