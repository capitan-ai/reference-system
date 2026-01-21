#!/usr/bin/env node
/**
 * Check why a customer doesn't have a referral code and URL
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

const CUSTOMER_ID = process.argv[2] || 'PC9XDNW0KATPG52FAXJXV9045G'

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

async function checkCustomerStatus() {
  console.log('🔍 Checking Customer Referral Status')
  console.log('='.repeat(60))
  console.log(`Customer ID: ${CUSTOMER_ID}`)
  console.log('')

  try {
    // Step 1: Check database
    console.log('📋 Step 1: Database Information')
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
        got_signup_bonus,
        first_payment_completed,
        referral_email_sent,
        created_at,
        updated_at
      FROM square_existing_clients 
      WHERE square_customer_id = ${CUSTOMER_ID}
    `

    if (!dbCustomer || dbCustomer.length === 0) {
      console.log('❌ Customer not found in database')
      
      // Try to get from Square API
      console.log('\n📋 Trying to get customer from Square API...')
      try {
        const customerResponse = await squareClient.customersApi.retrieveCustomer(CUSTOMER_ID)
        const customer = customerResponse.result?.customer
        if (customer) {
          console.log(`   ✅ Customer found in Square:`)
          console.log(`      - Name: ${customer.givenName} ${customer.familyName}`)
          console.log(`      - Email: ${customer.emailAddress || 'None'}`)
          console.log(`      - Phone: ${customer.phoneNumber || 'None'}`)
          console.log(`      - Created: ${customer.createdAt}`)
          console.log(`\n⚠️  Customer exists in Square but not in database`)
          console.log(`   This customer may not have been synced to the database yet.`)
        } else {
          console.log('   ❌ Customer not found in Square either')
        }
      } catch (squareError) {
        console.log(`   ❌ Error fetching from Square: ${squareError.message}`)
      }
      
      return
    }

    const customer = dbCustomer[0]
    const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
    
    console.log(`   ✅ Customer Found:`)
    console.log(`      - Name: ${customerName}`)
    console.log(`      - Email: ${customer.email_address || 'None'}`)
    console.log(`      - Phone: ${customer.phone_number || 'None'}`)
    console.log(`      - Created: ${customer.created_at}`)
    console.log(`      - Updated: ${customer.updated_at}`)
    console.log('')

    // Step 2: Check referral code status
    console.log('📋 Step 2: Referral Code Status')
    console.log(`   - Personal Code: ${customer.personal_code || '❌ MISSING'}`)
    console.log(`   - Referral URL: ${customer.referral_url || '❌ MISSING'}`)
    console.log(`   - Activated as Referrer: ${customer.activated_as_referrer ? '✅ Yes' : '❌ No'}`)
    console.log(`   - Got Signup Bonus: ${customer.got_signup_bonus ? '✅ Yes' : '❌ No'}`)
    console.log(`   - First Payment Completed: ${customer.first_payment_completed ? '✅ Yes' : '❌ No'}`)
    console.log(`   - Referral Email Sent: ${customer.referral_email_sent ? '✅ Yes' : '❌ No'}`)
    console.log('')

    // Step 3: Check Square customer for referral code attribute
    console.log('📋 Step 3: Square Customer Attributes')
    try {
      const customerResponse = await squareClient.customersApi.retrieveCustomer(CUSTOMER_ID)
      const squareCustomer = customerResponse.result?.customer
      
      if (squareCustomer?.customAttributes) {
        const referralCodeAttr = squareCustomer.customAttributes.find(
          attr => attr.key === process.env.SQUARE_REFERRAL_CODE_ATTRIBUTE_KEY?.trim() || 
                  attr.key === 'square:a3dde506-f69e-48e4-a98a-004c1822d3ad'
        )
        
        if (referralCodeAttr) {
          console.log(`   ✅ Referral code in Square: ${referralCodeAttr.value}`)
        } else {
          console.log(`   ❌ No referral code attribute found in Square`)
        }
      } else {
        console.log(`   ⚠️  No custom attributes found in Square`)
      }
    } catch (squareError) {
      console.log(`   ⚠️  Error fetching from Square: ${squareError.message}`)
    }
    console.log('')

    // Step 4: Analysis
    console.log('📋 Step 4: Analysis')
    
    if (!customer.personal_code) {
      console.log('   ❌ PROBLEM: Customer does not have a personal_code')
      console.log('   ')
      console.log('   Possible reasons:')
      
      if (!customer.first_payment_completed) {
        console.log('      1. ⚠️  First payment not completed')
        console.log('         → Referral codes are typically generated after first payment')
        console.log('         → Check if customer has made a payment yet')
      }
      
      if (!customer.email_address && !customer.phone_number) {
        console.log('      2. ⚠️  No email or phone number')
        console.log('         → Referral code emails/SMS require contact information')
      }
      
      console.log('      3. ⚠️  Referral code generation was not triggered')
      console.log('         → This can happen if payment webhook was not processed correctly')
      console.log('         → Or if customer was created before referral system was implemented')
      console.log('')
      
      // Generate suggested code
      const suggestedCode = generatePersonalCode(customerName, CUSTOMER_ID)
      const suggestedUrl = generateReferralUrl(suggestedCode)
      console.log('   💡 Suggested Code:')
      console.log(`      - Personal Code: ${suggestedCode}`)
      console.log(`      - Referral URL: ${suggestedUrl}`)
      console.log('')
      
      console.log('   🔧 To fix:')
      console.log('      1. Run: node scripts/generate-referral-codes-square-existing-clients.js')
      console.log('      2. Or manually generate using the suggested code above')
      
    } else {
      console.log('   ✅ Customer has personal_code')
      
      if (!customer.referral_url) {
        console.log('   ⚠️  But referral_url is missing')
        const generatedUrl = generateReferralUrl(customer.personal_code)
        console.log(`   💡 Should be: ${generatedUrl}`)
        console.log('   🔧 To fix: Update referral_url in database')
      }
      
      if (!customer.activated_as_referrer) {
        console.log('   ⚠️  Customer is not marked as activated_referrer')
        console.log('   🔧 To fix: Set activated_as_referrer = TRUE in database')
      }
    }
    
    console.log('')
    console.log('✅ Analysis complete!')

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkCustomerStatus()

