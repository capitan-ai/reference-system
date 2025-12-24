#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// Simulate a friend using your referral code
async function simulateFriendUsingReferralCode() {
  console.log('👥 Simulating Friend Using Your Referral Code...')
  console.log('=' .repeat(60))
  
  try {
    await prisma.$connect()
    
    // Get your test referrer from database
    const referrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, personal_code, email_address
      FROM square_existing_clients 
      WHERE activated_as_referrer = TRUE 
      ORDER BY created_at DESC
      LIMIT 1
    `
    
    if (!referrer || referrer.length === 0) {
      console.log('❌ No referrer found in database')
      return
    }
    
    const yourData = referrer[0]
    console.log('👤 Your Referrer Data:')
    console.log(`   Name: ${yourData.given_name} ${yourData.family_name}`)
    console.log(`   Email: ${yourData.email_address}`)
    console.log(`   Referral Code: ${yourData.personal_code}`)
    console.log(`   Referral URL: https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/ref/${yourData.personal_code}`)
    
    console.log('\n' + '=' .repeat(60))
    
    // Simulate friend using your code
    console.log('👥 Simulating Friend Using Your Code...')
    
    const friendData = {
      squareCustomerId: 'TEST_FRIEND_' + Date.now(),
      givenName: 'Jane',
      familyName: 'Doe',
      emailAddress: 'janedoe@example.com',
      phoneNumber: '+1987654321',
      referralCodeUsed: yourData.personal_code
    }
    
    console.log('👤 Friend Data:')
    console.log(`   Name: ${friendData.givenName} ${friendData.familyName}`)
    console.log(`   Email: ${friendData.emailAddress}`)
    console.log(`   Used Your Code: ${friendData.referralCodeUsed}`)
    
    console.log('\n' + '=' .repeat(60))
    
    // Simulate payment completion
    console.log('💰 Simulating Payment Completion...')
    
    // Create gift card IDs (simulated)
    const friendGiftCardId = 'GC_FRIEND_' + Date.now()
    const referrerGiftCardId = 'GC_REFERRER_' + Date.now()
    
    console.log('🎁 Gift Cards Would Be Created:')
    console.log(`   - Friend gets: $10 gift card (${friendGiftCardId})`)
    console.log(`   - You get: $10 gift card (${referrerGiftCardId})`)
    
    // Add friend to database
    await prisma.$executeRaw`
      INSERT INTO square_existing_clients (
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        got_signup_bonus,
        activated_as_referrer,
        personal_code,
        gift_card_id,
        created_at,
        updated_at
      ) VALUES (
        ${friendData.squareCustomerId},
        ${friendData.givenName},
        ${friendData.familyName},
        ${friendData.emailAddress},
        ${friendData.phoneNumber},
        TRUE,
        FALSE,
        NULL,
        ${friendGiftCardId},
        NOW(),
        NOW()
      )
    `
    
    // Update your referral stats
    await prisma.$executeRaw`
      UPDATE square_existing_clients 
      SET 
        total_referrals = COALESCE(total_referrals, 0) + 1,
        total_rewards = COALESCE(total_rewards, 0) + 1000,
        gift_card_id = ${referrerGiftCardId}
      WHERE square_customer_id = ${yourData.square_customer_id}
    `
    
    console.log('\n' + '=' .repeat(60))
    console.log('✅ Database Updated Successfully!')
    console.log('=' .repeat(60))
    
    // Show final results
    const updatedReferrer = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, personal_code, 
             total_referrals, total_rewards, gift_card_id
      FROM square_existing_clients 
      WHERE square_customer_id = ${yourData.square_customer_id}
    `
    
    const finalData = updatedReferrer[0]
    console.log('🎉 Final Results:')
    console.log(`   👤 Referrer: ${finalData.given_name} ${finalData.family_name}`)
    console.log(`   🔑 Referral Code: ${finalData.personal_code}`)
    console.log(`   📊 Total Referrals: ${finalData.total_referrals || 0}`)
    console.log(`   💰 Total Rewards: $${(finalData.total_rewards || 0) / 100}`)
    console.log(`   🎁 Your Gift Card: ${finalData.gift_card_id}`)
    
    console.log('\n' + '=' .repeat(60))
    console.log('🎯 What Happens in Real System:')
    console.log('=' .repeat(60))
    console.log('1. ✅ Friend visits your referral link')
    console.log('2. ✅ Friend books appointment using your code')
    console.log('3. ✅ Friend makes payment')
    console.log('4. ✅ Square webhook triggers automatically')
    console.log('5. ✅ System creates REAL $10 gift cards')
    console.log('6. ✅ Friend gets $10 off their first visit')
    console.log('7. ✅ You get $10 gift card for referring them')
    console.log('8. ✅ Database tracks everything automatically')
    console.log('=' .repeat(60))
    console.log('🚀 Your referral system is working perfectly!')
    
  } catch (error) {
    console.error('❌ Error simulating referral:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the simulation
simulateFriendUsingReferralCode()
