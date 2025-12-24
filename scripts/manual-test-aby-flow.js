#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production
})

async function manuallyTestAbyFlow() {
  try {
    console.log('🧪 MANUAL TEST: Aby\'s Flow')
    console.log('=' .repeat(80))
    
    // Step 1: Find Aby in Square by phone
    console.log('\n📞 Step 1: Searching for Aby in Square by phone +17542319108...')
    
    const { result } = await client.customersApi.searchCustomers({
      query: {
        filter: {
          phoneNumber: {
            exact: '+17542319108'
          }
        }
      },
      limit: 10
    })
    
    if (!result.customers || result.customers.length === 0) {
      console.log('❌ No customer found with that phone number')
      return
    }
    
    const aby = result.customers[0]
    console.log('✅ Found Aby:')
    console.log(`   Name: ${aby.givenName} ${aby.familyName}`)
    console.log(`   ID: ${aby.id}`)
    console.log(`   Email: ${aby.emailAddress}`)
    console.log(`   Phone: ${aby.phoneNumber}`)
    
    // Step 2: Check if Aby is in our database
    console.log('\n📊 Step 2: Checking if Aby is in our database...')
    
    const inDB = await prisma.$queryRaw`
      SELECT * FROM square_existing_clients WHERE square_customer_id = ${aby.id}
    `
    
    if (inDB.length === 0) {
      console.log('❌ Aby NOT in our database yet')
      console.log('   This means booking webhook hasn\'t processed her yet')
    } else {
      console.log('✅ Aby IS in database:')
      console.log(`   Got bonus: ${inDB[0].got_signup_bonus ? 'YES ✅' : 'NO'}`)
      console.log(`   Gift card: ${inDB[0].gift_card_id || 'NONE'}`)
      console.log(`   Used code: ${inDB[0].used_referral_code || 'NONE'}`)
      console.log(`   Has own code: ${inDB[0].personal_code ? 'YES - ' + inDB[0].personal_code : 'NO'}`)
    }
    
    // Step 3: Find recent bookings for Aby
    console.log('\n📅 Step 3: Searching for Aby\'s recent bookings...')
    console.log('   (This requires Orders API or Bookings API access)')
    
    console.log('\n' + '=' .repeat(80))
    console.log('SUMMARY:')
    console.log(`   Aby in Square: YES ✅`)
    console.log(`   Aby in Database: ${inDB.length > 0 ? 'YES ✅' : 'NO ❌'}`)
    console.log(`   Next: Check if booking was created`)
    console.log('=' .repeat(80))
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.response?.body || error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

manuallyTestAbyFlow()

