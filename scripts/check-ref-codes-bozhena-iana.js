#!/usr/bin/env node

// Check if Bozhena V and Iana Zorina have referral codes
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const CUSTOMERS = [
  {
    name: 'Iana Zorina',
    squareId: '70WNH5QYS71S32NG7Z77YW4DA8'
  },
  {
    name: 'Bozhena V',
    squareId: 'BG84AFYW767H4Y3XZB8S8P8ME4'
  }
]

async function checkRefCodes() {
  try {
    console.log('🔍 Checking referral codes for Bozhena V and Iana Zorina...')
    console.log('='.repeat(60))
    console.log('')
    
    for (const customerInfo of CUSTOMERS) {
      console.log(`📋 ${customerInfo.name}`)
      console.log(`   Square ID: ${customerInfo.squareId}`)
      
      // Check customer
      const customer = await prisma.customer.findUnique({
        where: {
          squareCustomerId: customerInfo.squareId
        },
        include: {
          RefLinks: {
            where: {
              status: 'ACTIVE'
            },
            orderBy: {
              createdAt: 'desc'
            }
          }
        }
      })
      
      if (!customer) {
        console.log(`   ❌ Customer not found in database`)
        console.log('')
        continue
      }
      
      console.log(`   ✅ Found in database`)
      console.log(`   ID: ${customer.id}`)
      console.log(`   Email: ${customer.email || 'N/A'}`)
      console.log(`   Full Name: ${customer.fullName || 'N/A'}`)
      console.log(`   Referral Links: ${customer.RefLinks.length}`)
      
      if (customer.RefLinks.length > 0) {
        console.log(`\n   ✅ HAS REFERRAL CODE(S):`)
        customer.RefLinks.forEach((link, idx) => {
          console.log(`\n   ${idx + 1}. Referral Code: ${link.refCode}`)
          console.log(`      URL: ${link.url}`)
          console.log(`      Status: ${link.status}`)
          console.log(`      Created: ${link.createdAt}`)
        })
      } else {
        console.log(`\n   ❌ NO REFERRAL CODE`)
        console.log(`   They don't have an active referral link yet.`)
      }
      
      // Also check for any inactive referral links
      const allRefLinks = await prisma.refLink.findMany({
        where: {
          customerId: customer.id
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
      
      if (allRefLinks.length > customer.RefLinks.length) {
        const inactiveCount = allRefLinks.length - customer.RefLinks.length
        console.log(`\n   ⚠️  Also has ${inactiveCount} inactive referral link(s)`)
      }
      
      console.log('')
      console.log('   ' + '─'.repeat(50))
      console.log('')
    }
    
    console.log('\n✅ Check complete!')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkRefCodes()

