#!/usr/bin/env node

// Check Square customers for Bozhena and Yana/Iana
const dotenv = require('dotenv')
const path = require('path')

// Try loading .env.local first, then .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const { Client, Environment } = require('square')
const { PrismaClient } = require('@prisma/client')

const accessToken = process.env.SQUARE_ACCESS_TOKEN?.trim()
const squareEnv = process.env.SQUARE_ENV?.trim()

if (!accessToken) {
  console.error('❌ SQUARE_ACCESS_TOKEN is not set')
  process.exit(1)
}

const squareClient = new Client({
  accessToken,
  environment: squareEnv === 'production' ? Environment.Production : Environment.Sandbox,
})

const customersApi = squareClient.customersApi
const prisma = new PrismaClient()

async function checkSquareCustomers() {
  try {
    console.log('🔍 Checking Square customers for Bozhena and Yana/Iana...')
    console.log('='.repeat(60))
    console.log('')
    
    // List all Square customers
    console.log('📡 Fetching customers from Square...')
    let allCustomers = []
    let cursor = undefined
    
    do {
      const response = cursor 
        ? await customersApi.listCustomers(cursor)
        : await customersApi.listCustomers()
      
      if (response.result?.customers) {
        allCustomers.push(...response.result.customers)
      }
      
      cursor = response.result?.cursor
    } while (cursor)
    
    console.log(`✅ Found ${allCustomers.length} total customers in Square`)
    console.log('')
    
    // Search for Bozhena and Yana/Iana
    const searchTerms = ['bozhena', 'iana', 'yana']
    const foundCustomers = allCustomers.filter(customer => {
      const givenName = (customer.givenName || '').toLowerCase()
      const familyName = (customer.familyName || '').toLowerCase()
      const companyName = (customer.companyName || '').toLowerCase()
      const nickname = (customer.nickname || '').toLowerCase()
      
      return searchTerms.some(term => 
        givenName.includes(term) || 
        familyName.includes(term) || 
        companyName.includes(term) ||
        nickname.includes(term)
      )
    })
    
    if (foundCustomers.length === 0) {
      console.log('❌ No Square customers found with names containing "Bozhena", "Iana", or "Yana"')
      console.log('')
      console.log('📋 Showing first 20 Square customers:')
      allCustomers.slice(0, 20).forEach((c, idx) => {
        const name = `${c.givenName || ''} ${c.familyName || ''}`.trim() || c.companyName || 'Unknown'
        console.log(`   ${idx + 1}. ${name} (${c.emailAddress || 'no email'})`)
      })
      
      // Also check local database
      console.log('')
      console.log('🔍 Also checking local database...')
      const localCustomers = await prisma.customer.findMany({
        where: {
          OR: [
            { firstName: { contains: 'Bozhena', mode: 'insensitive' } },
            { firstName: { contains: 'Iana', mode: 'insensitive' } },
            { firstName: { contains: 'Yana', mode: 'insensitive' } },
            { fullName: { contains: 'Bozhena', mode: 'insensitive' } },
            { fullName: { contains: 'Iana', mode: 'insensitive' } },
            { fullName: { contains: 'Yana', mode: 'insensitive' } }
          ]
        },
        include: {
          RefLinks: true
        }
      })
      
      if (localCustomers.length > 0) {
        console.log(`✅ Found ${localCustomers.length} customer(s) in local database:`)
        localCustomers.forEach(c => {
          const name = c.fullName || `${c.firstName} ${c.lastName}`.trim() || 'Unknown'
          console.log(`   - ${name} (${c.email || 'no email'})`)
          console.log(`     Square ID: ${c.squareCustomerId || 'N/A'}`)
        })
      } else {
        console.log('❌ No matching customers in local database either')
      }
      
      return
    }
    
    console.log(`✅ Found ${foundCustomers.length} matching customer(s) in Square:`)
    console.log('')
    
    for (const customer of foundCustomers) {
      const name = `${customer.givenName || ''} ${customer.familyName || ''}`.trim() || customer.companyName || 'Unknown'
      console.log(`📋 ${name}`)
      console.log(`   Square Customer ID: ${customer.id}`)
      console.log(`   Given Name: ${customer.givenName || 'N/A'}`)
      console.log(`   Family Name: ${customer.familyName || 'N/A'}`)
      console.log(`   Company Name: ${customer.companyName || 'N/A'}`)
      console.log(`   Nickname: ${customer.nickname || 'N/A'}`)
      console.log(`   Email: ${customer.emailAddress || '❌ NO EMAIL'}`)
      console.log(`   Phone: ${customer.phoneNumber || 'N/A'}`)
      console.log(`   Created At: ${customer.createdAt || 'N/A'}`)
      
      // Check if exists in local database
      const localCustomer = await prisma.customer.findUnique({
        where: {
          squareCustomerId: customer.id
        },
        include: {
          RefLinks: {
            select: {
              refCode: true,
              url: true,
              status: true
            }
          }
        }
      })
      
      if (localCustomer) {
        console.log(`   ✅ Exists in local database`)
        console.log(`   Local Email: ${localCustomer.email || 'N/A'}`)
        console.log(`   Referral Links: ${localCustomer.RefLinks.length}`)
        if (localCustomer.RefLinks.length > 0) {
          localCustomer.RefLinks.forEach((link, idx) => {
            console.log(`      ${idx + 1}. Code: ${link.refCode}`)
            console.log(`         URL: ${link.url}`)
            console.log(`         Status: ${link.status}`)
          })
        }
      } else {
        console.log(`   ⚠️  NOT in local database`)
      }
      
      console.log('')
    }
    
    // Summary
    console.log('='.repeat(60))
    console.log('📊 Summary:')
    console.log(`   Found in Square: ${foundCustomers.length}`)
    const withEmail = foundCustomers.filter(c => c.emailAddress).length
    console.log(`   With email: ${withEmail}/${foundCustomers.length}`)
    
    const localMatches = await Promise.all(
      foundCustomers.map(c => 
        prisma.customer.findUnique({
          where: { squareCustomerId: c.id }
        })
      )
    )
    const inLocalDb = localMatches.filter(Boolean).length
    console.log(`   In local database: ${inLocalDb}/${foundCustomers.length}`)
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.errors) {
      console.error('Square API errors:', JSON.stringify(error.errors, null, 2))
    }
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkSquareCustomers()

