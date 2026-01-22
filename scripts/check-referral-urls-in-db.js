#!/usr/bin/env node

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkReferralUrls() {
  try {
    console.log('🔍 Checking Referral URLs in Database')
    console.log('='.repeat(60))
    console.log('')
    
    // Get all referral URLs from square_existing_clients
    const customersWithUrls = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        referral_code,
        personal_code,
        referral_url,
        given_name,
        family_name,
        email_address,
        updated_at
      FROM square_existing_clients
      WHERE referral_url IS NOT NULL AND referral_url != ''
      ORDER BY updated_at DESC
    `
    
    console.log(`📊 Found ${customersWithUrls.length} referral URLs in database`)
    console.log('')
    
    if (customersWithUrls.length === 0) {
      console.log('❌ No referral URLs found')
      return
    }
    
    // Show all referral URLs
    console.log('📋 All Referral URLs:')
    console.log('')
    
    customersWithUrls.forEach((customer, index) => {
      const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 
                          customer.email_address || 
                          'Unknown'
      const refCode = customer.referral_code || customer.personal_code || 'N/A'
      
      console.log(`${index + 1}. ${refCode}`)
      console.log(`   Customer: ${customerName}`)
      console.log(`   Square Customer ID: ${customer.square_customer_id}`)
      console.log(`   URL: ${customer.referral_url}`)
      console.log(`   Updated: ${customer.updated_at ? new Date(customer.updated_at).toISOString().split('T')[0] : 'N/A'}`)
      console.log('')
    })
    
    // Specifically check for IANA7748 and BOZHENA8884
    console.log('='.repeat(60))
    console.log('🔍 Specific Codes Check:')
    console.log('')
    
    const specificCodes = ['IANA7748', 'BOZHENA8884']
    
    for (const code of specificCodes) {
      const customer = customersWithUrls.find(c => 
        c.referral_code === code || c.personal_code === code
      )
      if (customer) {
        const customerName = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 
                           customer.email_address || 
                           'Unknown'
        console.log(`✅ ${code}:`)
        console.log(`   Customer: ${customerName}`)
        console.log(`   URL: ${customer.referral_url}`)
        console.log(`   Square Customer ID: ${customer.square_customer_id}`)
        console.log('')
      } else {
        console.log(`❌ ${code}: Not found in database`)
        console.log('')
      }
    }
    
    // Show database table info
    console.log('='.repeat(60))
    console.log('📊 Database Table Info:')
    console.log('')
    console.log('Table: square_existing_clients')
    console.log('Columns:')
    console.log('  - square_customer_id: String (primary key)')
    console.log('  - referral_code: String (referral code)')
    console.log('  - personal_code: String (personal code)')
    console.log('  - referral_url: String (full referral URL - THIS IS WHERE URLs ARE STORED)')
    console.log('')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkReferralUrls()

