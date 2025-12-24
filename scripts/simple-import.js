#!/usr/bin/env node

// Load environment variables
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

console.log('🚀 Starting customer import...')

const prisma = new PrismaClient()
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: Environment.Production,
})

const customersApi = squareClient.customersApi

// Generate unique personal code
function generatePersonalCode() {
  return `CUST_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`
}

async function importCustomers() {
  let cursor = null
  let totalImported = 0
  let totalSkipped = 0
  let totalErrors = 0

  try {
    do {
      console.log(`📡 Fetching customers...`)
      
      const response = await customersApi.listCustomers(cursor || undefined)
      const customers = response.result.customers || []
      
      console.log(`📋 Processing ${customers.length} customers`)

      for (const customer of customers) {
        try {
          // Check if exists
          const exists = await prisma.$queryRaw`
            SELECT 1 FROM square_existing_clients WHERE square_customer_id = ${customer.id}
          `

          if (exists.length > 0) {
            totalSkipped++
            continue
          }

          // Insert customer
          await prisma.$executeRaw`
            INSERT INTO square_existing_clients (
              square_customer_id,
              given_name,
              family_name,
              email_address,
              phone_number,
              got_signup_bonus,
              activated_as_referrer,
              personal_code
            ) VALUES (
              ${customer.id},
              ${customer.givenName || null},
              ${customer.familyName || null},
              ${customer.emailAddress || null},
              ${customer.phoneNumber || null},
              false,
              false,
              ${generatePersonalCode()}
            )
          `

          totalImported++
          console.log(`✅ ${customer.id} - ${customer.givenName} ${customer.familyName}`)

        } catch (error) {
          console.error(`❌ Error with ${customer.id}:`, error.message)
          totalErrors++
        }
      }

      cursor = response.result.cursor
      
      if (cursor) {
        console.log(`🔄 Continuing with cursor: ${cursor.substring(0, 20)}...`)
        await new Promise(resolve => setTimeout(resolve, 100))
      }

    } while (cursor)

    console.log('\n🎉 Import completed!')
    console.log(`✅ Imported: ${totalImported}`)
    console.log(`⏭️ Skipped: ${totalSkipped}`)
    console.log(`❌ Errors: ${totalErrors}`)

  } catch (error) {
    console.error('💥 Fatal error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

importCustomers()
