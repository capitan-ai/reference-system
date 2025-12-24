#!/usr/bin/env node

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkAllCustomers() {
  try {
    console.log('🔍 Checking All Customers and Referral URLs')
    console.log('='.repeat(60))
    console.log('')
    
    // Count total customers
    const totalCustomers = await prisma.customer.count()
    console.log(`📊 Total Customers in Database: ${totalCustomers}`)
    
    // Count customers with referral links
    const customersWithRefLinks = await prisma.customer.count({
      where: {
        RefLinks: {
          some: {
            status: 'ACTIVE'
          }
        }
      }
    })
    
    // Count total referral links
    const totalRefLinks = await prisma.refLink.count()
    const activeRefLinks = await prisma.refLink.count({
      where: {
        status: 'ACTIVE'
      }
    })
    
    console.log(`📊 Customers with Referral Links: ${customersWithRefLinks}`)
    console.log(`📊 Total Referral Links: ${totalRefLinks}`)
    console.log(`📊 Active Referral Links: ${activeRefLinks}`)
    console.log('')
    
    // Calculate missing
    const missingRefLinks = totalCustomers - customersWithRefLinks
    const percentage = totalCustomers > 0 
      ? ((customersWithRefLinks / totalCustomers) * 100).toFixed(1)
      : 0
    
    console.log('='.repeat(60))
    console.log('📈 Statistics:')
    console.log('')
    console.log(`   Total Customers: ${totalCustomers}`)
    console.log(`   With Referral Links: ${customersWithRefLinks} (${percentage}%)`)
    console.log(`   Missing Referral Links: ${missingRefLinks}`)
    console.log('')
    
    if (missingRefLinks > 0) {
      console.log('⚠️  Some customers are missing referral links!')
      console.log('')
      console.log('📋 Sample customers WITHOUT referral links:')
      
      const customersWithoutRefLinks = await prisma.customer.findMany({
        where: {
          RefLinks: {
            none: {}
          }
        },
        take: 10,
        select: {
          id: true,
          fullName: true,
          firstName: true,
          lastName: true,
          email: true,
          squareCustomerId: true,
          createdAt: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
      
      customersWithoutRefLinks.forEach((customer, index) => {
        const name = customer.fullName || 
                    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 
                    customer.email || 
                    'Unknown'
        console.log(`   ${index + 1}. ${name}`)
        console.log(`      ID: ${customer.id}`)
        console.log(`      Square ID: ${customer.squareCustomerId || 'N/A'}`)
        console.log(`      Email: ${customer.email || 'N/A'}`)
        console.log(`      Created: ${customer.createdAt.toISOString().split('T')[0]}`)
        console.log('')
      })
      
      if (missingRefLinks > 10) {
        console.log(`   ... and ${missingRefLinks - 10} more customers without referral links`)
        console.log('')
      }
    } else {
      console.log('✅ All customers have referral links!')
      console.log('')
    }
    
    // Check for customers with multiple referral links
    const customersWithMultipleRefLinks = await prisma.customer.findMany({
      where: {
        RefLinks: {
          some: {}
        }
      },
      include: {
        RefLinks: true
      }
    })
    
    const multipleRefLinks = customersWithMultipleRefLinks.filter(
      c => c.RefLinks.length > 1
    )
    
    if (multipleRefLinks.length > 0) {
      console.log('⚠️  Customers with multiple referral links:')
      multipleRefLinks.slice(0, 5).forEach(customer => {
        const name = customer.fullName || 
                    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 
                    customer.email || 
                    'Unknown'
        console.log(`   ${name}: ${customer.RefLinks.length} links`)
        customer.RefLinks.forEach(link => {
          console.log(`      - ${link.refCode}: ${link.url} (${link.status})`)
        })
      })
      console.log('')
    }
    
    // Show sample of referral URLs
    console.log('='.repeat(60))
    console.log('📋 Sample Referral URLs (first 10):')
    console.log('')
    
    const sampleRefLinks = await prisma.refLink.findMany({
      take: 10,
      include: {
        customer: {
          select: {
            fullName: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    sampleRefLinks.forEach((link, index) => {
      const customerName = link.customer?.fullName || 
                          `${link.customer?.firstName || ''} ${link.customer?.lastName || ''}`.trim() || 
                          'Unknown'
      console.log(`${index + 1}. ${link.refCode}`)
      console.log(`   Customer: ${customerName}`)
      console.log(`   URL: ${link.url}`)
      console.log(`   Status: ${link.status}`)
      console.log('')
    })
    
    // Database storage info
    console.log('='.repeat(60))
    console.log('💾 Database Storage:')
    console.log('')
    console.log('All referral URLs are stored in:')
    console.log('  Table: ref_links')
    console.log('  Column: url (String)')
    console.log('')
    console.log(`Current storage: ${activeRefLinks} active referral URLs`)
    if (totalCustomers > 0) {
      const estimatedStorage = totalCustomers * 100 // rough estimate: ~100 bytes per URL
      console.log(`Estimated storage for all ${totalCustomers} customers: ~${(estimatedStorage / 1024).toFixed(1)} KB`)
    }
    console.log('')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkAllCustomers()

