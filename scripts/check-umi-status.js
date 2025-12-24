#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkUmiStatus() {
  try {
    console.log('🔍 Checking Umi\'s status...')
    console.log('=' .repeat(80))
    
    const umi = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, phone_number,
             activated_as_referrer, personal_code, gift_card_id, referral_email_sent
      FROM square_existing_clients 
      WHERE phone_number = '+16287893902'
    `
    
    if (!umi || umi.length === 0) {
      console.log('❌ Umi not found')
      return
    }
    
    const customer = umi[0]
    
    console.log('\n👤 Umi:')
    console.log(`   Name: ${customer.given_name} ${customer.family_name}`)
    console.log(`   Email: ${customer.email_address}`)
    console.log(`   Phone: ${customer.phone_number}`)
    
    console.log('\n🎯 Referrer Status:')
    console.log(`   Activated: ${customer.activated_as_referrer ? 'YES ✅' : 'NO'}`)
    console.log(`   Referral Code: ${customer.personal_code || 'NONE'}`)
    console.log(`   Email Sent: ${customer.referral_email_sent ? 'YES ✅' : 'NO'}`)
    
    console.log('\n🎁 Gift Card:')
    console.log(`   Gift Card ID: ${customer.gift_card_id || 'NONE'}`)
    
    console.log('=' .repeat(80))
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

checkUmiStatus()


