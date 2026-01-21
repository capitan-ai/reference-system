#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function findAnyRecentActivity() {
  try {
    console.log('🔍 Checking for ANY recent database activity...')
    console.log('=' .repeat(80))
    
    // Check all customers created in last hour
    const recent = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, 
             phone_number, created_at, updated_at
      FROM square_existing_clients 
      WHERE created_at > NOW() - INTERVAL '1 hour'
      ORDER BY created_at DESC
      LIMIT 20
    `
    
    console.log(`\n📊 Found ${recent.length} customers created in last hour:`)
    recent.forEach((c, i) => {
      console.log(`\n${i + 1}. ${c.given_name} ${c.family_name}`)
      console.log(`   ID: ${c.square_customer_id}`)
      console.log(`   Email: ${c.email_address}`)
      console.log(`   Phone: ${c.phone_number}`)
      console.log(`   Created: ${c.created_at}`)
      console.log(`   Updated: ${c.updated_at}`)
    })
    
    // Also check for any updates
    const updated = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, 
             got_signup_bonus, gift_card_id, used_referral_code, updated_at
      FROM square_existing_clients 
      WHERE updated_at > NOW() - INTERVAL '1 hour'
        AND created_at < NOW() - INTERVAL '10 minutes'
      ORDER BY updated_at DESC
      LIMIT 20
    `
    
    if (updated.length > 0) {
      console.log(`\n\n📝 Found ${updated.length} customers UPDATED in last hour:`)
      updated.forEach((c, i) => {
        console.log(`\n${i + 1}. ${c.given_name} ${c.family_name}`)
        console.log(`   Got bonus: ${c.got_signup_bonus ? 'YES ✅' : 'NO'}`)
        console.log(`   Gift card: ${c.gift_card_id || 'NONE'}`)
        console.log(`   Used code: ${c.used_referral_code || 'NONE'}`)
        console.log(`   Updated: ${c.updated_at}`)
      })
    }
    
    console.log('\n' + '=' .repeat(80))
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

findAnyRecentActivity()
