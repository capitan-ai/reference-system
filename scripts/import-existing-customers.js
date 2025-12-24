#!/usr/bin/env node

/**
 * Script to import all existing Square customers into Supabase database
 * This script will:
 * 1. Fetch all customers from Square API
 * 2. Check their order history to determine if they're first-time customers
 * 3. Import them into the database with proper flags
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
      locationIds: [process.env.SQUARE_LOCATION_ID],
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

// Import all customers from Square
async function importAllCustomers() {
  console.log('🚀 Starting import of existing Square customers...')
  
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
          // Check if customer already exists in database
          const existingCustomer = await prisma.customer.findUnique({
            where: { squareCustomerId: customer.id }
          })

          if (existingCustomer) {
            console.log(`⏭️  Customer ${customer.id} already exists, skipping`)
            totalSkipped++
            continue
          }

          // Check if customer has completed orders (determines if they got signup bonus)
          const hasOrders = await hasCompletedOrders(customer.id)
          
          // Generate personal code
          const personalCode = generatePersonalCode()

          // Create customer in database
          await prisma.customer.create({
            data: {
              squareCustomerId: customer.id,
              givenName: customer.givenName || null,
              familyName: customer.familyName || null,
              emailAddress: customer.emailAddress || null,
              phoneNumber: customer.phoneNumber || null,
              gotSignupBonus: hasOrders, // If they have orders, they got the bonus
              activatedAsReferrer: false, // Will be set to true when they make their first payment
              personalCode: personalCode,
              firstPaidSeen: hasOrders, // If they have orders, they've paid before
            }
          })

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