#!/usr/bin/env node
/**
 * Check Lindsey Fenner's specific case
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')

async function checkLindseyFenner() {
  console.log('🔍 Checking Lindsey Fenner\'s case...\n')
  
  const phoneNumber = '+18156009303'
  
  // Find customer by phone number
  const customer = await prisma.$queryRaw`
    SELECT 
      square_customer_id,
      given_name,
      family_name,
      email_address,
      phone_number,
      got_signup_bonus,
      used_referral_code,
      gift_card_id,
      personal_code,
      activated_as_referrer,
      first_payment_completed,
      created_at,
      updated_at
    FROM square_existing_clients
    WHERE phone_number = ${phoneNumber}
       OR phone_number = ${phoneNumber.replace('+', '')}
       OR phone_number = ${phoneNumber.replace('+1', '1')}
       OR phone_number = ${phoneNumber.replace('+1', '')}
    LIMIT 1
  `
  
  if (!customer || customer.length === 0) {
    console.log('❌ Customer not found with phone number:', phoneNumber)
    await prisma.$disconnect()
    return
  }
  
  const lindsey = customer[0]
  console.log(`✅ Found customer: ${lindsey.given_name} ${lindsey.family_name}`)
  console.log(`   Customer ID: ${lindsey.square_customer_id}`)
  console.log(`   Phone: ${lindsey.phone_number}`)
  console.log(`   Email: ${lindsey.email_address || 'N/A'}`)
  console.log(`   Personal Code: ${lindsey.personal_code || 'N/A'}`)
  console.log(`   Used Referral Code: ${lindsey.used_referral_code || 'NULL'}`)
  console.log(`   Got Signup Bonus: ${lindsey.got_signup_bonus || false}`)
  console.log(`   Gift Card ID: ${lindsey.gift_card_id || 'N/A'}`)
  console.log(`   First Payment Completed: ${lindsey.first_payment_completed || false}`)
  console.log(`   Activated as Referrer: ${lindsey.activated_as_referrer || false}`)
  console.log(`   Created At: ${lindsey.created_at}`)
  console.log(`   Updated At: ${lindsey.updated_at}`)
  console.log('')
  
  // Check if she used her own personal code
  if (lindsey.personal_code && lindsey.used_referral_code) {
    const isSelfReferral = lindsey.personal_code.toUpperCase().trim() === lindsey.used_referral_code.toUpperCase().trim()
    console.log(`🔍 Self-Referral Check:`)
    console.log(`   Personal Code: ${lindsey.personal_code}`)
    console.log(`   Used Referral Code: ${lindsey.used_referral_code}`)
    console.log(`   Is Self-Referral: ${isSelfReferral ? '❌ YES' : '✅ NO'}`)
    console.log('')
  }
  
  // Check ReferralReward records
  const referralRewards = await prisma.referralReward.findMany({
    where: {
      OR: [
        { referrer_customer_id: lindsey.square_customer_id },
        { referred_customer_id: lindsey.square_customer_id }
      ]
    },
    orderBy: {
      created_at: 'desc'
    }
  })
  
  console.log(`📊 ReferralReward Records: ${referralRewards.length}`)
  if (referralRewards.length > 0) {
    referralRewards.forEach((reward, idx) => {
      console.log(`   ${idx + 1}. ${reward.reward_type} - $${reward.reward_amount_cents / 100}`)
      console.log(`      Referrer: ${reward.referrer_customer_id}`)
      console.log(`      Referred: ${reward.referred_customer_id}`)
      console.log(`      Status: ${reward.status}`)
      console.log(`      Created: ${reward.created_at}`)
      console.log('')
    })
  } else {
    console.log('   ❌ No ReferralReward records found')
    console.log('')
  }
  
  // Check gift card in database
  if (lindsey.gift_card_id) {
    const giftCard = await prisma.giftCard.findFirst({
      where: {
        square_gift_card_id: lindsey.gift_card_id
      }
    })
    
    if (giftCard) {
      console.log(`📊 Gift Card Record:`)
      console.log(`   ID: ${giftCard.id}`)
      console.log(`   Square Gift Card ID: ${giftCard.square_gift_card_id}`)
      console.log(`   Reward Type: ${giftCard.reward_type}`)
      console.log(`   Initial Amount: $${giftCard.initial_amount_cents / 100}`)
      console.log(`   Current Balance: $${giftCard.current_balance_cents / 100}`)
      console.log(`   Created: ${giftCard.created_at}`)
      console.log('')
    } else {
      console.log(`⚠️ Gift card ${lindsey.gift_card_id} not found in gift_card table`)
      console.log('')
    }
  }
  
  // Check if this is the inconsistent case
  const isInconsistent = lindsey.got_signup_bonus && (!lindsey.used_referral_code || lindsey.used_referral_code === '')
  const isSelfReferral = lindsey.personal_code && lindsey.used_referral_code && 
                         lindsey.personal_code.toUpperCase().trim() === lindsey.used_referral_code.toUpperCase().trim()
  const shouldNotHaveBonus = lindsey.first_payment_completed || isSelfReferral
  
  console.log(`📋 Analysis:`)
  console.log(`   Is Inconsistent (got_signup_bonus=true but used_referral_code=null): ${isInconsistent ? '❌ YES' : '✅ NO'}`)
  console.log(`   Is Self-Referral: ${isSelfReferral ? '❌ YES' : '✅ NO'}`)
  console.log(`   Should NOT Have Bonus (first_payment_completed=true or self-referral): ${shouldNotHaveBonus ? '❌ YES' : '✅ NO'}`)
  console.log('')
  
  if (isInconsistent || shouldNotHaveBonus) {
    console.log(`⚠️ ISSUE DETECTED:`)
    if (isInconsistent) {
      console.log(`   - got_signup_bonus=true but used_referral_code is null`)
    }
    if (isSelfReferral) {
      console.log(`   - Customer used their own personal code (self-referral)`)
    }
    if (lindsey.first_payment_completed) {
      console.log(`   - Customer already completed first payment (existing customer)`)
    }
    console.log('')
  }
  
  await prisma.$disconnect()
}

checkLindseyFenner().catch(console.error)



