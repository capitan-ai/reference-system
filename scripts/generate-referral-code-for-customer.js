#!/usr/bin/env node
/**
 * Manually generate referral code and URL for a specific customer
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const REFERRAL_CODE_ATTRIBUTE_KEY =
  process.env.SQUARE_REFERRAL_CODE_ATTRIBUTE_KEY?.trim() ||
  'square:a3dde506-f69e-48e4-a98a-004c1822d3ad'

const CUSTOMER_ID = process.argv[2]

if (!CUSTOMER_ID) {
  console.error('❌ Please provide a customer ID')
  console.log('Usage: node scripts/generate-referral-code-for-customer.js <CUSTOMER_ID>')
  process.exit(1)
}

// Generate personal code (same logic as in webhook handler)
function generatePersonalCode(customerName, customerId) {
  let namePart = 'CUST'
  if (customerName) {
    namePart = customerName.toString().trim().split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 10)
  }
  let idPart = ''
  if (customerId) {
    const idStr = customerId.toString()
    const numericMatches = idStr.match(/\d+/g)
    if (numericMatches && numericMatches.length > 0) {
      const allNums = numericMatches.join('')
      idPart = allNums.slice(-4).padStart(4, '0')
    } else {
      idPart = idStr.slice(-4).toUpperCase()
    }
  } else {
    idPart = Date.now().toString().slice(-4)
  }
  if (idPart.length < 3) idPart = idPart.padStart(4, '0')
  if (idPart.length > 4) idPart = idPart.slice(-4)
  return `${namePart}${idPart}`
}

// Generate unique personal code, checking for duplicates
async function generateUniquePersonalCode(customerName, customerId, maxAttempts = 10) {
  let attempt = 0
  while (attempt < maxAttempts) {
    const code = generatePersonalCode(customerName, customerId)
    
    // If this is not the first attempt, add a suffix to make it unique
    if (attempt > 0) {
      const suffix = attempt.toString().padStart(2, '0')
      const baseCode = code.slice(0, -2)
      const uniqueCode = `${baseCode}${suffix}`
      
      // Check if this code exists
      const existing = await prisma.$queryRaw`
        SELECT square_customer_id FROM square_existing_clients 
        WHERE personal_code = ${uniqueCode}
        LIMIT 1
      `
      
      if (!existing || existing.length === 0) {
        return uniqueCode
      }
    } else {
      // First attempt - check if base code exists
      const existing = await prisma.$queryRaw`
        SELECT square_customer_id FROM square_existing_clients 
        WHERE personal_code = ${code}
        LIMIT 1
      `
      
      if (!existing || existing.length === 0) {
        return code
      }
    }
    
    attempt++
  }
  
  // If all attempts failed, generate a completely random code
  const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `CUST${randomSuffix}`
}

// Upsert custom attribute in Square
async function upsertCustomerCustomAttribute(customerId, key, value) {
  try {
    const customersApi = squareClient.customersApi
    await customersApi.upsertCustomerCustomAttribute(customerId, key, {
      customAttribute: {
        key: key,
        value: {
          stringValue: value
        }
      }
    })
    console.log(`   ✅ Updated Square custom attribute: ${value}`)
    return true
  } catch (error) {
    console.error(`   ⚠️  Failed to update Square custom attribute: ${error.message}`)
    return false
  }
}

// Append referral note to customer
async function appendReferralNote(customerId, referralCode, referralUrl) {
  try {
    const customersApi = squareClient.customersApi
    const noteText = `Referral Code: ${referralCode}\nReferral URL: ${referralUrl}\nGenerated: ${new Date().toISOString()}`
    
    // Get existing customer to append to notes
    const customerResponse = await customersApi.retrieveCustomer(customerId)
    const customer = customerResponse.result?.customer
    const existingNote = customer.note || ''
    const newNote = existingNote ? `${existingNote}\n\n${noteText}` : noteText
    
    await customersApi.updateCustomer(customerId, {
      note: newNote
    })
    console.log(`   ✅ Updated Square customer note`)
    return true
  } catch (error) {
    console.error(`   ⚠️  Failed to update Square customer note: ${error.message}`)
    return false
  }
}

async function generateReferralCodeForCustomer() {
  console.log('🔧 Generating Referral Code for Customer')
  console.log('='.repeat(60))
  console.log(`Customer ID: ${CUSTOMER_ID}`)
  console.log('')

  try {
    // Step 1: Get customer from database
    console.log('📋 Step 1: Getting customer data...')
    const dbCustomer = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        given_name,
        family_name,
        email_address,
        phone_number,
        personal_code,
        referral_url,
        activated_as_referrer,
        first_payment_completed
      FROM square_existing_clients 
      WHERE square_customer_id = ${CUSTOMER_ID}
    `

    if (!dbCustomer || dbCustomer.length === 0) {
      console.log('❌ Customer not found in database')
      return
    }

    const customer = dbCustomer[0]
    const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Customer'
    
    console.log(`   ✅ Customer: ${customerName}`)
    console.log(`   - Email: ${customer.email_address || 'None'}`)
    console.log(`   - Phone: ${customer.phone_number || 'None'}`)
    
    if (customer.personal_code) {
      console.log(`   ⚠️  Customer already has personal_code: ${customer.personal_code}`)
      console.log(`   - Referral URL: ${customer.referral_url || 'Missing'}`)
      console.log('')
      console.log('   Do you want to regenerate? (This will update the existing code)')
      console.log('   Skipping... (Run with --force flag to override)')
      return
    }
    
    console.log('')

    // Step 2: Generate unique referral code
    console.log('📋 Step 2: Generating unique referral code...')
    const referralCode = await generateUniquePersonalCode(customerName, CUSTOMER_ID)
    const referralUrl = generateReferralUrl(referralCode)
    
    console.log(`   ✅ Generated Code: ${referralCode}`)
    console.log(`   ✅ Generated URL: ${referralUrl}`)
    console.log('')

    // Step 3: Update Square customer (custom attribute and note)
    console.log('📋 Step 3: Updating Square customer...')
    await upsertCustomerCustomAttribute(CUSTOMER_ID, REFERRAL_CODE_ATTRIBUTE_KEY, referralCode)
    await appendReferralNote(CUSTOMER_ID, referralCode, referralUrl)
    console.log('')

    // Step 4: Update database
    console.log('📋 Step 4: Updating database...')
    await prisma.$executeRaw`
      UPDATE square_existing_clients 
      SET 
        personal_code = ${referralCode},
        referral_url = ${referralUrl},
        activated_as_referrer = TRUE,
        updated_at = NOW()
      WHERE square_customer_id = ${CUSTOMER_ID}
    `
    console.log(`   ✅ Database updated successfully`)
    console.log('')

    console.log('✅ Referral code generated successfully!')
    console.log('')
    console.log('📋 Summary:')
    console.log(`   - Customer: ${customerName}`)
    console.log(`   - Personal Code: ${referralCode}`)
    console.log(`   - Referral URL: ${referralUrl}`)
    console.log(`   - Activated as Referrer: TRUE`)

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

generateReferralCodeForCustomer()



