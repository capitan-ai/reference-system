#!/usr/bin/env node

/**
 * Compare Square customers with database
 * Identifies:
 * - Missing customers in DB
 * - Customers in DB but not in Square
 * - Customers missing email addresses
 * - Customers missing referral codes
 * - Data discrepancies
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')

const prisma = new PrismaClient()

// Initialize Square client
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
console.log(`🔑 Token: ${accessToken.substring(0, 20)}... (length: ${accessToken.length})`)

const squareClient = new Client({
  accessToken: accessToken,
  environment,
})

const customersApi = squareClient.customersApi

async function compareSquareWithDatabase() {
  try {
    console.log('🔍 Comparing Square customers with database...\n')
    console.log('='.repeat(60))
    
    // Step 1: Fetch all customers from Square
    console.log('\n📡 Step 1: Fetching all customers from Square API...')
    const squareCustomers = []
    let cursor = null
    let batchCount = 0
    
    do {
      batchCount++
      console.log(`   Fetching batch ${batchCount}${cursor ? ` (cursor: ${cursor.substring(0, 20)}...)` : ''}...`)
      
      try {
        const response = await customersApi.listCustomers(cursor || undefined)
        const customers = response.result.customers || []
        squareCustomers.push(...customers)
        console.log(`   ✅ Found ${customers.length} customers in this batch (Total: ${squareCustomers.length})`)
        
        cursor = response.result.cursor
        
        // Small delay to avoid rate limiting
        if (cursor) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      } catch (error) {
        console.error(`   ❌ Error fetching batch: ${error.message}`)
        if (error.errors) {
          console.error('   Error details:', error.errors)
        }
        break
      }
    } while (cursor)
    
    console.log(`\n✅ Total customers from Square: ${squareCustomers.length.toLocaleString()}`)
    
    // Step 2: Get all customers from database
    console.log('\n💾 Step 2: Fetching all customers from database...')
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
    
    console.log(`✅ Total customers in database: ${dbCustomers.length.toLocaleString()}`)
    
    // Step 3: Create maps for comparison
    console.log('\n🔍 Step 3: Analyzing data...')
    
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
    
    // Step 4: Find discrepancies
    console.log('\n📊 Step 4: Finding discrepancies...\n')
    
    // Customers in Square but not in DB
    const missingInDb = []
    squareMap.forEach((squareCustomer, id) => {
      if (!dbMap.has(id)) {
        missingInDb.push(squareCustomer)
      }
    })
    
    // Customers in DB but not in Square
    const missingInSquare = []
    dbMap.forEach((dbCustomer, id) => {
      if (!squareMap.has(id)) {
        missingInSquare.push(dbCustomer)
      }
    })
    
    // Customers with missing email in Square
    const squareMissingEmail = []
    squareMap.forEach((squareCustomer, id) => {
      if (!squareCustomer.emailAddress || squareCustomer.emailAddress.trim() === '') {
        squareMissingEmail.push(squareCustomer)
      }
    })
    
    // Customers with missing email in DB
    const dbMissingEmail = []
    dbMap.forEach((dbCustomer, id) => {
      if (!dbCustomer.emailAddress || dbCustomer.emailAddress.trim() === '') {
        dbMissingEmail.push(dbCustomer)
      }
    })
    
    // Customers with missing referral code in DB
    const dbMissingRefCode = []
    dbMap.forEach((dbCustomer, id) => {
      if (!dbCustomer.personalCode || dbCustomer.personalCode.trim() === '') {
        dbMissingRefCode.push(dbCustomer)
      }
    })
    
    // Customers ready for emails (have email + referral code)
    const readyForEmail = []
    dbMap.forEach((dbCustomer, id) => {
      if (dbCustomer.emailAddress && 
          dbCustomer.emailAddress.trim() !== '' &&
          dbCustomer.personalCode && 
          dbCustomer.personalCode.trim() !== '') {
        readyForEmail.push(dbCustomer)
      }
    })
    
    // Customers who haven't received email yet
    const pendingEmails = readyForEmail.filter(c => !c.referralEmailSent)
    
    // Data mismatches (same customer, different data)
    const dataMismatches = []
    squareMap.forEach((squareCustomer, id) => {
      const dbCustomer = dbMap.get(id)
      if (dbCustomer) {
        const mismatches = []
        if (squareCustomer.emailAddress !== dbCustomer.emailAddress) {
          mismatches.push(`Email: Square="${squareCustomer.emailAddress}" DB="${dbCustomer.emailAddress}"`)
        }
        if (squareCustomer.givenName !== dbCustomer.givenName) {
          mismatches.push(`Given Name: Square="${squareCustomer.givenName}" DB="${dbCustomer.givenName}"`)
        }
        if (squareCustomer.familyName !== dbCustomer.familyName) {
          mismatches.push(`Family Name: Square="${squareCustomer.familyName}" DB="${dbCustomer.familyName}"`)
        }
        if (mismatches.length > 0) {
          dataMismatches.push({
            squareCustomerId: id,
            name: `${squareCustomer.givenName || ''} ${squareCustomer.familyName || ''}`.trim() || 'Unknown',
            mismatches
          })
        }
      }
    })
    
    // Print Summary
    console.log('='.repeat(60))
    console.log('📊 COMPARISON SUMMARY')
    console.log('='.repeat(60))
    console.log(`\n📡 Square API:`)
    console.log(`   Total customers: ${squareCustomers.length.toLocaleString()}`)
    console.log(`   With email: ${(squareCustomers.length - squareMissingEmail.length).toLocaleString()}`)
    console.log(`   Missing email: ${squareMissingEmail.length.toLocaleString()}`)
    
    console.log(`\n💾 Database (square_existing_clients):`)
    console.log(`   Total customers: ${dbCustomers.length.toLocaleString()}`)
    console.log(`   With email: ${(dbCustomers.length - dbMissingEmail.length).toLocaleString()}`)
    console.log(`   Missing email: ${dbMissingEmail.length.toLocaleString()}`)
    console.log(`   With referral code: ${(dbCustomers.length - dbMissingRefCode.length).toLocaleString()}`)
    console.log(`   Missing referral code: ${dbMissingRefCode.length.toLocaleString()}`)
    console.log(`   Ready for emails: ${readyForEmail.length.toLocaleString()}`)
    console.log(`   Already sent emails: ${(readyForEmail.length - pendingEmails.length).toLocaleString()}`)
    console.log(`   Pending emails: ${pendingEmails.length.toLocaleString()}`)
    
    console.log(`\n⚠️  DISCREPANCIES:`)
    console.log(`   Missing in DB: ${missingInDb.length.toLocaleString()}`)
    console.log(`   Missing in Square: ${missingInSquare.length.toLocaleString()}`)
    console.log(`   Data mismatches: ${dataMismatches.length.toLocaleString()}`)
    
    // Show details
    if (missingInDb.length > 0) {
      console.log(`\n❌ Customers in Square but NOT in database (${missingInDb.length}):`)
      missingInDb.slice(0, 10).forEach((c, i) => {
        const name = `${c.givenName || ''} ${c.familyName || ''}`.trim() || 'Unknown'
        console.log(`   ${i + 1}. ${c.id} - ${name} (${c.emailAddress || 'no email'})`)
      })
      if (missingInDb.length > 10) {
        console.log(`   ... and ${missingInDb.length - 10} more`)
      }
    }
    
    if (missingInSquare.length > 0) {
      console.log(`\n⚠️  Customers in database but NOT in Square (${missingInSquare.length}):`)
      missingInSquare.slice(0, 10).forEach((c, i) => {
        const name = `${c.givenName || ''} ${c.familyName || ''}`.trim() || 'Unknown'
        console.log(`   ${i + 1}. ${c.squareCustomerId} - ${name} (${c.emailAddress || 'no email'})`)
      })
      if (missingInSquare.length > 10) {
        console.log(`   ... and ${missingInSquare.length - 10} more`)
      }
    }
    
    if (dataMismatches.length > 0) {
      console.log(`\n⚠️  Data mismatches (${dataMismatches.length}):`)
      dataMismatches.slice(0, 5).forEach((m, i) => {
        console.log(`   ${i + 1}. ${m.squareCustomerId} - ${m.name}`)
        m.mismatches.forEach(mm => console.log(`      - ${mm}`))
      })
      if (dataMismatches.length > 5) {
        console.log(`   ... and ${dataMismatches.length - 5} more`)
      }
    }
    
    if (dbMissingRefCode.length > 0) {
      console.log(`\n⚠️  Customers missing referral codes (${dbMissingRefCode.length}):`)
      dbMissingRefCode.slice(0, 10).forEach((c, i) => {
        const name = `${c.givenName || ''} ${c.familyName || ''}`.trim() || 'Unknown'
        console.log(`   ${i + 1}. ${c.squareCustomerId} - ${name} (${c.emailAddress || 'no email'})`)
      })
      if (dbMissingRefCode.length > 10) {
        console.log(`   ... and ${dbMissingRefCode.length - 10} more`)
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
    
    if (dbMissingRefCode.length > 0) {
      console.log(`\n2. Generate referral codes for ${dbMissingRefCode.length.toLocaleString()} customers:`)
      console.log('   Run: node scripts/generate-referral-links-for-all-customers.js')
    }
    
    if (pendingEmails.length > 0) {
      console.log(`\n3. Send referral code emails to ${pendingEmails.length.toLocaleString()} customers:`)
      console.log('   Run: DRY_RUN=false node scripts/send-referral-emails-to-all-customers.js')
    }
    
    if (dataMismatches.length > 0) {
      console.log(`\n4. Fix ${dataMismatches.length.toLocaleString()} data mismatches (update DB with Square data)`)
    }
    
    console.log('\n✅ Comparison complete!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
    if (error.errors) {
      console.error('Error details:', error.errors)
    }
  } finally {
    await prisma.$disconnect()
  }
}

// Run comparison
compareSquareWithDatabase()

