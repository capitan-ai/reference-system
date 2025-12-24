#!/usr/bin/env node

/**
 * Fetch all customers from Square API and compare with database
 * Identifies missing customers, data mismatches, and what needs to be synced
 */

const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

// Prefer .env.local (matches Next.js behavior) but fall back to .env
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

const prisma = new PrismaClient()

// Initialize Square client with better error handling
function initializeSquareClient() {
  const squareEnv = process.env.SQUARE_ENV?.trim()?.toLowerCase()
  const environment = squareEnv === 'sandbox' ? Environment.Sandbox : Environment.Production
  let accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()

  if (!accessToken) {
    throw new Error('SQUARE_ACCESS_TOKEN is not set in environment variables')
  }

  // Remove "Bearer " prefix if present (Square SDK handles this automatically)
  if (accessToken.startsWith('Bearer ')) {
    accessToken = accessToken.substring(7)
  }

  console.log(`🔑 Square Environment: ${environment === Environment.Production ? 'Production' : 'Sandbox'}`)
  console.log(`🔑 Token length: ${accessToken.length} characters`)
  console.log(`🔑 Token starts with: ${accessToken.substring(0, 10)}...`)

  return new Client({
    accessToken: accessToken,
    environment,
  })
}

async function fetchAllSquareCustomers(squareClient) {
  console.log('\n📡 Fetching all customers from Square API...')
  console.log('='.repeat(60))
  
  const allCustomers = []
  let cursor = null
  let batchCount = 0
  let totalFetched = 0

  try {
    do {
      batchCount++
      console.log(`\n📦 Batch ${batchCount}${cursor ? ` (cursor: ${cursor.substring(0, 20)}...)` : ''}`)
      
      try {
        const response = await squareClient.customersApi.listCustomers(cursor || undefined)
        const customers = response.result.customers || []
        
        allCustomers.push(...customers)
        totalFetched += customers.length
        
        console.log(`   ✅ Fetched ${customers.length} customers (Total: ${totalFetched})`)
        
        cursor = response.result.cursor
        
        // Small delay to avoid rate limiting
        if (cursor) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      } catch (error) {
        console.error(`   ❌ Error fetching batch ${batchCount}:`, error.message)
        if (error.errors && error.errors.length > 0) {
          error.errors.forEach(err => {
            console.error(`      - ${err.category}: ${err.code} - ${err.detail}`)
          })
        }
        throw error
      }
    } while (cursor)

    console.log(`\n✅ Successfully fetched ${allCustomers.length.toLocaleString()} customers from Square`)
    return allCustomers
  } catch (error) {
    console.error('\n❌ Failed to fetch customers from Square API')
    console.error(`   Error: ${error.message}`)
    if (error.errors) {
      error.errors.forEach(err => {
        console.error(`   ${err.category}: ${err.code} - ${err.detail}`)
      })
    }
    throw error
  }
}

async function getDatabaseCustomers() {
  console.log('\n💾 Fetching all customers from database...')
  console.log('='.repeat(60))
  
  const dbCustomers = await prisma.$queryRaw`
    SELECT 
      square_customer_id,
      given_name,
      family_name,
      email_address,
      phone_number,
      personal_code,
      referral_url,
      referral_email_sent,
      activated_as_referrer,
      created_at,
      updated_at
    FROM square_existing_clients
    ORDER BY square_customer_id
  `
  
  console.log(`✅ Found ${dbCustomers.length.toLocaleString()} customers in database`)
  return dbCustomers
}

async function compareAndAnalyze(squareCustomers, dbCustomers) {
  console.log('\n🔍 Analyzing and comparing data...')
  console.log('='.repeat(60))
  
  // Create maps for quick lookup
  const squareMap = new Map()
  squareCustomers.forEach(c => {
    squareMap.set(c.id, {
      id: c.id,
      givenName: c.givenName || null,
      familyName: c.familyName || null,
      emailAddress: c.emailAddress || null,
      phoneNumber: c.phoneNumber || null,
      createdAt: c.createdAt || null,
      updatedAt: c.updatedAt || null,
    })
  })
  
  const dbMap = new Map()
  dbCustomers.forEach(c => {
    dbMap.set(c.square_customer_id, {
      squareCustomerId: c.square_customer_id,
      givenName: c.given_name,
      familyName: c.family_name,
      emailAddress: c.email_address,
      phoneNumber: c.phone_number,
      personalCode: c.personal_code,
      referralUrl: c.referral_url,
      referralEmailSent: c.referral_email_sent,
      activatedAsReferrer: c.activated_as_referrer,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })
  })
  
  // Analysis
  const missingInDb = []
  const missingInSquare = []
  const dataMismatches = []
  const squareWithEmail = []
  const squareWithoutEmail = []
  const dbWithEmail = []
  const dbWithoutEmail = []
  const dbWithRefCode = []
  const dbWithoutRefCode = []
  
  // Check Square customers
  squareMap.forEach((squareCustomer, id) => {
    if (!dbMap.has(id)) {
      missingInDb.push(squareCustomer)
    } else {
      const dbCustomer = dbMap.get(id)
      const mismatches = []
      
      if (squareCustomer.emailAddress !== dbCustomer.emailAddress) {
        mismatches.push({
          field: 'email',
          square: squareCustomer.emailAddress,
          db: dbCustomer.emailAddress
        })
      }
      if (squareCustomer.givenName !== dbCustomer.givenName) {
        mismatches.push({
          field: 'givenName',
          square: squareCustomer.givenName,
          db: dbCustomer.givenName
        })
      }
      if (squareCustomer.familyName !== dbCustomer.familyName) {
        mismatches.push({
          field: 'familyName',
          square: squareCustomer.familyName,
          db: dbCustomer.familyName
        })
      }
      if (squareCustomer.phoneNumber !== dbCustomer.phoneNumber) {
        mismatches.push({
          field: 'phoneNumber',
          square: squareCustomer.phoneNumber,
          db: dbCustomer.phoneNumber
        })
      }
      
      if (mismatches.length > 0) {
        dataMismatches.push({
          squareCustomerId: id,
          name: `${squareCustomer.givenName || ''} ${squareCustomer.familyName || ''}`.trim() || 'Unknown',
          mismatches
        })
      }
    }
    
    if (squareCustomer.emailAddress && squareCustomer.emailAddress.trim() !== '') {
      squareWithEmail.push(squareCustomer)
    } else {
      squareWithoutEmail.push(squareCustomer)
    }
  })
  
  // Check DB customers
  dbMap.forEach((dbCustomer, id) => {
    if (!squareMap.has(id)) {
      missingInSquare.push(dbCustomer)
    }
    
    if (dbCustomer.emailAddress && dbCustomer.emailAddress.trim() !== '') {
      dbWithEmail.push(dbCustomer)
    } else {
      dbWithoutEmail.push(dbCustomer)
    }
    
    if (dbCustomer.personalCode && dbCustomer.personalCode.trim() !== '') {
      dbWithRefCode.push(dbCustomer)
    } else {
      dbWithoutRefCode.push(dbCustomer)
    }
  })
  
  // Ready for emails
  const readyForEmail = dbCustomers.filter(c => 
    c.email_address && 
    c.email_address.trim() !== '' &&
    c.personal_code && 
    c.personal_code.trim() !== ''
  )
  
  const pendingEmails = readyForEmail.filter(c => !c.referral_email_sent)
  
  // Print comprehensive report
  console.log('\n' + '='.repeat(60))
  console.log('📊 COMPREHENSIVE COMPARISON REPORT')
  console.log('='.repeat(60))
  
  console.log('\n📡 SQUARE API DATA:')
  console.log(`   Total customers: ${squareCustomers.length.toLocaleString()}`)
  console.log(`   With email: ${squareWithEmail.length.toLocaleString()}`)
  console.log(`   Without email: ${squareWithoutEmail.length.toLocaleString()}`)
  
  console.log('\n💾 DATABASE DATA (square_existing_clients):')
  console.log(`   Total customers: ${dbCustomers.length.toLocaleString()}`)
  console.log(`   With email: ${dbWithEmail.length.toLocaleString()}`)
  console.log(`   Without email: ${dbWithoutEmail.length.toLocaleString()}`)
  console.log(`   With referral code: ${dbWithRefCode.length.toLocaleString()}`)
  console.log(`   Without referral code: ${dbWithoutRefCode.length.toLocaleString()}`)
  console.log(`   Ready for emails: ${readyForEmail.length.toLocaleString()}`)
  console.log(`   Already sent emails: ${(readyForEmail.length - pendingEmails.length).toLocaleString()}`)
  console.log(`   Pending emails: ${pendingEmails.length.toLocaleString()}`)
  
  console.log('\n⚠️  DISCREPANCIES:')
  console.log(`   Missing in DB: ${missingInDb.length.toLocaleString()}`)
  console.log(`   Missing in Square: ${missingInSquare.length.toLocaleString()}`)
  console.log(`   Data mismatches: ${dataMismatches.length.toLocaleString()}`)
  
  // Show details
  if (missingInDb.length > 0) {
    console.log(`\n❌ Customers in Square but NOT in database (${missingInDb.length}):`)
    missingInDb.slice(0, 20).forEach((c, i) => {
      const name = `${c.givenName || ''} ${c.familyName || ''}`.trim() || 'Unknown'
      console.log(`   ${i + 1}. ${c.id} - ${name} (${c.emailAddress || 'no email'})`)
    })
    if (missingInDb.length > 20) {
      console.log(`   ... and ${missingInDb.length - 20} more`)
    }
  }
  
  if (missingInSquare.length > 0) {
    console.log(`\n⚠️  Customers in database but NOT in Square (${missingInSquare.length}):`)
    missingInSquare.slice(0, 20).forEach((c, i) => {
      const name = `${c.givenName || ''} ${c.familyName || ''}`.trim() || 'Unknown'
      console.log(`   ${i + 1}. ${c.squareCustomerId} - ${name} (${c.emailAddress || 'no email'})`)
    })
    if (missingInSquare.length > 20) {
      console.log(`   ... and ${missingInSquare.length - 20} more`)
    }
  }
  
  if (dataMismatches.length > 0) {
    console.log(`\n⚠️  Data mismatches (${dataMismatches.length}):`)
    dataMismatches.slice(0, 10).forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.squareCustomerId} - ${m.name}`)
      m.mismatches.forEach(mm => {
        console.log(`      - ${mm.field}: Square="${mm.square}" DB="${mm.db}"`)
      })
    })
    if (dataMismatches.length > 10) {
      console.log(`   ... and ${dataMismatches.length - 10} more`)
    }
  }
  
  if (dbWithoutRefCode.length > 0) {
    console.log(`\n⚠️  Customers missing referral codes (${dbWithoutRefCode.length}):`)
    dbWithoutRefCode.slice(0, 10).forEach((c, i) => {
      const name = `${c.givenName || ''} ${c.familyName || ''}`.trim() || 'Unknown'
      console.log(`   ${i + 1}. ${c.squareCustomerId} - ${name} (${c.emailAddress || 'no email'})`)
    })
    if (dbWithoutRefCode.length > 10) {
      console.log(`   ... and ${dbWithoutRefCode.length - 10} more`)
    }
  }
  
  // Recommendations
  console.log('\n' + '='.repeat(60))
  console.log('💡 RECOMMENDATIONS')
  console.log('='.repeat(60))
  
  if (missingInDb.length > 0) {
    console.log(`\n1. Import ${missingInDb.length.toLocaleString()} missing customers from Square:`)
    console.log('   Run: node scripts/fast-import-customers.js')
  }
  
  if (dbWithoutRefCode.length > 0) {
    console.log(`\n2. Generate referral codes for ${dbWithoutRefCode.length.toLocaleString()} customers:`)
    console.log('   Run: node scripts/generate-referral-links-for-all-customers.js')
  }
  
  if (dataMismatches.length > 0) {
    console.log(`\n3. Sync data for ${dataMismatches.length.toLocaleString()} customers (update DB with Square data)`)
  }
  
  if (pendingEmails.length > 0) {
    console.log(`\n4. Send referral code emails to ${pendingEmails.length.toLocaleString()} customers:`)
    console.log('   Run: DRY_RUN=false node scripts/send-referral-emails-to-all-customers.js')
  }
  
  return {
    squareCustomers,
    dbCustomers,
    missingInDb,
    missingInSquare,
    dataMismatches,
    dbWithoutRefCode,
    pendingEmails
  }
}

async function main() {
  try {
    console.log('🔍 Square vs Database Customer Comparison')
    console.log('='.repeat(60))
    
    // Initialize Square client
    let squareClient
    try {
      squareClient = initializeSquareClient()
    } catch (error) {
      console.error('❌ Failed to initialize Square client:', error.message)
      console.log('\n⚠️  Cannot fetch from Square API. Showing database-only analysis...\n')
      
      // Still show database analysis
      const dbCustomers = await getDatabaseCustomers()
      
      console.log('\n💾 DATABASE SUMMARY:')
      console.log(`   Total customers: ${dbCustomers.length.toLocaleString()}`)
      const withEmail = dbCustomers.filter(c => c.email_address && c.email_address.trim() !== '').length
      const withCode = dbCustomers.filter(c => c.personal_code && c.personal_code.trim() !== '').length
      const ready = dbCustomers.filter(c => 
        c.email_address && c.email_address.trim() !== '' &&
        c.personal_code && c.personal_code.trim() !== ''
      ).length
      
      console.log(`   With email: ${withEmail.toLocaleString()}`)
      console.log(`   With referral code: ${withCode.toLocaleString()}`)
      console.log(`   Ready for emails: ${ready.toLocaleString()}`)
      
      return
    }
    
    // Fetch from Square
    const squareCustomers = await fetchAllSquareCustomers(squareClient)
    
    // Fetch from database
    const dbCustomers = await getDatabaseCustomers()
    
    // Compare and analyze
    await compareAndAnalyze(squareCustomers, dbCustomers)
    
    console.log('\n✅ Comparison complete!')
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

// Run
main()

