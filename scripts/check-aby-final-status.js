#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkAbyStatus() {
  try {
    console.log('🔍 Checking Aby\'s status after booking...')
    console.log('=' .repeat(80))
    
    // Find Aby
    const aby = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, phone_number,
             got_signup_bonus, gift_card_id, used_referral_code, activated_as_referrer,
             personal_code, first_payment_completed, created_at, updated_at
      FROM square_existing_clients 
      WHERE square_customer_id = 'Y4BV3AGY3NXYCK63PA4ZA2ZJ14'
    `
    
    if (!aby || aby.length === 0) {
      console.log('❌ Aby not found in database')
      return
    }
    
    const customer = aby[0]
    
    console.log('\n👤 Customer:')
    console.log(`   Name: ${customer.given_name} ${customer.family_name}`)
    console.log(`   Phone: ${customer.phone_number}`)
    console.log(`   Email: ${customer.email_address || 'None'}`)
    
    console.log('\n🎁 Gift Card Status:')
    console.log(`   Got $10 Gift Card: ${customer.got_signup_bonus ? 'YES ✅' : 'NO ❌'}`)
    console.log(`   Gift Card ID: ${customer.gift_card_id || 'NONE'}`)
    
    console.log('\n🎯 Referral Code Status:')
    console.log(`   Used Referral Code: ${customer.used_referral_code || 'NONE'}`)
    console.log(`   Has Own Code: ${customer.personal_code ? 'YES - ' + customer.personal_code : 'NO'}`)
    console.log(`   Activated as Referrer: ${customer.activated_as_referrer ? 'YES ✅' : 'NO'}`)
    
    console.log('\n💰 Payment Status:')
    console.log(`   First Payment Completed: ${customer.first_payment_completed ? 'YES ✅' : 'NO'}`)
    
    console.log('\n📅 Timestamps:')
    console.log(`   Created: ${customer.created_at}`)
    console.log(`   Last Updated: ${customer.updated_at}`)
    
    console.log('\n' + '=' .repeat(80))
    
    // Check if we need to check Umi too
    if (customer.used_referral_code) {
      console.log('\n🔍 Checking Umi\'s referral reward status...')
      
      const umi = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, 
               gift_card_id, personal_code
        FROM square_existing_clients 
        WHERE personal_code = ${customer.used_referral_code}
      `
      
      if (umi && umi.length > 0) {
        const referrer = umi[0]
        console.log(`\n👤 Referrer Found:`)
        console.log(`   Name: ${referrer.given_name} ${referrer.family_name}`)
        console.log(`   Email: ${referrer.email_address || 'None'}`)
        console.log(`   Gift Card ID: ${referrer.gift_card_id || 'NONE'}`)
        console.log(`   Referral Code: ${referrer.personal_code}`)
      } else {
        console.log(`\n❌ Referrer not found for code: ${customer.used_referral_code}`)
      }
    }
    
    console.log('\n' + '=' .repeat(80))
    
    // Summary
    console.log('\n📊 SUMMARY:')
    if (customer.got_signup_bonus && customer.gift_card_id) {
      console.log('✅ Aby received $10 gift card!')
    } else {
      console.log('❌ Aby did NOT receive $10 gift card')
    }
    
    if (customer.used_referral_code) {
      console.log(`✅ Aby used referral code: ${customer.used_referral_code}`)
    } else {
      console.log('❌ Aby did NOT use referral code')
    }
    
    if (customer.first_payment_completed && customer.personal_code) {
      console.log(`✅ Aby completed payment and got own referral code: ${customer.personal_code}`)
    }
    
    console.log('=' .repeat(80))
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

checkAbyStatus()

