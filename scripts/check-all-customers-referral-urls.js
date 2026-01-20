#!/usr/bin/env node

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkAllCustomers() {
  try {
    console.log('🔍 Checking All Customers and Referral URLs')
    console.log('='.repeat(60))
    console.log('')
    
    // Count total customers from square_existing_clients
    const totalCustomersResult = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM square_existing_clients
    `
    const totalCustomers = Number(totalCustomersResult[0].count)
    console.log(`📊 Total Customers in Database: ${totalCustomers}`)
    
    // Count customers with referral links
    const customersWithRefLinksResult = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT rl.customer_id) as count
      FROM ref_links rl
      WHERE rl.status = 'ACTIVE'
    `
    const customersWithRefLinks = Number(customersWithRefLinksResult[0].count)
    
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
      
      const customersWithoutRefLinks = await prisma.$queryRaw`
        SELECT 
          sec.square_customer_id,
          sec.given_name,
          sec.family_name,
          sec.email_address,
          sec.created_at
        FROM square_existing_clients sec
        WHERE NOT EXISTS (
          SELECT 1 FROM ref_links rl 
          WHERE rl.customer_id = sec.square_customer_id
        )
        ORDER BY sec.created_at DESC
        LIMIT 10
      `
      
      customersWithoutRefLinks.forEach((customer, index) => {
        const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 
                    customer.email_address || 
                    'Unknown'
        console.log(`   ${index + 1}. ${name}`)
        console.log(`      Square ID: ${customer.square_customer_id || 'N/A'}`)
        console.log(`      Email: ${customer.email_address || 'N/A'}`)
        console.log(`      Created: ${customer.created_at ? new Date(customer.created_at).toISOString().split('T')[0] : 'N/A'}`)
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
    const customersWithMultipleRefLinks = await prisma.$queryRaw`
      SELECT 
        rl.customer_id,
        COUNT(*) as link_count,
        array_agg(rl.ref_code) as ref_codes,
        array_agg(rl.url) as urls,
        array_agg(rl.status::text) as statuses
      FROM ref_links rl
      GROUP BY rl.customer_id
      HAVING COUNT(*) > 1
      LIMIT 5
    `
    
    if (customersWithMultipleRefLinks.length > 0) {
      console.log('⚠️  Customers with multiple referral links:')
      for (const customer of customersWithMultipleRefLinks) {
        const customerData = await prisma.$queryRaw`
          SELECT 
            given_name, 
            family_name, 
            email_address
          FROM square_existing_clients
          WHERE square_customer_id = ${customer.customer_id}
          LIMIT 1
        `
        const name = customerData[0] 
          ? `${customerData[0].given_name || ''} ${customerData[0].family_name || ''}`.trim() || 
            customerData[0].email_address || 
            'Unknown'
          : customer.customer_id
        console.log(`   ${name}: ${customer.link_count} links`)
        const refCodes = customer.ref_codes || []
        const urls = customer.urls || []
        const statuses = customer.statuses || []
        for (let i = 0; i < refCodes.length; i++) {
          console.log(`      - ${refCodes[i]}: ${urls[i]} (${statuses[i]})`)
        }
      }
      console.log('')
    }
    
    // Show sample of referral URLs
    console.log('='.repeat(60))
    console.log('📋 Sample Referral URLs (first 10):')
    console.log('')
    
    const sampleRefLinks = await prisma.$queryRaw`
      SELECT 
        rl.ref_code,
        rl.url,
        rl.status,
        rl.customer_id,
        sec.given_name,
        sec.family_name
      FROM ref_links rl
      LEFT JOIN square_existing_clients sec ON sec.square_customer_id = rl.customer_id
      ORDER BY rl.created_at DESC
      LIMIT 10
    `
    
    sampleRefLinks.forEach((link, index) => {
      const customerName = `${link.given_name || ''} ${link.family_name || ''}`.trim() || 
                          'Unknown'
      console.log(`${index + 1}. ${link.ref_code}`)
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

