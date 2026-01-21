#!/usr/bin/env node

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

/**
 * Normalize phone number to match database format
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null
  
  let cleaned = phone.replace(/[^\d+]/g, '')
  
  if (cleaned.startsWith('+')) {
    return cleaned
  }
  
  if (cleaned.length === 10) {
    return `+1${cleaned}`
  }
  
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`
  }
  
  if (cleaned.length >= 10) {
    return `+1${cleaned.slice(-10)}`
  }
  
  return cleaned
}

async function checkPhoneNumber(phoneNumber) {
  try {
    console.log(`🔍 Searching for phone number: ${phoneNumber}`)
    console.log('='.repeat(60))
    console.log('')

    // Extract just the digits
    const inputDigits = phoneNumber.replace(/\D/g, '')
    const last10Digits = inputDigits.slice(-10)
    
    console.log(`📱 Last 10 digits: ${last10Digits}`)
    console.log('')

    // Try normalized format
    const normalized = normalizePhoneNumber(phoneNumber)
    console.log(`📱 Normalized format: ${normalized}`)
    console.log('')

    // 1. Try exact match with normalized format
    let customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        phone_number,
        personal_code,
        referral_url,
        given_name,
        family_name,
        email_address,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE phone_number = ${normalized}
      LIMIT 1
    `

    if (customer && customer.length > 0) {
      console.log('✅ Found customer with normalized format:')
      console.log(JSON.stringify(customer[0], null, 2))
      return
    }

    // 2. Try without + prefix
    const withoutPlus = normalized.replace(/^\+/, '')
    customer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        phone_number,
        personal_code,
        referral_url,
        given_name,
        family_name,
        email_address,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE phone_number = ${withoutPlus}
      LIMIT 1
    `

    if (customer && customer.length > 0) {
      console.log('✅ Found customer without + prefix:')
      console.log(JSON.stringify(customer[0], null, 2))
      return
    }

    // 3. Try matching by extracting digits (LIKE search)
    const potentialMatches = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        phone_number,
        personal_code,
        referral_url,
        given_name,
        family_name,
        email_address,
        created_at,
        updated_at
      FROM square_existing_clients
      WHERE (
        phone_number LIKE ${'%' + last10Digits}
        OR phone_number LIKE ${'%' + last10Digits.slice(0, 3) + '%' + last10Digits.slice(3, 6) + '%' + last10Digits.slice(6)}
        OR phone_number LIKE ${'%' + last10Digits.slice(0, 3) + ')%' + last10Digits.slice(3, 6) + '-%' + last10Digits.slice(6)}
      )
      ORDER BY updated_at DESC, square_customer_id DESC
      LIMIT 10
    `

    if (potentialMatches && potentialMatches.length > 0) {
      console.log(`📋 Found ${potentialMatches.length} potential matches:`)
      console.log('')
      
      // Filter exact digit matches
      const exactMatches = []
      for (const customer of potentialMatches) {
        if (!customer.phone_number) continue
        
        const dbDigits = customer.phone_number.replace(/\D/g, '')
        const dbLast10 = dbDigits.slice(-10)
        
        if (dbLast10 === last10Digits && dbLast10.length === 10) {
          exactMatches.push(customer)
        }
      }

      if (exactMatches.length > 0) {
        console.log(`✅ Found ${exactMatches.length} exact digit match(es):`)
        exactMatches.forEach((c, idx) => {
          console.log(`\n${idx + 1}. Customer:`)
          console.log(`   ID: ${c.square_customer_id}`)
          console.log(`   Name: ${c.given_name || ''} ${c.family_name || ''}`.trim() || 'Unknown')
          console.log(`   Phone: ${c.phone_number}`)
          console.log(`   Email: ${c.email_address || 'N/A'}`)
          console.log(`   Personal Code: ${c.personal_code || 'N/A'}`)
          console.log(`   Referral URL: ${c.referral_url || 'N/A'}`)
        })
        return
      } else {
        console.log('⚠️  Found potential matches but none match exactly on last 10 digits:')
        potentialMatches.forEach((c, idx) => {
          const dbDigits = c.phone_number.replace(/\D/g, '')
          const dbLast10 = dbDigits.slice(-10)
          console.log(`\n${idx + 1}. Phone: ${c.phone_number} (last 10: ${dbLast10})`)
        })
      }
    } else {
      console.log('❌ No customer found with this phone number')
      console.log('')
      console.log('💡 Possible reasons:')
      console.log('   1. Customer does not exist in square_existing_clients table')
      console.log('   2. Phone number is stored in a different format')
      console.log('   3. Customer was never synced from Square')
      console.log('')
      
      // Check how many customers exist total
      const totalCustomers = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM square_existing_clients
      `
      console.log(`📊 Total customers in database: ${totalCustomers[0]?.count || 0}`)
      
      // Check if there are any customers with similar phone numbers
      const similarPhones = await prisma.$queryRaw`
        SELECT 
          phone_number,
          COUNT(*) as count
        FROM square_existing_clients
        WHERE phone_number IS NOT NULL
          AND phone_number != ''
          AND phone_number LIKE ${'%628%'}
        GROUP BY phone_number
        ORDER BY count DESC
        LIMIT 10
      `
      
      if (similarPhones && similarPhones.length > 0) {
        console.log('')
        console.log(`📋 Found ${similarPhones.length} customers with "628" in phone number:`)
        similarPhones.forEach((p, idx) => {
          console.log(`   ${idx + 1}. ${p.phone_number}`)
        })
      }
    }

  } catch (error) {
    console.error('❌ Error checking phone number:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Get phone number from command line argument
const phoneNumber = process.argv[2]

if (!phoneNumber) {
  console.log('Usage: node check-phone-number.js <phone-number>')
  console.log('Example: node check-phone-number.js 6287240305')
  console.log('Example: node check-phone-number.js "(628) 724-0305"')
  process.exit(1)
}

checkPhoneNumber(phoneNumber)

