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

async function fixTimestamps() {
  console.log('🕐 Starting timestamp fix - preserving Square original timestamps...')
  
  let totalUpdated = 0
  let totalSkipped = 0
  let cursor = null

  try {
    await prisma.$connect()
    
    do {
      console.log(`📡 Fetching customers${cursor ? ` (cursor: ${cursor})` : ''}...`)
      const response = await customersApi.listCustomers(cursor || undefined)
      const customers = response.result.customers || []
      console.log(`📋 Processing ${customers.length} customers`)

      for (const customer of customers) {
        try {
          // Check if customer exists in our database
          const existingCustomer = await prisma.$queryRaw`
            SELECT square_customer_id FROM square_existing_clients
            WHERE square_customer_id = ${customer.id}
          `
          
          if (existingCustomer && existingCustomer.length > 0) {
            // Update with Square's original timestamps
            await prisma.$executeRaw`
              UPDATE square_existing_clients 
              SET 
                created_at = ${customer.createdAt}::timestamp with time zone,
                updated_at = ${customer.updatedAt}::timestamp with time zone
              WHERE square_customer_id = ${customer.id}
            `
            totalUpdated++
            console.log(`✅ Updated timestamps for ${customer.givenName || 'Unknown'} ${customer.familyName || ''} (${customer.id})`)
          } else {
            totalSkipped++
          }
        } catch (innerError) {
          console.error(`❌ Error updating customer ${customer.id}:`, innerError.message)
        }
      }
      
      cursor = response.result.cursor || null
    } while (cursor)

    console.log('')
    console.log('🎉 Timestamp fix completed!')
    console.log(`✅ Updated: ${totalUpdated} customers`)
    console.log(`⏭️ Skipped: ${totalSkipped} customers`)
    console.log('')
    console.log('📅 All timestamps now reflect Square original data!')

  } catch (error) {
    console.error('💥 Fatal error during timestamp fix:', error)
  } finally {
    await prisma.$disconnect()
  }
}

fixTimestamps()
