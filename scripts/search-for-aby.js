#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function searchForAby() {
  try {
    console.log('🔍 Searching for Aby in database...')
    console.log('=' .repeat(80))
    
    // Search by phone variations
    const phoneSearches = [
      '%7542319108%',
      '%17542319108%',
      '+17542319108',
      '+1 754 231 9108',
      '17542319108',
      '7542319108'
    ]
    
    console.log('\n📞 Searching by phone variations...')
    
    for (const phonePattern of phoneSearches) {
      const result = await prisma.$queryRaw`
        SELECT square_customer_id, given_name, family_name, email_address, phone_number,
               created_at, updated_at
        FROM square_existing_clients 
        WHERE phone_number LIKE ${phonePattern}
        LIMIT 5
      `
      
      if (result && result.length > 0) {
        console.log(`\n✅ Found with pattern ${phonePattern}:`)
        result.forEach((customer, i) => {
          console.log(`\n${i + 1}. ${customer.given_name} ${customer.family_name}`)
          console.log(`   Email: ${customer.email_address}`)
          console.log(`   Phone: ${customer.phone_number}`)
          console.log(`   ID: ${customer.square_customer_id}`)
          console.log(`   Created: ${customer.created_at}`)
        })
        break
      }
    }
    
    // Search all recent customers
    console.log('\n\n📅 Searching ALL customers created in last 2 hours...')
    
    const allRecent = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, phone_number,
             created_at
      FROM square_existing_clients 
      WHERE created_at > NOW() - INTERVAL '2 hours'
      ORDER BY created_at DESC
      LIMIT 20
    `
    
    console.log(`\n✅ Found ${allRecent.length} customers created in last 2 hours:`)
    allRecent.forEach((customer, i) => {
      console.log(`\n${i + 1}. ${customer.given_name} ${customer.family_name}`)
      console.log(`   Phone: ${customer.phone_number}`)
      console.log(`   Email: ${customer.email_address}`)
      console.log(`   ID: ${customer.square_customer_id}`)
      console.log(`   Created: ${customer.created_at}`)
    })
    
    // Search all customers with "aby" in name (case insensitive)
    console.log('\n\n🔤 Searching for customers with "aby" in name...')
    
    const nameResults = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, phone_number,
             created_at
      FROM square_existing_clients 
      WHERE LOWER(given_name) LIKE '%aby%' OR LOWER(family_name) LIKE '%aby%'
      ORDER BY created_at DESC
      LIMIT 20
    `
    
    console.log(`\n✅ Found ${nameResults.length} customers with "aby" in name:`)
    nameResults.forEach((customer, i) => {
      console.log(`\n${i + 1}. ${customer.given_name} ${customer.family_name}`)
      console.log(`   Phone: ${customer.phone_number}`)
      console.log(`   Email: ${customer.email_address}`)
      console.log(`   ID: ${customer.square_customer_id}`)
      console.log(`   Created: ${customer.created_at}`)
    })
    
  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

searchForAby()

