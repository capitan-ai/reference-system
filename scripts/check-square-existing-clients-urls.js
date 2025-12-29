#!/usr/bin/env node

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkUrls() {
  try {
    console.log('🔍 Checking referral URLs in square_existing_clients table...')
    console.log('='.repeat(60))
    console.log('')

    // First, check if the column exists
    try {
      const columnCheck = await prisma.$queryRaw`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'square_existing_clients' 
        AND column_name = 'referral_url'
      `
      
      if (!columnCheck || columnCheck.length === 0) {
        console.log('❌ referral_url column does NOT exist in square_existing_clients table!')
        console.log('')
        console.log('📝 Need to add the column first. Running fix-database-schema.js...')
        return
      } else {
        console.log('✅ referral_url column exists')
        console.log('')
      }
    } catch (error) {
      console.log('⚠️  Could not check column:', error.message)
      console.log('')
    }

    // Get all customers with referral URLs
    const customersWithUrls = await prisma.$queryRaw`
      SELECT 
        square_customer_id,
        phone_number,
        personal_code,
        referral_url,
        given_name,
        family_name,
        email_address
      FROM square_existing_clients
      WHERE referral_url IS NOT NULL AND referral_url != ''
      ORDER BY updated_at DESC
    `

    console.log(`📊 Customers with referral URLs: ${customersWithUrls.length}`)
    console.log('')

    if (customersWithUrls.length === 0) {
      console.log('❌ No referral URLs found in square_existing_clients table')
      console.log('')
      
      // Check how many customers exist total
      const totalCustomers = await prisma.$queryRaw`
        SELECT COUNT(*) as count FROM square_existing_clients
      `
      console.log(`📊 Total customers in square_existing_clients: ${totalCustomers[0]?.count || 0}`)
      console.log('')
      
      // Check how many have personal_code
      const withPersonalCode = await prisma.$queryRaw`
        SELECT COUNT(*) as count 
        FROM square_existing_clients 
        WHERE personal_code IS NOT NULL AND personal_code != ''
      `
      console.log(`📊 Customers with personal_code: ${withPersonalCode[0]?.count || 0}`)
      console.log('')
      
      console.log('💡 Need to run sync script or generate URLs')
      return
    }

    // Display all customers with URLs
    console.log('📋 All Customers with Referral URLs:')
    console.log('')
    customersWithUrls.forEach((customer, index) => {
      const name = `${customer.given_name || ''} ${customer.family_name || ''}`.trim() || 'Unknown'
      console.log(`${index + 1}. ${customer.square_customer_id}`)
      console.log(`   Name: ${name}`)
      console.log(`   Phone: ${customer.phone_number || 'N/A'}`)
      console.log(`   Code: ${customer.personal_code || 'N/A'}`)
      console.log(`   URL: ${customer.referral_url}`)
      console.log('')
    })

    // Check ref_links table for comparison
    const refLinks = await prisma.refLink.findMany({
      where: { status: 'ACTIVE' },
      include: {
        customer: {
          select: {
            squareCustomerId: true,
            phoneE164: true,
            fullName: true
          }
        }
      }
    })

    console.log('='.repeat(60))
    console.log('📊 Comparison:')
    console.log(`   URLs in square_existing_clients: ${customersWithUrls.length}`)
    console.log(`   URLs in ref_links: ${refLinks.length}`)
    console.log('')

    if (customersWithUrls.length < refLinks.length) {
      console.log('⚠️  Some URLs are missing from square_existing_clients!')
      console.log('   Run: node scripts/sync-urls-to-square-existing-clients.js')
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkUrls()


