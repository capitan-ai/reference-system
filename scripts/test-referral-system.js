#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()
const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})
const customersApi = squareClient.customersApi

async function testReferralSystem() {
  console.log('🧪 Testing Referral System Components...')
  
  try {
    await prisma.$connect()
    
    // 1. Test database schema
    console.log('\n1️⃣ Testing Database Schema...')
    const tableInfo = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'square_existing_clients' 
      AND column_name IN ('referral_code', 'gift_card_id', 'total_referrals', 'total_rewards')
      ORDER BY column_name
    `
    
    console.log('✅ Database columns found:')
    tableInfo.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type}`)
    })

    // 2. Test Square API connection
    console.log('\n2️⃣ Testing Square API Connection...')
    const response = await customersApi.listCustomers()
    console.log(`✅ Square API connected - Found ${response.result.customers?.length || 0} customers`)

    // 3. Test custom attributes (on first customer)
    console.log('\n3️⃣ Testing Custom Attributes...')
    if (response.result.customers && response.result.customers.length > 0) {
      const firstCustomer = response.result.customers[0]
      console.log(`Testing with customer: ${firstCustomer.givenName} ${firstCustomer.familyName}`)
      
      if (firstCustomer.customAttributes) {
        console.log('✅ Custom attributes found:')
        firstCustomer.customAttributes.forEach(attr => {
          console.log(`   - ${attr.key}: ${attr.value}`)
        })
      } else {
        console.log('ℹ️ No custom attributes found for this customer')
      }
    }

    // 4. Test referral code generation
    console.log('\n4️⃣ Testing Referral Code Generation...')
    function generateReferralCode() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      let result = ''
      for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      return result
    }

    const testCodes = []
    for (let i = 0; i < 5; i++) {
      testCodes.push(generateReferralCode())
    }
    
    console.log('✅ Generated test referral codes:')
    testCodes.forEach(code => {
      console.log(`   - ${code}`)
    })

    // 5. Test referral URL generation
    console.log('\n5️⃣ Testing Referral URL Generation...')
    const testUrl = `https://referral-system-salon-1amggpgfw-umis-projects-e802f152.vercel.app/ref/${testCodes[0]}`
    console.log(`✅ Test referral URL: ${testUrl}`)

    // 6. Test database queries
    console.log('\n6️⃣ Testing Database Queries...')
    
    // Count customers without referral codes
    const customersWithoutCodes = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM square_existing_clients 
      WHERE referral_code IS NULL
    `
    console.log(`✅ Customers without referral codes: ${customersWithoutCodes[0].count}`)

    // Count activated referrers
    const activatedReferrers = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM square_existing_clients 
      WHERE activated_as_referrer = TRUE
    `
    console.log(`✅ Activated referrers: ${activatedReferrers[0].count}`)

    console.log('\n🎉 All tests completed successfully!')
    console.log('\n📋 Next Steps:')
    console.log('   1. Run: node scripts/update-database-schema.js')
    console.log('   2. Run: node scripts/generate-referral-codes.js')
    console.log('   3. Set up payment webhook in Square Dashboard')
    console.log('   4. Test the referral flow end-to-end')

  } catch (error) {
    console.error('💥 Test failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testReferralSystem()
