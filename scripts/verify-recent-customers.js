#!/usr/bin/env node
/**
 * Verify that all customers created in Square in the last 2-3 weeks are in the database
 * Compares Square API customers with square_existing_clients table
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

// Remove "Bearer " prefix if present (Square SDK handles this automatically)
if (accessToken.startsWith('Bearer ')) {
  accessToken = accessToken.substring(7)
}

console.log(`🔑 Using Square ${environment === Environment.Production ? 'Production' : 'Sandbox'} environment`)

const squareClient = new Client({
  accessToken: accessToken,
  environment,
})

const customersApi = squareClient.customersApi

async function verifyRecentCustomers() {
  try {
    console.log('🔍 Verifying recent customers (last 3 weeks)...\n')
    console.log('='.repeat(80))
    
    // Calculate date 3 weeks ago
    const threeWeeksAgo = new Date()
    threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21)
    
    // Also check 2 weeks ago for comparison
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    
    console.log(`📅 Checking customers created from: ${threeWeeksAgo.toISOString()} to now\n`)
    
    // Step 1: Fetch customers from Square API created in last 3 weeks
    console.log('📡 Step 1: Fetching customers from Square API...')
    const squareCustomers = []
    let cursor = null
    let batchCount = 0
    let foundRecentCustomers = 0
    
    do {
      batchCount++
      console.log(`   Fetching batch ${batchCount}${cursor ? ` (cursor: ${cursor.substring(0, 20)}...)` : ''}...`)
      
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
        foundRecentCustomers += recentCustomers.length
        
        console.log(`   ✅ Found ${customers.length} customers in batch, ${recentCustomers.length} from last 3 weeks (Total recent: ${foundRecentCustomers})`)
        
        // If we're getting customers older than 3 weeks, we can stop early
        const oldestCustomer = customers.find(c => {
          if (!c.createdAt) return false
          return new Date(c.createdAt) < threeWeeksAgo
        })
        
        if (oldestCustomer && foundRecentCustomers > 0) {
          console.log(`   ℹ️  Found customers older than 3 weeks, but continuing to ensure we got all recent ones...`)
        }
        
        cursor = response.result.cursor
        
        // Small delay to avoid rate limiting
        if (cursor) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      } catch (error) {
        console.error(`   ❌ Error fetching batch: ${error.message}`)
        if (error.errors) {
          console.error('   Error details:', JSON.stringify(error.errors, null, 2))
        }
        break
      }
    } while (cursor)
    
    console.log(`\n✅ Total customers from Square API (last 3 weeks): ${squareCustomers.length}`)
    
    // Sort by creation date
    squareCustomers.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0)
      const dateB = new Date(b.createdAt || 0)
      return dateB - dateA
    })
    
    // Step 2: Check which ones are in the database
    console.log('\n💾 Step 2: Checking database for these customers...')
    
    const squareCustomerIds = squareCustomers.map(c => c.id)
    
    if (squareCustomerIds.length === 0) {
      console.log('   ℹ️  No customers found in Square from last 3 weeks')
      return
    }
    
    // Check database in batches to avoid SQL query size limits
    const batchSize = 100
    const dbCustomersMap = new Map()
    
    for (let i = 0; i < squareCustomerIds.length; i += batchSize) {
      const batch = squareCustomerIds.slice(i, i + batchSize)
      const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(', ')
      
      const dbCustomers = await prisma.$queryRaw`
        SELECT 
          square_customer_id,
          given_name,
          family_name,
          email_address,
          phone_number,
          created_at,
          updated_at,
          personal_code,
          got_signup_bonus,
          activated_as_referrer
        FROM square_existing_clients
        WHERE square_customer_id = ANY(${batch}::text[])
      `
      
      dbCustomers.forEach(c => {
        dbCustomersMap.set(c.square_customer_id, c)
      })
    }
    
    console.log(`   ✅ Found ${dbCustomersMap.size} customers in database`)
    
    // Step 3: Compare and find missing customers
    console.log('\n🔍 Step 3: Analyzing discrepancies...\n')
    
    const missingInDb = []
    const foundInDb = []
    const twoWeeksCustomers = []
    
    squareCustomers.forEach(squareCustomer => {
      const customerId = squareCustomer.id
      const createdAt = new Date(squareCustomer.createdAt)
      const isInLast2Weeks = createdAt >= twoWeeksAgo
      
      const dbCustomer = dbCustomersMap.get(customerId)
      
      if (!dbCustomer) {
        missingInDb.push({
          id: customerId,
          givenName: squareCustomer.givenName,
          familyName: squareCustomer.familyName,
          emailAddress: squareCustomer.emailAddress,
          phoneNumber: squareCustomer.phoneNumber,
          createdAt: squareCustomer.createdAt,
          isInLast2Weeks
        })
      } else {
        foundInDb.push({
          square: squareCustomer,
          db: dbCustomer
        })
        if (isInLast2Weeks) {
          twoWeeksCustomers.push({
            square: squareCustomer,
            db: dbCustomer
          })
        }
      }
    })
    
    // Step 4: Display results
    console.log('='.repeat(80))
    console.log('📊 SUMMARY')
    console.log('='.repeat(80))
    console.log(`\n✅ Found in Square API (last 3 weeks): ${squareCustomers.length}`)
    console.log(`   - In database: ${foundInDb.length}`)
    console.log(`   - Missing from database: ${missingInDb.length}`)
    console.log(`   - From last 2 weeks: ${twoWeeksCustomers.length + missingInDb.filter(c => c.isInLast2Weeks).length}`)
    
    if (missingInDb.length > 0) {
      console.log(`\n❌ MISSING CUSTOMERS (${missingInDb.length}):\n`)
      
      const missing2Weeks = missingInDb.filter(c => c.isInLast2Weeks)
      const missing3Weeks = missingInDb.filter(c => !c.isInLast2Weeks)
      
      if (missing2Weeks.length > 0) {
        console.log(`   Last 2 weeks (${missing2Weeks.length}):`)
        missing2Weeks.forEach((customer, idx) => {
          const name = `${customer.givenName || ''} ${customer.familyName || ''}`.trim() || 'Unknown'
          console.log(`   ${idx + 1}. ${customer.createdAt} - ${name}`)
          console.log(`      ID: ${customer.id}`)
          console.log(`      Email: ${customer.emailAddress || 'N/A'}`)
          console.log(`      Phone: ${customer.phoneNumber || 'N/A'}`)
        })
      }
      
      if (missing3Weeks.length > 0) {
        console.log(`\n   Weeks 2-3 (${missing3Weeks.length}):`)
        missing3Weeks.slice(0, 10).forEach((customer, idx) => {
          const name = `${customer.givenName || ''} ${customer.familyName || ''}`.trim() || 'Unknown'
          console.log(`   ${idx + 1}. ${customer.createdAt} - ${name} (${customer.id})`)
        })
        if (missing3Weeks.length > 10) {
          console.log(`   ... and ${missing3Weeks.length - 10} more`)
        }
      }
    } else {
      console.log(`\n✅ All customers from Square are in the database!`)
    }
    
    // Step 5: Check webhook logs
    console.log('\n📡 Step 5: Checking webhook logs...\n')
    
    const webhookRuns = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::bigint AS total_count,
        COUNT(*) FILTER (WHERE created_at >= ${threeWeeksAgo})::bigint AS last_3_weeks
      FROM giftcard_runs
      WHERE square_event_type = 'customer.created'
         OR trigger_type = 'customer.created'
    `
    
    const totalWebhooks = Number(webhookRuns[0].total_count)
    const recentWebhooks = Number(webhookRuns[0].last_3_weeks)
    
    console.log(`   Total customer.created webhooks: ${totalWebhooks}`)
    console.log(`   customer.created webhooks (last 3 weeks): ${recentWebhooks}`)
    console.log(`   Expected: ${squareCustomers.length}`)
    console.log(`   Difference: ${squareCustomers.length - recentWebhooks}`)
    
    if (recentWebhooks < squareCustomers.length) {
      console.log(`   ⚠️  Warning: Received fewer webhooks than customers created!`)
    } else if (recentWebhooks === squareCustomers.length) {
      console.log(`   ✅ Webhook count matches customer count!`)
    } else {
      console.log(`   ℹ️  More webhooks than customers (might include duplicates or retries)`)
    }
    
    console.log('\n' + '='.repeat(80))
    
    // Step 6: Show recent customers in database
    if (foundInDb.length > 0) {
      console.log('\n✅ RECENT CUSTOMERS IN DATABASE:\n')
      const recentInDb = foundInDb
        .filter(c => {
          const createdAt = new Date(c.db.created_at)
          return createdAt >= twoWeeksAgo
        })
        .slice(0, 10)
      
      recentInDb.forEach((customer, idx) => {
        const name = `${customer.db.given_name || ''} ${customer.db.family_name || ''}`.trim() || 'Unknown'
        console.log(`   ${idx + 1}. ${customer.db.created_at} - ${name}`)
        console.log(`      ID: ${customer.db.square_customer_id}`)
        console.log(`      Email: ${customer.db.email_address || 'N/A'}`)
        console.log(`      Personal Code: ${customer.db.personal_code || 'N/A'}`)
        console.log(`      Signup Bonus: ${customer.db.got_signup_bonus ? 'Yes' : 'No'}`)
        console.log(`      Referrer: ${customer.db.activated_as_referrer ? 'Yes' : 'No'}`)
      })
      
      if (foundInDb.filter(c => {
        const createdAt = new Date(c.db.created_at)
        return createdAt >= twoWeeksAgo
      }).length > 10) {
        console.log(`   ... and more`)
      }
    }
    
    console.log('\n')
    
  } catch (error) {
    console.error('❌ Error verifying recent customers:', error)
    console.error('Stack:', error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

verifyRecentCustomers()

