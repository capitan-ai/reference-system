#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkAbyBooking() {
  try {
    console.log('🎯 STEP 2: Checking Aby\'s Booking and Gift Card')
    console.log('=' .repeat(80))
    
    // Search for recent customers (last 10 minutes)
    console.log('\n📍 Searching for Aby in database...')
    
    const recentCustomers = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, phone_number,
             personal_code, activated_as_referrer, got_signup_bonus, gift_card_id, 
             used_referral_code, created_at
      FROM square_existing_clients 
      WHERE created_at > NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC
      LIMIT 10
    `
    
    console.log(`\n✅ Found ${recentCustomers.length} recent customer(s):`)
    
    if (recentCustomers.length === 0) {
      console.log('\n❌ No recent customers found in last 10 minutes')
      console.log('\nPossible reasons:')
      console.log('1. Webhook not fired yet (wait 1-2 minutes)')
      console.log('2. Webhook not configured in Square')
      console.log('3. Customer already existed in database')
      console.log('\nLet me search for ANY customer named Aby...')
      
      const abyResults = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, phone_number,
               personal_code, activated_as_referrer, got_signup_bonus, gift_card_id, 
               used_referral_code, created_at
        FROM square_existing_clients 
        WHERE given_name ILIKE '%aby%'
        ORDER BY created_at DESC
        LIMIT 5
      `
      
      if (abyResults.length > 0) {
        console.log(`\n✅ Found ${abyResults.length} customer(s) with "Aby":`)
        abyResults.forEach((customer, index) => {
          console.log(`\n${index + 1}. ${customer.given_name} ${customer.family_name}`)
          console.log(`   Email: ${customer.email_address}`)
          console.log(`   Phone: ${customer.phone_number}`)
          console.log(`   Customer ID: ${customer.square_customer_id}`)
          console.log(`   Created: ${customer.created_at}`)
          console.log(`   Used Referral Code: ${customer.used_referral_code || 'NONE'}`)
          console.log(`   Got Signup Bonus: ${customer.got_signup_bonus ? 'YES ✅' : 'NO ❌'}`)
          console.log(`   Gift Card ID: ${customer.gift_card_id || 'NONE'}`)
        })
      } else {
        console.log('\n❌ No customer named Aby found in database')
        console.log('\nPlease check:')
        console.log('1. Did booking complete in Square?')
        console.log('2. What name was used for the booking?')
        console.log('3. Check webhook logs: vercel logs --follow')
      }
      
      return
    }
    
    recentCustomers.forEach((customer, index) => {
      console.log(`\n${index + 1}. ${customer.given_name} ${customer.family_name}`)
      console.log(`   Email: ${customer.email_address}`)
      console.log(`   Phone: ${customer.phone_number}`)
      console.log(`   Customer ID: ${customer.square_customer_id}`)
      console.log(`   Created: ${customer.created_at}`)
      console.log(`   Used Referral Code: ${customer.used_referral_code || 'NONE ❌'}`)
      console.log(`   Got Signup Bonus: ${customer.got_signup_bonus ? 'YES ✅' : 'NO ❌'}`)
      console.log(`   Gift Card ID: ${customer.gift_card_id || 'NONE ❌'}`)
    })
    
    // Check if Umi's code was used
    const abyWithCode = recentCustomers.find(c => c.used_referral_code === 'CUST_MHA4LEYB5ERA')
    
    if (abyWithCode) {
      console.log('\n' + '=' .repeat(80))
      console.log('✅ FOUND ABY WHO USED UMI\'S CODE!')
      console.log('=' .repeat(80))
      console.log(`   Name: ${abyWithCode.given_name} ${abyWithCode.family_name}`)
      console.log(`   Used Code: ${abyWithCode.used_referral_code}`)
      console.log(`   Got $10 Gift Card: ${abyWithCode.got_signup_bonus ? 'YES ✅' : 'NO ❌'}`)
      console.log(`   Gift Card ID: ${abyWithCode.gift_card_id || 'NOT CREATED YET ❌'}`)
      console.log('=' .repeat(80))
      
      if (abyWithCode.got_signup_bonus && abyWithCode.gift_card_id) {
        console.log('\n✅ STEP 2 COMPLETE!')
        console.log('\n📝 NEXT STEP:')
        console.log('=' .repeat(80))
        console.log('Aby should now:')
        console.log('   1. Use the $10 gift card to pay for the service')
        console.log('   2. Complete the payment in Square')
        console.log('')
        console.log('After payment completes, the system will:')
        console.log('   - Give Umi $10 as referrer reward')
        console.log('   - Give Aby their own referral code')
        console.log('   - Send Aby an email with their code')
        console.log('')
        console.log('After payment, run:')
        console.log('   node scripts/test-step-3-check-payment.js')
        console.log('=' .repeat(80))
      } else {
        console.log('\n⚠️ ISSUE: Gift card not created yet')
        console.log('\nThis means booking.created webhook may not have fired.')
        console.log('Check webhook logs: vercel logs --follow')
      }
    } else {
      console.log('\n⚠️ No customer found using Umi\'s code: CUST_MHA4LEYB5ERA')
      console.log('\nPlease verify:')
      console.log('1. Did Aby enter the referral code when booking?')
      console.log('2. Is the code in Square custom attributes?')
      console.log('3. Check webhook logs for booking.created event')
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkAbyBooking()
