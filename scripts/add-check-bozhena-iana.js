#!/usr/bin/env node

// Check and add Bozhena V and Iana Zorina to database
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')
const { Client, Environment } = require('square')
const dotenv = require('dotenv')
const path = require('path')

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const prisma = new PrismaClient()

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN?.trim(),
  environment: process.env.SQUARE_ENV === 'production' ? Environment.Production : Environment.Sandbox,
})

const customersApi = squareClient.customersApi

const CUSTOMERS = [
  {
    name: 'Iana Zorina',
    email: 'yana@studiozorina.com',
    squareId: '70WNH5QYS71S32NG7Z77YW4DA8'
  },
  {
    name: 'Bozhena V',
    email: 'Goddbbaby@gmail.com',
    squareId: 'BG84AFYW767H4Y3XZB8S8P8ME4'
  }
]

async function checkAndAddCustomers() {
  try {
    console.log('🔍 Checking Bozhena V and Iana Zorina in database...')
    console.log('='.repeat(60))
    console.log('')
    
    for (const customerInfo of CUSTOMERS) {
      console.log(`\n📋 Checking: ${customerInfo.name}`)
      console.log(`   Square ID: ${customerInfo.squareId}`)
      
      // Check if exists in local database
      let localCustomer = await prisma.customer.findUnique({
        where: {
          squareCustomerId: customerInfo.squareId
        },
        include: {
          RefLinks: true
        }
      })
      
      if (localCustomer) {
        console.log(`   ✅ Already exists in database`)
        console.log(`   ID: ${localCustomer.id}`)
        console.log(`   Email: ${localCustomer.email || 'N/A'}`)
        console.log(`   Full Name: ${localCustomer.fullName || 'N/A'}`)
        console.log(`   Referral Links: ${localCustomer.RefLinks.length}`)
        if (localCustomer.RefLinks.length > 0) {
          localCustomer.RefLinks.forEach((link, idx) => {
            console.log(`      ${idx + 1}. Code: ${link.refCode}`)
            console.log(`         URL: ${link.url}`)
            console.log(`         Status: ${link.status}`)
          })
        }
      } else {
        console.log(`   ⚠️  NOT in database - fetching from Square and adding...`)
        
        // Fetch customer details from Square
        try {
          const squareCustomer = await customersApi.retrieveCustomer(customerInfo.squareId)
          const sqCustomer = squareCustomer.result?.customer
          
          if (!sqCustomer) {
            console.log(`   ❌ Customer not found in Square`)
            continue
          }
          
          console.log(`   📡 Fetched from Square:`)
          console.log(`      Name: ${sqCustomer.givenName || ''} ${sqCustomer.familyName || ''}`.trim())
          console.log(`      Email: ${sqCustomer.emailAddress || 'N/A'}`)
          console.log(`      Phone: ${sqCustomer.phoneNumber || 'N/A'}`)
          
          // Create customer in database
          const firstName = sqCustomer.givenName || customerInfo.name.split(' ')[0] || null
          const lastName = sqCustomer.familyName || (customerInfo.name.split(' ').length > 1 ? customerInfo.name.split(' ').slice(1).join(' ') : null) || null
          const fullName = sqCustomer.givenName && sqCustomer.familyName 
            ? `${sqCustomer.givenName} ${sqCustomer.familyName}`.trim()
            : customerInfo.name
          
          localCustomer = await prisma.customer.create({
            data: {
              squareCustomerId: customerInfo.squareId,
              firstName: firstName,
              lastName: lastName,
              fullName: fullName,
              email: sqCustomer.emailAddress || customerInfo.email || null,
              phoneE164: sqCustomer.phoneNumber || null,
              firstPaidSeen: false
            },
            include: {
              RefLinks: true
            }
          })
          
          console.log(`   ✅ Added to database!`)
          console.log(`   ID: ${localCustomer.id}`)
          console.log(`   Email: ${localCustomer.email || 'N/A'}`)
          console.log(`   Full Name: ${localCustomer.fullName || 'N/A'}`)
          
          // Check if they need a referral link
          if (localCustomer.RefLinks.length === 0) {
            console.log(`   ⚠️  No referral link found - they may need one created`)
          }
          
        } catch (error) {
          console.log(`   ❌ Error fetching from Square: ${error.message}`)
          // Still try to create with available info
          try {
            const firstName = customerInfo.name.split(' ')[0] || null
            const lastName = customerInfo.name.split(' ').length > 1 ? customerInfo.name.split(' ').slice(1).join(' ') : null
            
            localCustomer = await prisma.customer.create({
              data: {
                squareCustomerId: customerInfo.squareId,
                firstName: firstName,
                lastName: lastName,
                fullName: customerInfo.name,
                email: customerInfo.email || null,
                firstPaidSeen: false
              },
              include: {
                RefLinks: true
              }
            })
            
            console.log(`   ✅ Added to database with available info!`)
            console.log(`   ID: ${localCustomer.id}`)
          } catch (createError) {
            console.log(`   ❌ Failed to create: ${createError.message}`)
          }
        }
      }
      
      console.log('   ' + '─'.repeat(50))
    }
    
    // Final check - list all customers again
    console.log('\n\n🔍 Final Check - Verifying in database:')
    console.log('='.repeat(60))
    
    for (const customerInfo of CUSTOMERS) {
      const finalCheck = await prisma.customer.findUnique({
        where: {
          squareCustomerId: customerInfo.squareId
        },
        include: {
          RefLinks: true
        }
      })
      
      if (finalCheck) {
        console.log(`\n✅ ${customerInfo.name}`)
        console.log(`   ID: ${finalCheck.id}`)
        console.log(`   Square ID: ${finalCheck.squareCustomerId}`)
        console.log(`   Email: ${finalCheck.email || 'N/A'}`)
        console.log(`   Full Name: ${finalCheck.fullName || 'N/A'}`)
        console.log(`   Referral Links: ${finalCheck.RefLinks.length}`)
        if (finalCheck.RefLinks.length > 0) {
          finalCheck.RefLinks.forEach((link, idx) => {
            console.log(`      ${idx + 1}. ${link.refCode} (${link.status})`)
          })
        }
      } else {
        console.log(`\n❌ ${customerInfo.name} - NOT FOUND`)
      }
    }
    
    console.log('\n✅ Check complete!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkAndAddCustomers()

