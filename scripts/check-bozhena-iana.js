#!/usr/bin/env node

// Check if Bozhena and Iana exist in the database
require('dotenv').config()

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkCustomers() {
  try {
    console.log('🔍 Checking for Bozhena and Iana in database...')
    console.log('='.repeat(60))
    console.log('')
    
    // Find customers by name (case-insensitive partial match)
    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { firstName: { contains: 'Bozhena', mode: 'insensitive' } },
          { firstName: { contains: 'Iana', mode: 'insensitive' } },
          { fullName: { contains: 'Bozhena', mode: 'insensitive' } },
          { fullName: { contains: 'Iana', mode: 'insensitive' } },
          { lastName: { contains: 'Bozhena', mode: 'insensitive' } },
          { lastName: { contains: 'Iana', mode: 'insensitive' } }
        ]
      },
      include: {
        RefLinks: {
          select: {
            refCode: true,
            url: true,
            status: true
          }
        }
      },
      orderBy: {
        firstName: 'asc'
      }
    })
    
    if (customers.length === 0) {
      console.log('❌ No customers found with names containing "Bozhena" or "Iana"')
      console.log('')
      console.log('📋 Showing first 20 customers in database:')
      const allCustomers = await prisma.customer.findMany({
        take: 20,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          fullName: true,
          email: true,
          squareCustomerId: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
      
      if (allCustomers.length === 0) {
        console.log('   No customers in database')
      } else {
        allCustomers.forEach((c, idx) => {
          const name = c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown'
          console.log(`   ${idx + 1}. ${name} (${c.email || 'no email'})`)
        })
      }
      return
    }
    
    console.log(`✅ Found ${customers.length} customer(s):`)
    console.log('')
    
    customers.forEach((c, idx) => {
      const name = c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown'
      console.log(`${idx + 1}. ${name}`)
      console.log(`   ID: ${c.id}`)
      console.log(`   First Name: ${c.firstName || 'N/A'}`)
      console.log(`   Last Name: ${c.lastName || 'N/A'}`)
      console.log(`   Full Name: ${c.fullName || 'N/A'}`)
      console.log(`   Email: ${c.email || '❌ NO EMAIL'}`)
      console.log(`   Phone: ${c.phoneE164 || 'N/A'}`)
      console.log(`   Square Customer ID: ${c.squareCustomerId || 'N/A'}`)
      console.log(`   Referral Links: ${c.RefLinks.length}`)
      
      if (c.RefLinks.length > 0) {
        c.RefLinks.forEach((link, linkIdx) => {
          console.log(`      ${linkIdx + 1}. Code: ${link.refCode}`)
          console.log(`         URL: ${link.url}`)
          console.log(`         Status: ${link.status}`)
        })
      } else {
        console.log(`      ⚠️  No referral links found`)
      }
      
      console.log('')
    })
    
    // Summary
    console.log('='.repeat(60))
    console.log('📊 Summary:')
    console.log(`   Total found: ${customers.length}`)
    const withEmail = customers.filter(c => c.email).length
    const withRefLinks = customers.filter(c => c.RefLinks.length > 0).length
    console.log(`   With email: ${withEmail}/${customers.length}`)
    console.log(`   With referral links: ${withRefLinks}/${customers.length}`)
    
    if (withEmail === customers.length && withRefLinks === customers.length) {
      console.log('\n✅ Ready to send emails!')
    } else {
      console.log('\n⚠️  Some customers are missing email or referral links')
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkCustomers()

