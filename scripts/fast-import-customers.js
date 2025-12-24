#!/usr/bin/env node

/**
 * Fast import script - imports customers without checking order history
 * We'll update the got_signup_bonus field later with a separate script
 */

// Load environment variables (prefer .env.local like Next.js runtime)
const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const envFiles = ['.env.local', '.env']
let envLoaded = false
for (const file of envFiles) {
  const fullPath = path.resolve(process.cwd(), file)
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath })
    envLoaded = true
    console.log(`🧪 Loaded environment variables from ${file}`)
    break
  }
}
if (!envLoaded) {
  dotenv.config()
}

const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

// Initialize Prisma client
const prisma = new PrismaClient()

// Initialize Square client
const environment = Environment.Production
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})

const customersApi = squareClient.customersApi

function getCustomerDisplayName(customer) {
  const name = `${customer.givenName || ''} ${customer.familyName || ''}`.trim()
  if (name) return name
  if (customer.emailAddress) return customer.emailAddress
  if (customer.phoneNumber) return customer.phoneNumber
  return 'Customer'
}

function buildPersonalCode(name, idSeed) {
  const cleanName = (name || 'CUSTOMER')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)

  const cleanId = (idSeed || '')
    .toString()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-4)
    .toUpperCase()

  const code = `${cleanName}${cleanId}`.slice(0, 12)
  return code || `CUST${Date.now().toString().slice(-4)}`
}

async function generateUniquePersonalCode(customer) {
  const name = getCustomerDisplayName(customer)
  let candidate = buildPersonalCode(name, customer.id)
  let attempts = 0
  const maxAttempts = 10

  while (attempts < maxAttempts) {
    const existing = await prisma.$queryRaw`
      SELECT square_customer_id
      FROM square_existing_clients
      WHERE personal_code = ${candidate}
      LIMIT 1
    `
    if (!existing || existing.length === 0) {
      return candidate
    }
    attempts++
    candidate = buildPersonalCode(name, `${customer.id}_${Date.now()}_${attempts}`)
  }

  return buildPersonalCode('CUSTOMER', `${customer.id}_${Math.random().toString(36).slice(-4)}`)
}

// Fast import - no order history check
async function fastImportAllCustomers() {
  console.log('🚀 Starting FAST import of Square customers (no order history check)...')
  
  let cursor = null
  let totalImported = 0
  let totalSkipped = 0
  let totalErrors = 0

  try {
    do {
      console.log(`📡 Fetching customers${cursor ? ` (cursor: ${cursor})` : ''}...`)
      
      const response = await customersApi.listCustomers(cursor || undefined)
      const customers = response.result.customers || []
      console.log(`📋 Found ${customers.length} customers in this batch`)

      for (const customer of customers) {
        try {
          // Check if customer already exists
          const existingCustomer = await prisma.$queryRaw`
            SELECT square_customer_id FROM square_existing_clients 
            WHERE square_customer_id = ${customer.id}
          `

          if (existingCustomer && existingCustomer.length > 0) {
            console.log(`⏭️  Customer ${customer.id} already exists, skipping`)
            totalSkipped++
            continue
          }

          // Generate personal code using the same format as existing customers
          const personalCode = await generateUniquePersonalCode(customer)

          // Insert customer (set got_signup_bonus to false initially)
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
              ${personalCode}
            )
          `

          console.log(`✅ Imported customer ${customer.id} (${customer.givenName} ${customer.familyName})`)
          totalImported++

        } catch (error) {
          console.error(`❌ Error importing customer ${customer.id}:`, error.message)
          totalErrors++
        }
      }

      // Get next cursor
      cursor = response.result.cursor
      
      // Small delay to avoid rate limiting
      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }

    } while (cursor)

    console.log('\n🎉 FAST Import completed!')
    console.log(`📊 Summary:`)
    console.log(`   ✅ Imported: ${totalImported}`)
    console.log(`   ⏭️  Skipped: ${totalSkipped}`)
    console.log(`   ❌ Errors: ${totalErrors}`)
    console.log('\n💡 Note: got_signup_bonus is set to false for all customers initially.')
    console.log('   Run a separate script later to update this field based on order history.')

  } catch (error) {
    console.error('💥 Fatal error during import:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the import
if (require.main === module) {
  fastImportAllCustomers()
    .then(() => {
      console.log('✨ Fast import completed successfully!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('💥 Fast import failed:', error)
      process.exit(1)
    })
}

module.exports = { fastImportAllCustomers }
