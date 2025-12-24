#!/usr/bin/env node
require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkReferralCode(code) {
  try {
    console.log(`🔍 Looking for referral code: "${code}"`)
    console.log('')
    
    // Try exact match
    const exactMatch = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code, 
             activated_as_referrer, first_payment_completed, created_at
      FROM square_existing_clients 
      WHERE personal_code = ${code}
      LIMIT 1
    `
    
    if (exactMatch && exactMatch.length > 0) {
      console.log('✅ FOUND - Exact match:')
      console.log(JSON.stringify(exactMatch[0], null, 2))
      return exactMatch[0]
    }
    
    // Try case-insensitive match
    const caseInsensitiveMatch = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code,
             activated_as_referrer, first_payment_completed, created_at
      FROM square_existing_clients 
      WHERE UPPER(TRIM(personal_code)) = UPPER(TRIM(${code}))
      LIMIT 1
    `
    
    if (caseInsensitiveMatch && caseInsensitiveMatch.length > 0) {
      console.log('✅ FOUND - Case-insensitive match:')
      console.log(JSON.stringify(caseInsensitiveMatch[0], null, 2))
      return caseInsensitiveMatch[0]
    }
    
    // Try partial match
    const partialMatch = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address, personal_code,
             activated_as_referrer, first_payment_completed, created_at
      FROM square_existing_clients 
      WHERE personal_code LIKE ${`%${code}%`}
      LIMIT 5
    `
    
    if (partialMatch && partialMatch.length > 0) {
      console.log(`⚠️ Found ${partialMatch.length} partial matches:`)
      partialMatch.forEach(m => console.log(`   - ${m.personal_code} (${m.given_name} ${m.family_name})`))
    }
    
    // Check for similar codes
    const similarCodes = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, personal_code
      FROM square_existing_clients 
      WHERE personal_code LIKE ${`%BOZHENA%`} OR personal_code LIKE ${`%8884%`}
      LIMIT 10
    `
    
    if (similarCodes && similarCodes.length > 0) {
      console.log(`\n🔍 Similar codes found:`)
      similarCodes.forEach(c => console.log(`   - ${c.personal_code} (${c.given_name} ${c.family_name})`))
    }
    
    console.log('\n❌ Referral code NOT FOUND in database')
    return null
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    return null
  } finally {
    await prisma.$disconnect()
  }
}

const code = process.argv[2] || 'BOZHENA8884'
checkReferralCode(code)





