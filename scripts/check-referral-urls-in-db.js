#!/usr/bin/env node

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function checkReferralUrls() {
  try {
    console.log('🔍 Checking Referral URLs in Database')
    console.log('='.repeat(60))
    console.log('')
    
    // Get all referral links
    const refLinks = await prisma.refLink.findMany({
      include: {
        customer: {
          select: {
            fullName: true,
            firstName: true,
            lastName: true,
            email: true,
            squareCustomerId: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    console.log(`📊 Found ${refLinks.length} referral links in database`)
    console.log('')
    
    if (refLinks.length === 0) {
      console.log('❌ No referral links found')
      return
    }
    
    // Show all referral URLs
    console.log('📋 All Referral URLs:')
    console.log('')
    
    refLinks.forEach((link, index) => {
      const customerName = link.customer?.fullName || 
                           `${link.customer?.firstName || ''} ${link.customer?.lastName || ''}`.trim() || 
                           link.customer?.email || 
                           'Unknown'
      
      console.log(`${index + 1}. ${link.refCode}`)
      console.log(`   Customer: ${customerName}`)
      console.log(`   URL: ${link.url}`)
      console.log(`   Status: ${link.status}`)
      console.log(`   Created: ${link.createdAt.toISOString().split('T')[0]}`)
      console.log('')
    })
    
    // Specifically check for IANA7748 and BOZHENA8884
    console.log('='.repeat(60))
    console.log('🔍 Specific Codes Check:')
    console.log('')
    
    const specificCodes = ['IANA7748', 'BOZHENA8884']
    
    for (const code of specificCodes) {
      const link = refLinks.find(l => l.refCode === code)
      if (link) {
        const customerName = link.customer?.fullName || 
                           `${link.customer?.firstName || ''} ${link.customer?.lastName || ''}`.trim() || 
                           link.customer?.email || 
                           'Unknown'
        console.log(`✅ ${code}:`)
        console.log(`   Customer: ${customerName}`)
        console.log(`   URL: ${link.url}`)
        console.log(`   Database ID: ${link.id}`)
        console.log(`   Customer ID: ${link.customerId}`)
        console.log(`   Square Customer ID: ${link.customer?.squareCustomerId || 'N/A'}`)
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
    console.log('Table: ref_links')
    console.log('Columns:')
    console.log('  - id: UUID (primary key)')
    console.log('  - customerId: UUID (foreign key to customers table)')
    console.log('  - refCode: String (unique referral code)')
    console.log('  - url: String (full referral URL - THIS IS WHERE URLs ARE STORED)')
    console.log('  - status: RefLinkStatus (ACTIVE, NOT_ISSUED, REVOKED)')
    console.log('  - issuedAt: DateTime')
    console.log('  - createdAt: DateTime')
    console.log('')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

checkReferralUrls()

