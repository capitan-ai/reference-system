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

// Generate unique referral code
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Generate referral URL with UTM tracking
function generateReferralUrl(referralCode) {
  return `https://studio-zorina.square.site/?utm_source=referral&utm_medium=friend&utm_campaign=${referralCode}`
}

// Update customer with custom attributes in Square
async function updateCustomerWithReferralCode(squareCustomerId, referralCode, referralUrl) {
  try {
    const updateRequest = {
      customer: {
        customAttributes: [
          {
            key: 'referral_code',
            value: referralCode
          },
          {
            key: 'referral_url', 
            value: referralUrl
          },
          {
            key: 'is_referrer',
            value: 'true'
          }
        ]
      }
    }

    const response = await customersApi.updateCustomer(squareCustomerId, updateRequest)
    
    if (response.result.customer) {
      console.log(`✅ Updated Square customer ${squareCustomerId} with referral code: ${referralCode}`)
      return true
    }
  } catch (error) {
    console.error(`❌ Error updating customer ${squareCustomerId}:`, error.message)
    return false
  }
}

const { sendReferralCodeEmail } = require('../lib/email-service-simple')

// Process existing customers - ONLY generate codes and send emails
async function processExistingCustomers() {
  console.log('🚀 Starting referral code generation for existing customers...')
  console.log('📝 Note: Gift cards will be created only when someone uses the referral code')

  try {
    await prisma.$connect()

    // Get customers who haven't been activated as referrers yet
    const customers = await prisma.$queryRaw`
      SELECT square_customer_id, given_name, family_name, email_address
      FROM square_existing_clients 
      WHERE activated_as_referrer = FALSE
      AND email_address IS NOT NULL
      AND email_address != ''
      ORDER BY created_at ASC
      LIMIT 10
    `

    console.log(`📊 Found ${customers.length} customers to process`)

    for (const customer of customers) {
      try {
        const referralCode = generateReferralCode()
        const referralUrl = generateReferralUrl(referralCode)

        console.log(`\n👤 Processing: ${customer.given_name} ${customer.family_name}`)
        console.log(`   Email: ${customer.email_address}`)
        console.log(`   Referral Code: ${referralCode}`)
        console.log(`   Referral URL: ${referralUrl}`)

        // Update Square customer with custom attributes
        const squareUpdated = await updateCustomerWithReferralCode(
          customer.square_customer_id, 
          referralCode, 
          referralUrl
        )

        if (squareUpdated) {
          // Update database
          await prisma.$executeRaw`
            UPDATE square_existing_clients 
            SET 
              personal_code = ${referralCode},
              activated_as_referrer = TRUE
            WHERE square_customer_id = ${customer.square_customer_id}
          `

          // Send email
          await sendReferralCodeEmail(
            `${customer.given_name} ${customer.family_name}`,
            customer.email_address,
            referralCode,
            referralUrl
          )

          console.log(`✅ Successfully processed ${customer.given_name} ${customer.family_name}`)
        }

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (error) {
        console.error(`❌ Error processing customer ${customer.square_customer_id}:`, error.message)
      }
    }

    console.log('\n🎉 Referral code generation completed!')
    console.log('📋 Next steps:')
    console.log('   1. Set up Square Online custom field for "Referral Code"')
    console.log('   2. Test booking flow with referral code')
    console.log('   3. Set up payment webhook to process referrals')
    console.log('   4. Send referral codes to all customers')

  } catch (error) {
    console.error('💥 Error during processing:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the process
processExistingCustomers()
