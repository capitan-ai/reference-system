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
    
    // Count customers with referral links (from square_existing_clients)
    const customersWithRefLinksResult = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE referral_url IS NOT NULL AND referral_url != ''
    `
    const customersWithRefLinks = Number(customersWithRefLinksResult[0].count)
    
    // Count total referral links
    const totalRefLinksResult = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM square_existing_clients
      WHERE referral_url IS NOT NULL AND referral_url != ''
    `
    const totalRefLinks = Number(totalRefLinksResult[0].count)
    const activeRefLinks = totalRefLinks
    
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
          square_customer_id,
          given_name,
          family_name,
          email_address,
          created_at
        FROM square_existing_clients
        WHERE referral_url IS NULL OR referral_url = ''
        ORDER BY created_at DESC
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
    
    // Note: Customers now have single referral_url in square_existing_clients table
    // Multiple links per customer are no longer supported
    
    // Show sample of referral URLs
    console.log('='.repeat(60))
    console.log('📋 Sample Referral URLs (first 10):')
    console.log('')
    
    const sampleRefLinks = await prisma.$queryRaw`
      SELECT 
        referral_code,
        referral_url,
        square_customer_id,
        given_name,
        family_name
      FROM square_existing_clients
      WHERE referral_url IS NOT NULL AND referral_url != ''
      ORDER BY created_at DESC
      LIMIT 10
    `
    
    sampleRefLinks.forEach((link, index) => {
      const customerName = `${link.given_name || ''} ${link.family_name || ''}`.trim() || 
                          'Unknown'
      console.log(`${index + 1}. ${link.referral_code || 'N/A'}`)
      console.log(`   Customer: ${customerName}`)
      console.log(`   URL: ${link.referral_url}`)
      console.log('')
    })
    
    // Database storage info
    console.log('='.repeat(60))
    console.log('💾 Database Storage:')
    console.log('')
    console.log('All referral URLs are stored in:')
    console.log('  Table: square_existing_clients')
    console.log('  Column: referral_url (String)')
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

