#!/usr/bin/env node

/**
 * Script to import all existing Square customers into square_existing_clients table
 * This script will:
 * 1. Fetch all customers from Square API
 * 2. Extract only the required fields
 * 3. Insert them into the square_existing_clients table
 */

// Load environment variables
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

// Initialize Prisma client
const prisma = new PrismaClient()

// Initialize Square client
const environment = Environment.Production // Use production environment
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment,
})

const customersApi = squareClient.customersApi
const ordersApi = squareClient.ordersApi

// Generate personal code for customers
function generatePersonalCode() {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `CUST_${timestamp}${random}`.substring(0, 12)
}

// Check if customer has completed orders
async function hasCompletedOrders(squareCustomerId) {
  try {
    const ordersResponse = await ordersApi.searchOrders({
      locationIds: [process.env.SQUARE_LOCATION_ID?.trim()],
      query: {
        filter: {
          customerFilter: {
            customerIds: [squareCustomerId],
          },
          stateFilter: {
            states: ['COMPLETED'],
          },
        },
      },
    })

    const completedOrders = ordersResponse.result.orders?.filter(
      order => order.state === 'COMPLETED'
    ) || []

    return completedOrders.length > 0
  } catch (error) {
    console.warn(`Could not check order history for customer ${squareCustomerId}:`, error.message)
    return false
  }
}

// Import all customers from Square into square_existing_clients table
async function importAllCustomers() {
  console.log('🚀 Starting import of existing Square customers into square_existing_clients table...')
  
  let cursor = null
  let totalImported = 0
  let totalSkipped = 0
  let totalErrors = 0

  try {
    do {
      console.log(`📡 Fetching customers${cursor ? ` (cursor: ${cursor})` : ''}...`)
      
      // Call Square API with proper parameters
      const response = await customersApi.listCustomers(cursor || undefined)

      const customers = response.result.customers || []
      console.log(`📋 Found ${customers.length} customers in this batch`)

      for (const customer of customers) {
        try {
          // Check if customer already exists in square_existing_clients table
          const existingCustomer = await prisma.$queryRaw`
            SELECT square_customer_id FROM square_existing_clients 
            WHERE square_customer_id = ${customer.id}
          `

          if (existingCustomer && existingCustomer.length > 0) {
            console.log(`⏭️  Customer ${customer.id} already exists, skipping`)
            totalSkipped++
            continue
          }

          // Check if customer has completed orders (determines if they got signup bonus)
          const hasOrders = await hasCompletedOrders(customer.id)
          
          // Generate personal code
          const personalCode = generatePersonalCode()

          // Insert customer into square_existing_clients table
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
              ${hasOrders},
              false,
              ${personalCode}
            )
          `

          console.log(`✅ Imported customer ${customer.id} (${customer.givenName} ${customer.familyName}) - Orders: ${hasOrders ? 'Yes' : 'No'}`)
          totalImported++

        } catch (error) {
          console.error(`❌ Error importing customer ${customer.id}:`, error.message)
          totalErrors++
        }
      }

      // Get next cursor
      cursor = response.result.cursor
      
      // Add small delay to avoid rate limiting
      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

    } while (cursor)

    console.log('\n🎉 Import completed!')
    console.log(`📊 Summary:`)
    console.log(`   ✅ Imported: ${totalImported}`)
    console.log(`   ⏭️  Skipped: ${totalSkipped}`)
    console.log(`   ❌ Errors: ${totalErrors}`)

  } catch (error) {
    console.error('💥 Fatal error during import:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the import
if (require.main === module) {
  importAllCustomers()
    .then(() => {
      console.log('✨ Import script completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('💥 Import script failed:', error)
      process.exit(1)
    })
}

module.exports = { importAllCustomers }
