#!/usr/bin/env node

/**
 * Generate referral links for all customers who don't have one yet
 * This will create RefLink records in the ref_links table for all 7000+ customers
 */

require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const { generateReferralUrl } = require('../lib/utils/referral-url')

const prisma = new PrismaClient()

// Generate a personal referral code (same logic as in the webhook handler)
function generatePersonalCode(name, customerId) {
  const cleanName = (name || 'CUSTOMER')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
  
  const cleanId = (customerId || '')
    .toString()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-4)
    .toUpperCase()
  
  return `${cleanName}${cleanId}`.slice(0, 12) || `CUST${Date.now().toString().slice(-4)}`
}

async function generateReferralLinksForAllCustomers() {
  try {
    console.log('🔍 Finding customers without referral links...')
    console.log('='.repeat(60))
    console.log('')
    
    // Get all customers who don't have a referral link
    const customersWithoutRefLinks = await prisma.customer.findMany({
      where: {
        RefLinks: {
          none: {}
        }
      },
      select: {
        id: true,
        squareCustomerId: true,
        phoneE164: true,
        firstName: true,
        lastName: true,
        fullName: true,
        email: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    })
    
    const totalCustomers = await prisma.customer.count()
    const customersWithRefLinks = await prisma.customer.count({
      where: {
        RefLinks: {
          some: {}
        }
      }
    })
    
    console.log(`📊 Total Customers: ${totalCustomers}`)
    console.log(`📊 Customers with Referral Links: ${customersWithRefLinks}`)
    console.log(`📊 Customers without Referral Links: ${customersWithoutRefLinks.length}`)
    console.log('')
    
    if (customersWithoutRefLinks.length === 0) {
      console.log('✅ All customers already have referral links!')
      return
    }
    
    console.log(`🚀 Generating referral links for ${customersWithoutRefLinks.length} customers...`)
    console.log('')
    
    let successCount = 0
    let errorCount = 0
    const errors = []
    
    // Process in batches to avoid overwhelming the database
    const BATCH_SIZE = 50
    for (let i = 0; i < customersWithoutRefLinks.length; i += BATCH_SIZE) {
      const batch = customersWithoutRefLinks.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(customersWithoutRefLinks.length / BATCH_SIZE)
      
      console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} customers)...`)
      
      for (const customer of batch) {
        try {
          const customerName = customer.fullName || 
                              `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 
                              customer.email || 
                              'Customer'
          
          // Generate unique referral code
          let referralCode = generatePersonalCode(customerName, customer.squareCustomerId || customer.id)
          let codeExists = true
          let attempts = 0
          const maxAttempts = 10
          
          // Ensure code is unique
          while (codeExists && attempts < maxAttempts) {
            const existing = await prisma.refLink.findUnique({
              where: { refCode: referralCode }
            })
            
            if (!existing) {
              codeExists = false
            } else {
              // Try with timestamp to make it unique
              referralCode = generatePersonalCode(customerName, `${customer.id}_${Date.now()}`)
              attempts++
            }
          }
          
          if (codeExists) {
            console.log(`   ⚠️  Could not generate unique code for ${customerName} after ${attempts} attempts`)
            errorCount++
            errors.push({ customer: customerName, error: 'Could not generate unique code' })
            continue
          }
          
          // Generate referral URL using the utility function
          const referralUrl = generateReferralUrl(referralCode)
          
          // Create referral link in database
          const refLink = await prisma.refLink.create({
            data: {
              customerId: customer.id,
              refCode: referralCode,
              url: referralUrl,
              status: 'ACTIVE'
            }
          })
          
          // Also update square_existing_clients table with the URL
          if (customer.squareCustomerId) {
            try {
              await prisma.$executeRaw`
                UPDATE square_existing_clients
                SET 
                  referral_url = ${referralUrl},
                  personal_code = COALESCE(personal_code, ${referralCode}),
                  updated_at = NOW()
                WHERE square_customer_id = ${customer.squareCustomerId}
              `
            } catch (error) {
              // Log but don't fail if square_existing_clients update fails
              if (successCount % 50 === 0) {
                console.log(`   ⚠️  Could not update square_existing_clients for ${customer.squareCustomerId}: ${error.message}`)
              }
            }
          }
          
          successCount++
          
          if (successCount % 10 === 0 || i === 0) {
            console.log(`   ✅ Created: ${referralCode} → ${referralUrl}`)
            console.log(`      Customer: ${customerName}`)
          }
          
        } catch (error) {
          errorCount++
          const customerName = customer.fullName || 
                              `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 
                              customer.email || 
                              'Unknown'
          errors.push({ customer: customerName, error: error.message })
          
          if (error.code === 'P2002') {
            console.log(`   ⚠️  Duplicate code for ${customerName}, skipping...`)
          } else {
            console.log(`   ❌ Error for ${customerName}: ${error.message}`)
          }
        }
      }
      
      // Progress update
      const progress = ((i + batch.length) / customersWithoutRefLinks.length * 100).toFixed(1)
      console.log(`   Progress: ${progress}% (${i + batch.length}/${customersWithoutRefLinks.length})`)
      console.log('')
    }
    
    // Summary
    console.log('='.repeat(60))
    console.log('📊 SUMMARY')
    console.log('='.repeat(60))
    console.log(`Total customers: ${totalCustomers}`)
    console.log(`Customers processed: ${customersWithoutRefLinks.length}`)
    console.log(`✅ Successfully created: ${successCount}`)
    console.log(`❌ Failed: ${errorCount}`)
    console.log('')
    
    // Verify final count
    const finalCount = await prisma.refLink.count({
      where: {
        status: 'ACTIVE'
      }
    })
    console.log(`📊 Total Active Referral Links in Database: ${finalCount}`)
    console.log('')
    
    if (errors.length > 0 && errors.length <= 20) {
      console.log('❌ Errors encountered:')
      errors.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.customer}: ${err.error}`)
      })
    } else if (errors.length > 20) {
      console.log(`❌ ${errors.length} errors encountered (showing first 10):`)
      errors.slice(0, 10).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.customer}: ${err.error}`)
      })
      console.log(`   ... and ${errors.length - 10} more errors`)
    }
    
    console.log('')
    console.log('✅ Done!')
    console.log('')
    console.log('💾 All referral URLs are stored in:')
    console.log('   Table: ref_links')
    console.log('   Column: url')
    console.log('')
    console.log('📋 To view all referral URLs, run:')
    console.log('   node scripts/check-referral-urls-in-db.js')
    
  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

generateReferralLinksForAllCustomers()

