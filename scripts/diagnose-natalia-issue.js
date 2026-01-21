#!/usr/bin/env node
/**
 * Diagnose exact reason why email wasn't sent and gift card balance
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const giftCardsApi = squareClient.giftCardsApi

const CUSTOMER_ID = '5Q1A2BG073YPWP8G6H0FGQE9VG'
const GIFT_CARD_ID = 'gftc:469e17f9f6f04d649ca31a668fbb23d0'

async function diagnose() {
  console.log('🔍 Diagnosing Natalia Bijak Gift Card Issue')
  console.log('='.repeat(70))
  console.log('')

  try {
    // Step 1: Check gift card balance from Square
    console.log('1️⃣ Checking Gift Card Balance from Square API...')
    let squareBalance = null
    let squareState = null
    let activities = []
    
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
        
        // Get activities
        const activitiesResponse = await giftCardsApi.listGiftCardActivities(GIFT_CARD_ID, {})
        if (activitiesResponse.result?.giftCardActivities) {
          activities = activitiesResponse.result.giftCardActivities
          console.log(`      - Activities: ${activities.length}`)
          
          if (activities.length > 0) {
            const firstActivity = activities[0]
            console.log(`      - First Activity Type: ${firstActivity.type}`)
            if (firstActivity.activateActivityDetails) {
              const amount = firstActivity.activateActivityDetails.amountMoney?.amount || 0
              console.log(`      - Activation Amount: $${(amount / 100).toFixed(2)}`)
            }
          }
        }
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`)
    }
    console.log('')

    // Step 2: Check database
    console.log('2️⃣ Checking Database Record...')
    const customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        gift_card_id,
        gift_card_gan,
        gift_card_delivery_channel,
        got_signup_bonus
      FROM square_existing_clients
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    
    const cust = customer[0]
    console.log(`   - Email: ${cust.email_address}`)
    console.log(`   - Gift Card ID: ${cust.gift_card_id}`)
    console.log(`   - GAN: ${cust.gift_card_gan}`)
    console.log(`   - Delivery Channel: ${cust.gift_card_delivery_channel}`)
    console.log('')

    // Step 3: Analyze the issue
    console.log('3️⃣ Root Cause Analysis')
    console.log('='.repeat(70))
    
    // Check balance
    if (squareBalance === null) {
      console.log('❌ CRITICAL: Could not verify gift card balance from Square API')
      console.log('   → This prevents us from knowing if $10 was loaded')
    } else if (squareBalance === 0) {
      console.log('❌ PROBLEM FOUND: Gift card balance is $0.00')
      console.log('   → Gift card was created but NOT activated/loaded with $10')
      console.log('   → This explains why email was skipped: amountCents would be 0')
      console.log('')
      console.log('   Possible causes:')
      console.log('   1. Gift card activation activity failed silently')
      console.log('   2. owner_funded_activate failed but error was not caught')
      console.log('   3. ADJUST_INCREMENT fallback also failed')
    } else if (squareBalance === 1000) {
      console.log('✅ Gift card HAS $10.00 loaded correctly')
      console.log('   → Balance is correct, so the issue is with email sending')
      console.log('')
      console.log('   Email issue analysis:')
      console.log(`   - Email exists: ${cust.email_address ? '✅' : '❌'}`)
      console.log(`   - GAN exists: ${cust.gift_card_gan ? '✅' : '❌'}`)
      console.log('   → Email was likely skipped due to:')
      console.log('     1. amountCents parameter was 0 or undefined in createGiftCard return')
      console.log('     2. waitForPassKitUrl timed out/failed')
      console.log('     3. Email sending failed silently')
    } else {
      console.log(`⚠️  Gift card has $${(squareBalance / 100).toFixed(2)} (expected $10.00)`)
    }
    
    console.log('')
    
    // Check activities
    if (activities.length > 0) {
      console.log('4️⃣ Gift Card Activity Analysis')
      console.log('='.repeat(70))
      
      const activationActivity = activities.find(a => a.type === 'ACTIVATE')
      const adjustActivity = activities.find(a => a.type === 'ADJUST_INCREMENT')
      
      if (activationActivity) {
        const amount = activationActivity.activateActivityDetails?.amountMoney?.amount || 0
        console.log(`✅ Found ACTIVATE activity`)
        console.log(`   - Amount: $${(amount / 100).toFixed(2)}`)
        console.log(`   - Created: ${activationActivity.createdAt}`)
        
        if (amount === 0) {
          console.log(`   ❌ PROBLEM: Activation amount is $0.00!`)
        } else if (amount === 1000) {
          console.log(`   ✅ Activation amount is correct: $10.00`)
        }
      } else if (adjustActivity) {
        const amount = adjustActivity.adjustIncrementActivityDetails?.amountMoney?.amount || 0
        console.log(`⚠️  Found ADJUST_INCREMENT activity (fallback method)`)
        console.log(`   - Amount: $${(amount / 100).toFixed(2)}`)
        console.log(`   - Created: ${adjustActivity.createdAt}`)
      } else {
        console.log(`❌ No activation or adjust activities found!`)
        console.log(`   → This confirms gift card was never loaded with money`)
      }
    }
    
    console.log('')
    console.log('5️⃣ Email Skipping Analysis')
    console.log('='.repeat(70))
    
    // The email check code (from route.js line 386-389)
    console.log('   Code check: sendGiftCardEmailNotification')
    console.log('   ```')
    console.log('   const meaningfulAmount = Number.isFinite(amountCents) ? amountCents : 0')
    console.log('   if (!isReminder && meaningfulAmount <= 0) {')
    console.log('     console.log("ℹ️ Gift card amount is zero, skipping issuance email")')
    console.log('     return { success: false, skipped: true, reason: "zero-amount" }')
    console.log('   }')
    console.log('   ```')
    console.log('')
    
    if (squareBalance === 0) {
      console.log('   ❌ ROOT CAUSE IDENTIFIED:')
      console.log('   → giftCard.amountCents was 0 or undefined')
      console.log('   → This happens when activityBalanceNumber = 0 in createGiftCard()')
      console.log('   → Even though giftCardId exists, activation failed silently')
      console.log('   → Email function correctly skipped email because amountCents <= 0')
    } else if (squareBalance === 1000) {
      console.log('   ⚠️  Balance is correct but email still wasn\'t sent')
      console.log('   → Check if amountCents was correctly passed to sendGiftCardEmailNotification')
      console.log('   → Or waitForPassKitUrl might have caused an error')
    }
    
    console.log('')
    console.log('6️⃣ Summary & Recommendations')
    console.log('='.repeat(70))
    
    if (squareBalance === 0) {
      console.log('🔴 CRITICAL ISSUE: Gift card was created but NOT loaded with $10')
      console.log('')
      console.log('   Solution:')
      console.log('   1. Check Square API logs for activation errors')
      console.log('   2. Manually activate the gift card using loadGiftCard()')
      console.log('   3. Then send the email manually')
    } else if (squareBalance === 1000) {
      console.log('🟡 PARTIAL ISSUE: Gift card loaded correctly but email not sent')
      console.log('')
      console.log('   Solution:')
      console.log('   1. Manually send the email using existing scripts')
      console.log('   2. Check Vercel logs around booking timestamp for email errors')
    } else {
      console.log('⚠️  Unable to determine issue - check Square API connection')
    }
    
    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
    await prisma.$disconnect()
  }
}

diagnose()


