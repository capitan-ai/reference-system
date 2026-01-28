#!/usr/bin/env node
/**
 * Backfill missing customers from Square to database
 * Uses the verify-recent-customers.js script output to identify and add missing customers
 */

require('dotenv').config()
const prisma = require('../lib/prisma-client')
const { Client, Environment } = require('square')

const squareEnv = process.env.SQUARE_ENV?.trim()?.toLowerCase()
const environment = squareEnv === 'sandbox' ? Environment.Sandbox : Environment.Production
let accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()

if (!accessToken) {
  console.error('❌ SQUARE_ACCESS_TOKEN is not set in environment variables')
  process.exit(1)
}

// Remove "Bearer " prefix if present
if (accessToken.startsWith('Bearer ')) {
  accessToken = accessToken.substring(7)
}

const squareClient = new Client({
  accessToken: accessToken,
  environment,
})

const customersApi = squareClient.customersApi

function cleanValue(value) {
  if (!value) return null
  const cleaned = String(value).trim()
  return cleaned || null
}

async function backfillMissingCustomers() {
  try {
    console.log('🔍 Backfilling missing customers from Square...\n')
    console.log('='.repeat(80))
    
    // Calculate date 3 weeks ago
    const threeWeeksAgo = new Date()
    threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21)
    
    // Step 1: Fetch all customers from Square API created in last 3 weeks
    console.log('📡 Step 1: Fetching customers from Square API...')
    const squareCustomers = []
    let cursor = null
    let batchCount = 0
    
    do {
      batchCount++
      try {
        const response = await customersApi.listCustomers(cursor || undefined)
        const customers = response.result.customers || []
        
        // Filter customers created in last 3 weeks
        const recentCustomers = customers.filter(c => {
          if (!c.createdAt) return false
          const createdAt = new Date(c.createdAt)
          return createdAt >= threeWeeksAgo
        })
        
        squareCustomers.push(...recentCustomers)
        console.log(`   Batch ${batchCount}: Found ${customers.length} customers, ${recentCustomers.length} from last 3 weeks (Total: ${squareCustomers.length})`)
        
        cursor = response.result.cursor
        
        if (cursor) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      } catch (error) {
        console.error(`   ❌ Error fetching batch ${batchCount}:`, error.message)
        break
      }
    } while (cursor)
    
    console.log(`\n✅ Found ${squareCustomers.length} customers from Square API (last 3 weeks)\n`)
    
    // Step 2: Check which ones are already in the database
    console.log('💾 Step 2: Checking database...')
    
    const squareCustomerIds = squareCustomers.map(c => c.id)
    const dbCustomersMap = new Map()
    
    // Check database in batches
    const batchSize = 100
    for (let i = 0; i < squareCustomerIds.length; i += batchSize) {
      const batch = squareCustomerIds.slice(i, i + batchSize)
      const dbCustomers = await prisma.$queryRaw`
        SELECT square_customer_id
        FROM square_existing_clients
        WHERE square_customer_id = ANY(${batch}::text[])
      `
      
      dbCustomers.forEach(c => {
        dbCustomersMap.set(c.square_customer_id, true)
      })
    }
    
    console.log(`   ✅ Found ${dbCustomersMap.size} customers already in database\n`)
    
    // Step 3: Find missing customers
    const missingCustomers = squareCustomers.filter(c => !dbCustomersMap.has(c.id))
    
    console.log(`📊 Step 3: Found ${missingCustomers.length} missing customers\n`)
    
    if (missingCustomers.length === 0) {
      console.log('✅ All customers are already in the database!')
      return
    }
    
    // Step 4: Add missing customers to database
    console.log(`➕ Step 4: Adding ${missingCustomers.length} missing customers...\n`)
    
    let addedCount = 0
    let errorCount = 0
    
    for (const customer of missingCustomers) {
      try {
        const customerId = customer.id
        const givenName = cleanValue(
          customer.givenName || 
          customer.firstName
        )
        const familyName = cleanValue(
          customer.familyName || 
          customer.lastName
        )
        const emailAddress = cleanValue(
          customer.emailAddress || 
          customer.email
        )
        const phoneNumber = cleanValue(
          customer.phoneNumber || 
          customer.phone
        )
        
        const name = `${givenName || ''} ${familyName || ''}`.trim() || 'Unknown'
        const createdAt = customer.createdAt ? new Date(customer.createdAt) : new Date()
        
        // Insert customer into database
        await prisma.$executeRaw`
          INSERT INTO square_existing_clients (
            square_customer_id,
            given_name,
            family_name,
            email_address,
            phone_number,
            got_signup_bonus,
            activated_as_referrer,
            personal_code,
            gift_card_id,
            used_referral_code,
            first_ip_address,
            ip_addresses,
            referral_email_sent,
            created_at,
            updated_at
          ) VALUES (
            ${customerId},
            ${givenName},
            ${familyName},
            ${emailAddress},
            ${phoneNumber},
            FALSE,
            FALSE,
            NULL,
            NULL,
            NULL,
            NULL,
            ARRAY[]::text[],
            FALSE,
            ${createdAt},
            NOW()
          )
          ON CONFLICT (square_customer_id) DO UPDATE SET
            given_name = COALESCE(square_existing_clients.given_name, EXCLUDED.given_name),
            family_name = COALESCE(square_existing_clients.family_name, EXCLUDED.family_name),
            email_address = COALESCE(square_existing_clients.email_address, EXCLUDED.email_address),
            phone_number = COALESCE(square_existing_clients.phone_number, EXCLUDED.phone_number),
            updated_at = NOW()
        `
        
        addedCount++
        console.log(`   ✅ ${addedCount}. ${name} (${customerId}) - ${emailAddress || 'No email'}`)
        
      } catch (error) {
        errorCount++
        console.error(`   ❌ Error adding customer ${customer.id}:`, error.message)
      }
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('📊 SUMMARY')
    console.log('='.repeat(80))
    console.log(`\n✅ Successfully added: ${addedCount}`)
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount}`)
    }
    console.log(`\n✅ Total customers from Square (last 3 weeks): ${squareCustomers.length}`)
    console.log(`✅ Now in database: ${dbCustomersMap.size + addedCount}`)
    console.log(`✅ Coverage: ${((dbCustomersMap.size + addedCount) / squareCustomers.length * 100).toFixed(1)}%`)
    
  } catch (error) {
    console.error('❌ Error backfilling customers:', error)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

backfillMissingCustomers()



